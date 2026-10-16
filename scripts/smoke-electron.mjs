import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import electron from "electron";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-startup-"));
const output = path.join(root, "result.json");
const args = [".", `--user-data-dir=${path.join(root, "user")}`];
if (
  process.platform === "linux" &&
  process.env.TEST_ELECTRON_NO_SANDBOX === "1"
)
  args.push("--no-sandbox");
const child = spawn(electron, args, {
  env: { ...process.env, MBAM_SMOKE: "1", MBAM_SMOKE_FILE: output },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
try {
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, log.slice(-4000));
  const result = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(result.cards, 30);
  assert.equal(result.title, "Multi Browser Manager");
  console.log(
    "PASS: Electron startup, preload IPC and all 30 React profile cards",
  );
} finally {
  clearTimeout(timer);
  await fs.rm(root, { recursive: true, force: true });
}
