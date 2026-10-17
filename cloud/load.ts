import fs from "node:fs/promises";
import path from "node:path";
import { secret, atomicJson } from "./common";
import { verify } from "./verify";
export async function load(
  url: string,
  token: string,
  duration: number,
  out: string,
) {
  if (!Number.isFinite(duration) || duration < 60 || duration > 172800)
    throw Error("DURATION_SECONDS must be 60–172800");
  await fs.mkdir(out, { recursive: true, mode: 0o700 });
  const start = Date.now(),
    finish = start + duration * 1000;
  let samples = 0,
    failures = 0,
    maxRunning = 0,
    minimumRunning = 30;
  const rss: number[] = [],
    cpu: number[] = [],
    cgroupMemory: number[] = [];
  const file = path.join(out, "samples.jsonl");
  await fs.writeFile(file, "");
  const summary = async (completed: boolean) => {
    const sorted = [...rss].sort((a, b) => a - b);
    await atomicJson(path.join(out, "summary.json"), {
      startedAt: new Date(start).toISOString(),
      updatedAt: new Date().toISOString(),
      requestedSeconds: duration,
      elapsedSeconds: (Date.now() - start) / 1000,
      completed,
      samples,
      failedSamples: failures,
      minimumRunning,
      maximumRunning: maxRunning,
      peakWorkerTreeRssMB: Math.max(0, ...rss),
      p95WorkerTreeRssMB: sorted[Math.floor(sorted.length * 0.95)] || 0,
      peakCpuPercent: Math.max(0, ...cpu),
      p95CpuPercent:
        [...cpu].sort((a, b) => a - b)[Math.floor(cpu.length * 0.95)] || 0,
      peakDistinctCgroupMemoryMB: Math.max(0, ...cgroupMemory),
      claim:
        completed && failures === 0
          ? "Passed only for this measured fixture workload and duration"
          : "Not validated: incomplete run or failed samples",
    });
  };
  await summary(false);
  while (Date.now() < finish) {
    try {
      const s = await verify(url, token);
      samples++;
      maxRunning = Math.max(maxRunning, s.running);
      minimumRunning = Math.min(minimumRunning, s.running);
      rss.push(
        s.workers.reduce((n: number, w: any) => n + w.resources.treeRssMB, 0),
      );
      cpu.push(
        s.workers.reduce(
          (n: number, w: any) => n + (w.resources.treeCpuPercent ?? 0),
          0,
        ),
      );
      const groups = new Map<string, number>();
      for (const w of s.workers) {
        const r = w.resources;
        if (r.cgroupIdentity && r.cgroupUsedMB)
          groups.set(
            r.cgroupIdentity,
            Math.max(groups.get(r.cgroupIdentity) || 0, r.cgroupUsedMB),
          );
      }
      cgroupMemory.push([...groups.values()].reduce((a, b) => a + b, 0));
      await fs.appendFile(file, JSON.stringify(s) + "\n");
    } catch (e: any) {
      failures++;
      minimumRunning = 0;
      await fs.appendFile(
        file,
        JSON.stringify({ timestamp: Date.now(), error: e.message }) + "\n",
      );
    }
    await summary(false);
    await new Promise((r) =>
      setTimeout(r, Math.min(10000, Math.max(0, finish - Date.now()))),
    );
  }
  await summary(true);
  if (failures || !samples)
    throw Error(`${failures} failed samples in load run`);
}
if (require.main === module)
  void (async () => {
    await load(
      process.env.COORDINATOR_URL || "http://127.0.0.1:3000",
      await secret("ADMIN_TOKEN"),
      Number(process.env.DURATION_SECONDS || 300),
      path.resolve(process.env.REPORT_DIR || "reports/local-load"),
    );
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
