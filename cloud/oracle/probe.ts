import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Store } from "../../desktop/store";
import { Manager } from "../../desktop/manager";
import { codec, atomicJson } from "../common";
import { ResourceMonitor, policyFromEnv, admissionReason } from "./resources";
export async function runProbe() {
  const out = path.resolve(process.env.REPORT_DIR || "reports/oracle-free"),
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-capacity-"));
  await fs.mkdir(out, { recursive: true, mode: 0o700 });
  const key = codec(crypto.randomBytes(32).toString("hex")),
    store = new Store(root, key.encode, key.decode);
  await store.init();
  store.maxActive = 10;
  const policy = policyFromEnv();
  policy.calibrated = 10;
  policy.configured = Number(process.env.PROBE_MAX || 3);
  const seconds = Number(process.env.STEP_SECONDS || 60);
  if (
    !Number.isInteger(seconds) ||
    seconds < 30 ||
    seconds > 3600 ||
    !Number.isInteger(policy.configured) ||
    policy.configured < 1 ||
    policy.configured > 10
  )
    throw Error("Probe requires 30–3600 second steps, 1–10 profiles");
  const monitor = new ResourceMonitor(),
    baseline = await monitor.sample(root);
  let crashes = 0,
    requests = 0;
  const manager = new Manager(store, {
    headless: false,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || process.env.TEST_CHROMIUM || undefined,
    chromiumSandbox: true,
    minFreeMB: policy.reserveMB,
    onIncident: () => crashes++,
    prepareContext: async (c) => {
      await c.route("https://fixture.invalid/**", async (r) => {
        requests++;
        await r.fulfill({
          contentType: "text/html",
          body: '<!doctype html><title>Neutral capacity fixture</title><output>0</output><script>let n=0;setInterval(()=>{const until=performance.now()+2;while(performance.now()<until){};document.querySelector("output").textContent=++n},1000)</script>',
        });
      });
    },
  });
  const samples: any[] = [],
    steps: any[] = [],
    failedLaunches: any[] = [];
  let maximumSuccessful = 0,
    stopped = false,
    interrupted = false;
  const interrupt = () => {
    interrupted = true;
    stopped = true;
  };
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  await fs.writeFile(path.join(out, "capacity-samples.jsonl"), "");
  let probeError: string | undefined;
  const startedAt = new Date().toISOString();
  try {
    for (let n = 1; n <= policy.configured && !stopped; n++) {
      const before = await monitor.sample(root),
        why = admissionReason(policy, before, manager.live.size, 0);
      if (why) {
        steps.push({ count: n, admitted: false, reason: why });
        break;
      }
      const id = store.profiles[n - 1].id;
      await store.update(id, {
        url: `https://fixture.invalid/${id}`,
        autoReload: process.env.PROBE_MODE === "reload",
        minSeconds: 120,
        maxSeconds: 120,
      });
      const start = performance.now();
      let launching = true;
      const startupSamples: any[] = [];
      const observeStartup = (async () => {
        while (launching) {
          startupSamples.push({
            timestamp: new Date().toISOString(),
            phase: "startup",
            count: manager.live.size,
            resources: await monitor.sample(root),
            profiles: [],
            functional: null,
            crashes,
            requests,
          });
          await new Promise((r) => setTimeout(r, 500));
        }
      })();
      let launched = false,
        startupMs = 0;
      try {
        await manager.action(id, "start");
        launched = true;
        startupMs = performance.now() - start;
      } catch (e: any) {
        failedLaunches.push({
          count: n,
          error:
            "Chromium launch failed; inspect environment and sandbox support",
        });
      } finally {
        launching = false;
        await observeStartup;
      }
      samples.push(...startupSamples);
      for (const sample of startupSamples)
        await fs.appendFile(
          path.join(out, "capacity-samples.jsonl"),
          JSON.stringify(sample) + "\n",
        );
      if (!launched) break;
      const end = Date.now() + seconds * 1000;
      let ok = !startupSamples.some(
          (s) => s.resources.availableMB < policy.reserveMB,
        ),
        pressure = 0,
        observations = 0,
        maxGap = 0,
        lastTime = Date.now();
      const ticks = new Map<string, { ticks: number; navigation: number }>();
      while (Date.now() < end && !stopped) {
        const now = Date.now();
        maxGap = Math.max(maxGap, now - lastTime);
        lastTime = now;
        const r = await monitor.sample(root);
        pressure = r.cpuPercent > policy.cpuCeiling ? pressure + 1 : 0;
        let functional = true;
        const perProfile: any[] = [];
        for (const [pid, s] of manager.live) {
          try {
            const value = await Promise.race([
              s.page!.evaluate(() => ({
                ticks: Number(document.querySelector("output")!.textContent),
                navigation: performance.timeOrigin,
              })),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(Error("Fixture probe timed out")),
                  2500,
                ),
              ),
            ]);
            const prior = ticks.get(pid);
            if (
              prior &&
              value.navigation === prior.navigation &&
              value.ticks <= prior.ticks
            )
              functional = false;
            ticks.set(pid, value);
            perProfile.push({ id: pid, responsive: true });
          } catch {
            functional = false;
            perProfile.push({ id: pid, responsive: false });
          }
        }
        // Group only exact owned user-data-dir trees; shared pages in RSS are not unique RAM.
        const proc = await processTrees(root);
        for (const p of perProfile) {
          p.treeRssMB = proc[p.id]?.rssMB ?? 0;
          p.processes = proc[p.id]?.processes ?? 0;
        }
        const sample = {
          timestamp: new Date().toISOString(),
          count: manager.live.size,
          resources: r,
          profiles: perProfile,
          functional,
          crashes,
          requests,
        };
        samples.push(sample);
        observations++;
        await fs.appendFile(
          path.join(out, "capacity-samples.jsonl"),
          JSON.stringify(sample) + "\n",
          { mode: 0o600 },
        );
        if (
          r.availableMB < policy.reserveMB ||
          r.diskFreeMB < policy.diskReserveMB ||
          pressure >= 3 ||
          !functional ||
          crashes ||
          manager.live.size !== n ||
          maxGap > 15000
        ) {
          ok = false;
          stopped = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      const lastGap = Date.now() - lastTime;
      maxGap = Math.max(maxGap, lastGap);
      ok =
        ok &&
        !interrupted &&
        maxGap <= 15000 &&
        observations >= Math.ceil(seconds / 2) * 0.9;
      steps.push({
        count: n,
        startupMs,
        successful: ok,
        observations,
        maximumObservationGapMs: maxGap,
        holdSeconds: seconds,
      });
      if (ok) maximumSuccessful = n;
      else break;
    }
  } catch (e: any) {
    probeError =
      "Probe failed; inspect sandbox, display and resource environment";
    interrupted = true;
  } finally {
    await manager.close();
    await fs.rm(root, { recursive: true, force: true });
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
  }
  const recommendedLimit = Math.max(
    0,
    maximumSuccessful > 1 ? maximumSuccessful - 1 : maximumSuccessful,
  );
  const result = {
    completed: !interrupted,
    probeError,
    architecture: process.arch,
    environment: baseline,
    startedAt,
    finishedAt: new Date().toISOString(),
    measuredSecondsPerStep: seconds,
    reserveMB: policy.reserveMB,
    cpuCeiling: policy.cpuCeiling,
    maximumSuccessful,
    recommendedLimit,
    steps,
    failedLaunches,
    crashes,
    requests,
    mode: process.env.PROBE_MODE === "reload" ? "reload" : "idle",
    samples: samples.length,
    peakTreeRssMB: Math.max(0, ...samples.map((s) => s.resources.treeRssMB)),
    minimumAvailableMB: Math.min(
      baseline.availableMB,
      ...samples.map((s) => s.resources.availableMB),
    ),
    limitations: [
      "Controlled light fixture only",
      "Summed process RSS double counts shared pages",
      "Not a 24-hour or real-website validation",
      "x64 or emulated ARM measurements are not Oracle Ampere evidence",
    ],
  };
  await atomicJson(path.join(out, "capacity-results.json"), result);
  await fs.writeFile(
    path.join(out, "capacity-results.csv"),
    "timestamp,count,cpu_percent,available_mib,tree_rss_mib,disk_free_mib,functional,crashes,requests\n" +
      samples
        .map((s) =>
          [
            s.timestamp,
            s.count,
            s.resources.cpuPercent,
            s.resources.availableMB,
            s.resources.treeRssMB,
            s.resources.diskFreeMB,
            s.functional,
            s.crashes,
            s.requests,
          ].join(","),
        )
        .join("\n") +
      (samples.length ? "\n" : ""),
  );
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(
      "::notice title=Controlled ARM64 capacity fixture::" +
        JSON.stringify({
          architecture: process.arch,
          maximumSuccessful,
          recommendedLimit,
          measuredSecondsPerStep: seconds,
          peakTreeRssMB: result.peakTreeRssMB,
          minimumAvailableMB: result.minimumAvailableMB,
          crashes,
          nativeOracle: false,
        }),
    );
  if (!recommendedLimit || interrupted) process.exitCode = 1;
  return result;
}
async function processTrees(root: string) {
  const processes: { pid: number; ppid: number; rssMB: number; id?: string }[] =
    [];
  for (const id of await fs.readdir("/proc")) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const [text, args] = await Promise.all([
        fs.readFile(`/proc/${id}/stat`, "utf8"),
        fs.readFile(`/proc/${id}/cmdline`, "utf8"),
      ]);
      const f = text.slice(text.lastIndexOf(")") + 2).split(" ");
      const dir = args
        .split("\0")
        .find((a) =>
          a.startsWith("--user-data-dir=" + path.join(root, "profiles") + "/"),
        );
      processes.push({
        pid: Number(id),
        ppid: Number(f[1]),
        rssMB: (Number(f[21]) * 4096) / 1048576,
        id: dir
          ? path.basename(dir.slice("--user-data-dir=".length))
          : undefined,
      });
    } catch {}
  }
  const result: Record<string, { rssMB: number; processes: number }> = {};
  for (const p of processes.filter((p) => p.id)) {
    const set = new Set([p.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of processes)
        if (set.has(q.ppid) && !set.has(q.pid)) {
          set.add(q.pid);
          changed = true;
        }
    }
    const own = processes.filter((q) => set.has(q.pid));
    result[p.id!] = {
      rssMB: own.reduce((n, q) => n + q.rssMB, 0),
      processes: own.length,
    };
  }
  return result;
}
if (require.main === module)
  void runProbe().catch((e) => {
    console.error("Capacity probe failed:", e.message);
    process.exitCode = 1;
  });
