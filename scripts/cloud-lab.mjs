// Linux-only, isolated laboratory. All browser traffic is intercepted at fixture.invalid.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { load } = require("../dist/cloud-load.cjs");
const duration = Number(process.env.DURATION_SECONDS || 180),
  out = path.resolve(process.env.REPORT_DIR || "reports/local-cloud");
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const processStat = await fs.readFile(`/proc/${process.pid}/stat`, "utf8");
await fs.writeFile(
  path.join(out, "harness.json"),
  JSON.stringify({
    pid: process.pid,
    startTicks: processStat
      .slice(processStat.lastIndexOf(")") + 2)
      .split(" ")[19],
  }),
  { mode: 0o600 },
);
const root = path.join(out, "private", crypto.randomUUID());
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const token = crypto.randomBytes(32).toString("hex"),
  cluster = crypto.randomBytes(32).toString("hex");
const children = [];
const logs = [];
let stopped = false;
async function port() {
  const s = net.createServer();
  await new Promise((r, j) => s.once("error", j).listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function wait(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Readiness timed out: " + (error?.message || "condition false"));
}
async function call(base, route, method = "GET", body, auth = token) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer " + auth,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const d = await r.json();
  if (!r.ok) throw Error(`${route}: ${r.status}: ${d.error || ""}`);
  return d;
}
async function start(command, args, env, name) {
  const handle = await fs.open(path.join(root, name + ".log"), "a");
  logs.push(handle);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", handle.fd, handle.fd],
  });
  children.push(child);
  return child;
}
async function stop(child, signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
}
async function cleanup() {
  if (stopped) return;
  stopped = true;
  for (const child of children.slice().reverse()) await stop(child);
  for (const h of logs) await h.close().catch(() => {});
}
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(143)));
process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));
try {
  const cport = await port(),
    base = `http://127.0.0.1:${cport}`,
    workers = [];
  await fs.writeFile(path.join(root, "admin-token"), token, { mode: 0o600 });
  for (let i = 0; i < 3; i++) {
    const p = await port(),
      id = "worker-" + (i + 1),
      workerToken = crypto.randomBytes(32).toString("hex"),
      file = path.join(root, id + "-token"),
      data = path.join(root, id);
    await fs.mkdir(data, { recursive: true });
    await fs.writeFile(file, workerToken, { mode: 0o600 });
    const profiles = Array.from(
      { length: 10 },
      (_, j) => "profile-" + String(i * 10 + j + 1).padStart(2, "0"),
    );
    const env = {
      NODE_ENV: "test",
      MBAM_TEST_MODE: "1",
      HOST: "127.0.0.1",
      PORT: String(p),
      WORKER_ID: id,
      DATA_DIR: data,
      PROFILE_START: String(i * 10 + 1),
      PROFILE_COUNT: "10",
      WORKER_TOKEN: workerToken,
      VAULT_KEY: crypto.randomBytes(32).toString("hex"),
      CLUSTER_TOKEN: cluster,
      COORDINATOR_URL: base,
      CHROMIUM_EXECUTABLE: process.env.TEST_CHROMIUM || "",
      MIN_FREE_MB: "1024",
    };
    const child = await start(
      "flock",
      [
        "-E",
        "73",
        "-n",
        path.join(data, "worker.lock"),
        process.execPath,
        "dist/cloud-worker.cjs",
      ],
      env,
      id,
    );
    workers.push({
      id,
      url: `http://127.0.0.1:${p}`,
      tokenFile: file,
      profiles,
      token: workerToken,
      env,
      child,
      data,
    });
    await wait(() =>
      call(workers[i].url, "/health/ready", "GET", undefined, workerToken),
    );
  }
  const config = path.join(root, "workers.json");
  await fs.writeFile(
    config,
    JSON.stringify(
      workers.map(({ id, url, tokenFile, profiles }) => ({
        id,
        url,
        tokenFile,
        profiles,
      })),
    ),
    { mode: 0o600 },
  );
  await start(
    process.execPath,
    ["dist/cloud-coordinator.cjs"],
    {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(cport),
      ADMIN_TOKEN: token,
      CLUSTER_TOKEN: cluster,
      WORKERS_FILE: config,
      ALLOW_INTERNAL_HTTP: "1",
    },
    "coordinator",
  );
  await wait(() => call(base, "/health/ready"));
  const unauth = await fetch(base + "/api/status");
  assert.equal(unauth.status, 401);
  const wrong = await fetch(workers[0].url + "/api/profiles/profile-11/start", {
    method: "POST",
    headers: { Authorization: "Bearer " + workers[0].token },
  });
  assert.equal(wrong.status, 400);
  // Real kernel fencing: a second process cannot acquire the first worker's volume lock.
  const duplicate = spawn("flock", [
    "-E",
    "73",
    "-n",
    path.join(workers[0].data, "worker.lock"),
    "true",
  ]);
  assert.equal(await new Promise((r) => duplicate.on("exit", r)), 73);
  console.log(
    "Authentication, shard rejection and duplicate-owner lock passed",
  );
  await Promise.all(
    workers.map(async (w) => {
      for (const id of w.profiles) {
        await call(base, "/api/profiles/" + id, "PATCH", {
          url: `https://fixture.invalid/${id}`,
          autoReload: true,
        });
        await call(base, `/api/profiles/${id}/start`, "POST");
      }
    }),
  );
  await wait(async () => {
    const s = await call(base, "/api/status");
    return (
      s.allHealthy &&
      s.running === 30 &&
      s.profiles.every((p) => p.state === "running")
    );
  }, 120000);
  for (const w of workers)
    for (const id of w.profiles) {
      const empty = await call(w.url, `/test/${id}/probe`, "POST", {}, w.token);
      assert.equal(empty.cookie, null);
      assert.equal(empty.owner, null);
      await call(w.url, `/test/${id}/seed`, "POST", {}, w.token);
    }
  const observations = new Map();
  async function probe() {
    for (const w of workers)
      for (const id of w.profiles) {
        const p = await call(w.url, `/test/${id}/probe`, "POST", {}, w.token);
        assert.equal(p.cookie, id);
        assert.equal(p.owner, id);
        assert.equal(p.state, "running");
        assert.ok(p.ticks >= 0);
        assert.ok(p.title?.startsWith("Authorized fixture"));
        const previous = observations.get(id);
        if (
          previous &&
          previous.navigation === p.navigation &&
          Date.now() - previous.time > 3000
        )
          assert.ok(
            p.ticks > previous.ticks,
            `${id}: JavaScript counter stalled`,
          );
        observations.set(id, {
          navigation: p.navigation,
          ticks: p.ticks,
          time: Date.now(),
        });
      }
  }
  await probe();
  console.log(
    "All 30 browser pages opened; per-profile cookies and storage isolated",
  );
  const functionalTimer = setInterval(
    () =>
      void probe().catch((e) => {
        console.error("Functional probe failed", e.message);
        process.exitCode = 1;
      }),
    15000,
  );
  try {
    await load(base, token, duration, out);
  } finally {
    clearInterval(functionalTimer);
  }
  assert.notEqual(process.exitCode, 1, "Functional fixture probe failed");
  await probe();
  assert.equal(
    (
      await call(
        base,
        "/internal/reload-permit",
        "POST",
        { origin: "https://fixture-rate.invalid" },
        cluster,
      )
    ).allowed,
    true,
  );
  assert.equal(
    (
      await call(
        base,
        "/internal/reload-permit",
        "POST",
        { origin: "https://fixture-rate.invalid" },
        cluster,
      )
    ).allowed,
    false,
  );
  // Restart/crash recovery is measured separately from the steady-state capacity window.
  const before = (
    await call(
      workers[0].url,
      "/api/profiles",
      "GET",
      undefined,
      workers[0].token,
    )
  ).incidents;
  await call(
    workers[0].url,
    "/test/profile-01/crash",
    "POST",
    {},
    workers[0].token,
  );
  await wait(async () => {
    const s = await call(
      workers[0].url,
      "/api/profiles",
      "GET",
      undefined,
      workers[0].token,
    );
    return s.incidents > before && s.profiles[0].state === "running";
  }, 90000);
  await probe();
  const old = (
    await call(
      workers[0].url,
      "/health/ready",
      "GET",
      undefined,
      workers[0].token,
    )
  ).bootId;
  await stop(workers[0].child, "SIGKILL");
  await wait(async () => !(await call(base, "/api/status")).allHealthy, 15000);
  workers[0].child = await start(
    "flock",
    [
      "-E",
      "73",
      "-n",
      path.join(workers[0].data, "worker.lock"),
      process.execPath,
      "dist/cloud-worker.cjs",
    ],
    workers[0].env,
    "worker-1-restarted",
  );
  await wait(async () => {
    const h = await call(
      workers[0].url,
      "/health/ready",
      "GET",
      undefined,
      workers[0].token,
    );
    const s = await call(base, "/api/status");
    return h.bootId !== old && s.allHealthy && s.running === 30;
  }, 150000);
  await probe();
  await call(base, "/api/profiles/profile-01/stop", "POST");
  await call(base, "/api/profiles/profile-01/start", "POST");
  await probe();
  const result = {
    completed: true,
    auth: true,
    shardOwnership: true,
    duplicateLock: true,
    isolatedProfiles: 30,
    capacitySeconds: duration,
    functionalProbes: true,
    tabCrashRecovery: true,
    workerKillRecovery: true,
    restartSessionPersistence: true,
    host: {
      cpuQuota: await fs.readFile("/sys/fs/cgroup/cpu.max", "utf8"),
      memoryLimit: await fs.readFile("/sys/fs/cgroup/memory.max", "utf8"),
      logicalCpus: os.cpus().length,
    },
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(out, "integration.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("PASS", JSON.stringify(result));
} catch (e) {
  // GitHub's public run page exposes annotations even when raw logs require login.
  // Only the sanitized error is published; worker logs and private state stay local.
  const message = String(e.message).replaceAll(token, "[redacted]").replaceAll(cluster, "[redacted]");
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error("::error title=Cloud fixture integration failed::" +
      message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A"));
  }
  await fs.writeFile(
    path.join(out, "failure.json"),
    JSON.stringify({
      completed: false,
      error: e.message,
      timestamp: new Date().toISOString(),
    }),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
