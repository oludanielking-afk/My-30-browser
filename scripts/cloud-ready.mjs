import fs from "node:fs/promises";
const file = process.env.ADMIN_TOKEN_FILE;
if (!file) throw Error("ADMIN_TOKEN_FILE is required");
const token = (await fs.readFile(file, "utf8")).trim();
const base = process.env.COORDINATOR_URL || "http://127.0.0.1:3000";
const deadline = Date.now() + 60000;
let error;
while (Date.now() < deadline) {
  try {
    const r = await fetch(base + "/health/ready", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      console.log(
        "All configured worker APIs are ready (this is not a 30-browser capacity assertion)",
      );
      process.exit(0);
    }
    error = Error("Coordinator readiness HTTP " + r.status);
  } catch (e) {
    error = e;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
throw error || Error("Readiness timeout");
