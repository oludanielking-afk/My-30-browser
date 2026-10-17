// Fixture-only container restart check, split around docker compose restart.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const token = (await fs.readFile(process.env.ADMIN_TOKEN_FILE, "utf8")).trim(),
  base = "http://127.0.0.1:3000";
async function api(route, method = "GET", body) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw Error("Fixture API rejected " + route);
  return r.json();
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await api("/health/ready")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Restart readiness timed out");
}
await ready();
if (process.argv[2] === "prepare") {
  const s = await api("/api/status");
  assert.equal(s.profiles[0].url, "https://fixture.invalid/profile-01");
  await api("/api/profiles/profile-01", "PATCH", { autoReload: false });
  await api("/api/profiles/profile-01/start", "POST");
  await api("/test/profile-01/seed", "POST", {});
} else if (process.argv[2] === "verify") {
  for (let i = 0; i < 120; i++) {
    const s = await api("/api/status");
    if (s.profiles[0].state === "running") {
      const p = await api("/test/profile-01/probe", "POST", {});
      assert.equal(p.owner, "profile-01");
      assert.equal(p.cookie, "profile-01");
      await api("/api/profiles/profile-01/stop", "POST");
      await fs.writeFile(
        "/reports/restart.json",
        JSON.stringify({
          completed: true,
          sessionPersistence: true,
          architecture: process.arch,
          nativeOracle: false,
        }),
      );
      console.log("PASS container restart persistence");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Desired profile did not recover");
} else throw Error("Use prepare or verify");
