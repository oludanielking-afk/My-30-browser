import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("worker startup, auth, settings and graceful shutdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-worker-"));
  const token = "test-only-token-at-least-24-characters";
  const child = spawn(process.execPath, ["dist/worker.cjs"], {
    env: { ...process.env, DATA_DIR: root, PORT: "0", ADMIN_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (d) => (errors += d));
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Worker startup timeout " + errors)),
        10000,
      );
      child.stdout.on("data", (d) => {
        const m = String(d).match(/Worker ready (\d+)/);
        if (m) {
          clearTimeout(timeout);
          resolve(m[1]);
        }
      });
      child.on("exit", () => {
        clearTimeout(timeout);
        reject(Error("Worker exited " + errors));
      });
    });
    const base = `http://127.0.0.1:${port}/api`;
    assert.equal((await fetch(base + "/profiles")).status, 401);
    const headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
    const response = await fetch(base + "/profiles", { headers });
    const snapshot = await response.json();
    assert.equal(snapshot.profiles.length, 30);
    assert.equal(snapshot.running, 0);
    assert.equal(
      (
        await fetch(base + "/profiles/profile-01", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ name: "Cloud workspace" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/profiles/profile-01", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ minSeconds: 1 }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/profiles/profile-01/unknown", {
          method: "POST",
          headers,
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
    await fs.rm(root, { recursive: true, force: true });
  }
});
