// Disposable fixture deployment only. Never run against real accounts.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
const external = Boolean(process.env.BASE_URL),
  out = path.resolve(
    process.env.REPORT_DIR || "reports/oracle-free/runtime/integration",
  );
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const root = path.join(out, "private", crypto.randomUUID());
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const token = external
  ? (await fs.readFile(process.env.ADMIN_TOKEN_FILE, "utf8")).trim()
  : crypto.randomBytes(32).toString("hex");
const base = process.env.BASE_URL || "http://127.0.0.1:3099";
let child, log, driver;
const tests = [];
const started = Date.now();
async function call(route, method = "GET", body) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const d = await r.json();
  if (!r.ok) throw Error(`${route}: ${r.status}: ${d.error}`);
  return d;
}
async function wait(fn, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Integration readiness/recovery timed out");
}
async function launch() {
  log = await fs.open(path.join(root, "worker.log"), "a");
  child = spawn(
    "flock",
    [
      "-E",
      "73",
      "-n",
      path.join(root, "worker.lock"),
      process.execPath,
      "dist/oracle-server.cjs",
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        MBAM_TEST_MODE: "1",
        HOST: "127.0.0.1",
        PORT: "3099",
        DATA_DIR: root,
        ADMIN_TOKEN: token,
        VAULT_KEY: process.env.INTEGRATION_VAULT_KEY,
        CHROMIUM_EXECUTABLE: process.env.TEST_CHROMIUM || "",
        MAX_ACTIVE: "3",
      },
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  await wait(() => call("/health/ready"));
}
async function shutdown() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      new Promise((_, j) =>
        setTimeout(() => j(Error("Controlled shutdown timed out")), 30000),
      ),
    ]);
  }
  await log?.close();
}
async function check(name, fn) {
  await fn();
  tests.push({ name, pass: true });
  console.log("PASS", name);
}
try {
  if (!external) {
    process.env.INTEGRATION_VAULT_KEY = crypto.randomBytes(32).toString("hex");
    await launch();
  } else await wait(() => call("/health/ready"));
  await check(
    "management and viewer reject unauthenticated access",
    async () => {
      for (const route of [
        "/api/status",
        "/viewer/viewer.html",
        "/viewer/core/rfb.js",
      ])
        assert.equal((await fetch(base + route)).status, 401);
    },
  );
  await check(
    "30 permitted persistent slots; uncalibrated ceiling is at most one",
    async () => {
      const s = await call("/api/status");
      assert.equal(s.profiles.length, 30);
      assert.ok(s.effectiveLimit <= 1);
    },
  );
  for (const id of ["profile-01", "profile-02"])
    await call("/api/profiles/" + id, "PATCH", {
      url: "https://fixture.invalid/" + id,
      ownerAcknowledged: true,
      autoReload: false,
      name: id,
      notes: "Synthetic authorized integration fixture",
    });
  await check(
    "idle browser startup, cookies, local storage and geolocation denial",
    async () => {
      await call("/api/profiles/profile-01/start", "POST");
      await call("/test/profile-01/seed", "POST", {});
      const p = await call("/test/profile-01/probe", "POST", {});
      assert.equal(p.cookie, "profile-01");
      assert.equal(p.owner, "profile-01");
      assert.equal(p.geo, "denied");
    },
  );
  await check(
    "resource/calibration ceiling rejects excess launch",
    async () => {
      await assert.rejects(call("/api/profiles/profile-02/start", "POST"));
      const s = await call("/api/status");
      assert.equal(s.running, 1);
    },
  );
  await check("idle mode does not schedule reloads", async () => {
    await new Promise((r) => setTimeout(r, 5000));
    const p = (await call("/api/status")).profiles[0];
    assert.equal(p.reloadCount, 0);
    assert.equal(p.nextReload, undefined);
    await assert.rejects(call("/api/profiles/profile-01/reload", "POST"));
  });
  await check(
    "separate profiles preserve distinct sessions across browser restart",
    async () => {
      await call("/api/profiles/profile-01/stop", "POST");
      await call("/api/profiles/profile-02/start", "POST");
      const p = await call("/test/profile-02/probe", "POST", {});
      assert.equal(p.owner, null);
      assert.equal(p.cookie, undefined);
      await call("/test/profile-02/seed", "POST", {});
      await call("/api/profiles/profile-02/stop", "POST");
      await call("/api/profiles/profile-01/start", "POST");
      const restored = await call("/test/profile-01/probe", "POST", {});
      assert.equal(restored.owner, "profile-01");
      assert.equal(restored.cookie, "profile-01");
    },
  );
  await check("headed browser crash enters bounded recovery", async () => {
    const before = (await call("/api/status")).crashes;
    await call("/test/profile-01/crash", "POST", {});
    await wait(async () => {
      const s = await call("/api/status");
      return (
        s.crashes > before &&
        s.profiles[0].state === "running" &&
        s.profiles[0].attempts >= 1
      );
    });
    assert.equal(
      (await call("/test/profile-01/probe", "POST", {})).cookie,
      "profile-01",
    );
  });
  await call("/api/profiles/profile-01/stop", "POST");
  await call("/api/profiles/profile-01", "PATCH", {
    autoReload: true,
    minSeconds: 120,
    maxSeconds: 120,
  });
  await call("/api/profiles/profile-01/start", "POST");
  await check(
    "controlled reload enforces 120-second cooldown and persists history",
    async () => {
      await assert.rejects(call("/api/profiles/profile-01/reload", "POST"));
      await wait(
        async () => (await call("/api/status")).profiles[0].reloadCount >= 1,
        145000,
      );
      assert.equal(
        (await call("/test/profile-01/probe", "POST", {})).cookie,
        "profile-01",
      );
    },
  );
  await check(
    "viewer cookie is HttpOnly, short-lived and server-side revocable",
    async () => {
      const r = await fetch(base + "/api/viewer-session", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      assert.equal(r.status, 200);
      const cookie = r.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      assert.ok(!cookie.includes(token));
      const key = cookie.split(";")[0];
      assert.equal(
        (
          await fetch(base + "/viewer/viewer.html", {
            headers: { Cookie: key },
          })
        ).status,
        200,
      );
      await fetch(base + "/viewer/logout", {
        method: "POST",
        headers: { Cookie: key, Origin: base },
      });
      assert.equal(
        (
          await fetch(base + "/viewer/viewer.html", {
            headers: { Cookie: key },
          })
        ).status,
        401,
      );
    },
  );
  let viewerConnectivity = "not tested: no VNC backend in native harness";
  if (process.env.REQUIRE_VIEWER === "1")
    await check(
      "noVNC connects through authenticated WebSocket gateway",
      async () => {
        driver = await chromium.launch({
          headless: false,
          executablePath: process.env.TEST_CHROMIUM || undefined,
          chromiumSandbox: true,
        });
        const page = await driver.newPage();
        await page.goto(base);
        await page.fill("#token", token);
        await page.click("#login button");
        await page.waitForFunction(() =>
          document.querySelector("#message").textContent.includes("Connected"),
        );
        await page.click("#viewer");
        await page.waitForSelector("#viewer-link:not([hidden])");
        await page.goto(base + "/viewer/viewer.html");
        await page.waitForFunction(
          () =>
            document
              .querySelector("#state")
              .textContent.startsWith("Connected"),
          { timeout: 30000 },
        );
        await page.click("#end");
        await page.waitForFunction(
          () =>
            document.querySelector("#state").textContent === "Session ended",
        );
        viewerConnectivity = "passed actual RFB connection and logout";
      },
    );
  if (!external)
    await check(
      "controlled application restart restores intent and session",
      async () => {
        await shutdown();
        await launch();
        await wait(
          async () =>
            (await call("/api/status")).profiles[0].state === "running",
        );
        assert.equal(
          (await call("/test/profile-01/probe", "POST", {})).cookie,
          "profile-01",
        );
      },
    );
  await call("/api/profiles/profile-01/stop", "POST");
  const result = {
    completed: true,
    architecture: process.arch,
    nativeOracle: false,
    elapsedSeconds: (Date.now() - started) / 1000,
    tests,
    viewerConnectivity,
  };
  await fs.writeFile(
    path.join(out, "integration.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (e) {
  const status = await call("/api/status").catch(() => null);
  const diagnostic = {
    lastCompleted: tests.at(-1)?.name,
    running: status?.running,
    firstProfile: status?.profiles[0] && {
      state: status.profiles[0].state,
      attempts: status.profiles[0].attempts,
      lastError: status.profiles[0].lastError,
    },
    events: status?.events?.slice(-6),
  };
  if (process.env.GITHUB_ACTIONS === "true")
    console.error(
      "::notice title=Fixture diagnostic::" +
        JSON.stringify(diagnostic)
          .replaceAll("%", "%25")
          .replaceAll("\n", "%0A"),
    );
  if (process.env.GITHUB_ACTIONS === "true")
    console.error(
      "::error title=Oracle integration failed::" +
        String(e.message)
          .replace(/\b[a-f0-9]{64}\b/gi, "[redacted]")
          .replaceAll("%", "%25")
          .replaceAll("\n", "%0A")
          .replaceAll("\r", "%0D"),
    );
  console.error(
    "Integration failed:",
    String(e.message).replace(/\b[a-f0-9]{64}\b/gi, "[redacted]"),
  );
  await fs.writeFile(
    path.join(out, "failure.json"),
    JSON.stringify({
      completed: false,
      error: String(e.message).replace(/\b[a-f0-9]{64}\b/gi, "[redacted]"),
      tests,
    }),
  );
  process.exitCode = 1;
} finally {
  await driver?.close();
  if (!external) await shutdown();
}
