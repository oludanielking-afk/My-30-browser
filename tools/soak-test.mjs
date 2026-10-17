// A controlled Oracle fixture deployment must already be running. Real websites are refused.
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
const base = process.env.BASE_URL || "http://127.0.0.1:3000",
  token = (await fs.readFile(process.env.ADMIN_TOKEN_FILE, "utf8")).trim(),
  out = path.resolve(process.env.REPORT_DIR || "reports/oracle-free/soak-test");
const seconds = Number(process.env.DURATION_SECONDS || 86400),
  mode = process.env.MODE || "idle",
  count = Number(process.env.PROFILE_COUNT || 1);
if (
  !["idle", "reload"].includes(mode) ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 10 ||
  !Number.isFinite(seconds) ||
  seconds < 60 ||
  seconds > 172800
)
  throw Error("Invalid soak mode, profile count or duration");
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const file = path.join(out, "samples.jsonl");
await fs.writeFile(file, "");
async function api(route, method = "GET", body) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  if (!r.ok) throw Error(`${route}: ${r.status}`);
  return d;
}
const ids = Array.from(
  { length: count },
  (_, i) => "profile-" + String(i + 1).padStart(2, "0"),
);
const initial = await api("/api/status");
if (initial.running)
  throw Error("Use an isolated fixture deployment with no running profiles");
for (const id of ids) {
  const p = initial.profiles.find((p) => p.id === id);
  if (p.url !== `https://fixture.invalid/${id}`)
    throw Error(
      "Every soak profile must already be assigned to the local fixture.invalid URL; refuses to overwrite real profile configuration",
    );
}
let start = Date.now(),
  clock = performance.now();
let previous = clock,
  previousWall = Date.now(),
  cpuSum = 0,
  ramSum = 0,
  samples = 0,
  failures = 0,
  maxGap = 0,
  completed = false,
  interrupted = false,
  error,
  peakRssMB = 0,
  minAvailableMB = Infinity,
  peakCpuPercent = 0,
  crashes = initial.crashes,
  latest;
process.once("SIGTERM", () => (interrupted = true));
process.once("SIGINT", () => (interrupted = true));
async function summary() {
  const result = {
    startedAt: new Date(start).toISOString(),
    updatedAt: new Date().toISOString(),
    requestedSeconds: seconds,
    elapsedSeconds: (performance.now() - clock) / 1000,
    completed,
    mode,
    count,
    samples,
    failures,
    maximumObservationGapMs: maxGap,
    peakRssMB,
    minAvailableMB: Number.isFinite(minAvailableMB) ? minAvailableMB : null,
    peakCpuPercent,
    meanCpuPercent: samples ? cpuSum / samples : 0,
    meanTreeRssMB: samples ? ramSum / samples : 0,
    fixturePageRequests: latest
      ? latest.fixtureRequests - initial.fixtureRequests
      : 0,
    browserUptimeSeconds: Math.max(0, (performance.now() - clock) / 1000),
    errorRate: samples ? failures / samples : 0,
    crashes: latest ? latest.crashes - crashes : 0,
    error,
    pass:
      completed &&
      !failures &&
      !interrupted &&
      samples >= Math.ceil(seconds / 10) * 0.95 &&
      maxGap <= 30000,
    nativeOracle: false,
    architecture: process.arch,
    claim:
      "Valid only for the actual measured host, fixture, mode and duration; never proof of Oracle capacity on another host",
  };
  const tmp = path.join(out, "summary.tmp");
  await fs.writeFile(tmp, JSON.stringify(result, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path.join(out, "summary.json"));
  return result;
}
try {
  for (const id of ids) {
    await api("/api/profiles/" + id, "PATCH", {
      autoReload: mode === "reload",
      ownerAcknowledged: true,
      minSeconds: Number(process.env.RELOAD_MIN_SECONDS || 120),
      maxSeconds: Number(process.env.RELOAD_MAX_SECONDS || 300),
    });
    await api("/api/profiles/" + id + "/start", "POST");
    await api("/test/" + id + "/seed", "POST", {});
  }
  start = Date.now();
  clock = performance.now();
  previous = clock;
  previousWall = Date.now();
  const ticks = new Map();
  await summary();
  while (performance.now() - clock < seconds * 1000 && !interrupted) {
    const now = performance.now(),
      gap = Math.max(now - previous, Date.now() - previousWall);
    if (Date.now() < previousWall) failures++;
    previousWall = Date.now();
    previous = now;
    maxGap = Math.max(maxGap, gap);
    let ok = gap <= 30000,
      reason;
    try {
      latest = await api("/api/status");
      if (
        latest.running !== count ||
        latest.resources.availableMB < latest.policy.reserveMB ||
        latest.resources.diskFreeMB < latest.policy.diskReserveMB ||
        latest.crashes > crashes
      )
        ok = false;
      for (const id of ids) {
        let p;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            p = await api("/test/" + id + "/probe", "POST", {});
            break;
          } catch (e) {
            if (attempt === 4) throw e;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        if (p.cookie !== id || p.owner !== id || p.geo !== "denied") ok = false;
        const prior = ticks.get(id);
        const profile = latest.profiles.find((p) => p.id === id);
        if (
          prior &&
          p.navigation === prior.navigation &&
          p.ticks <= prior.ticks
        )
          ok = false;
        ticks.set(id, { ticks: p.ticks, navigation: p.navigation });
      }
      cpuSum += latest.resources.cpuPercent;
      ramSum += latest.resources.treeRssMB;
      peakRssMB = Math.max(peakRssMB, latest.resources.treeRssMB);
      minAvailableMB = Math.min(minAvailableMB, latest.resources.availableMB);
      peakCpuPercent = Math.max(peakCpuPercent, latest.resources.cpuPercent);
    } catch (e) {
      ok = false;
      reason = e.message;
    }
    samples++;
    if (!ok) failures++;
    await fs.appendFile(
      file,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ok,
        reason,
        status: latest,
      }) + "\n",
    );
    await summary();
    await new Promise((r) =>
      setTimeout(
        r,
        Math.min(
          10000,
          Math.max(0, seconds * 1000 - (performance.now() - clock)),
        ),
      ),
    );
  }
  maxGap = Math.max(
    maxGap,
    performance.now() - previous,
    Date.now() - previousWall,
  );
  completed = !interrupted && performance.now() - clock >= seconds * 1000;
} catch (e) {
  error = e.message;
  failures++;
} finally {
  for (const id of ids)
    await api("/api/profiles/" + id + "/stop", "POST").catch(() => {});
  const result = await summary();
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
