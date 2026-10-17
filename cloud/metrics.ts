import fs from "node:fs/promises";
import os from "node:os";
export class Metrics {
  private previous?: { cpu: number; tree: number; time: number };
  async sample() {
    let processes: { pid: number; ppid: number; rss: number; cpu: number }[] =
      [];
    for (const pid of await fs.readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const text = await fs.readFile(`/proc/${pid}/stat`, "utf8"),
          p = text.slice(text.lastIndexOf(")") + 2).split(" ");
        processes.push({
          pid: Number(pid),
          ppid: Number(p[1]),
          rss: Number(p[21]) * 4096,
          cpu: (Number(p[11]) + Number(p[12])) / 100,
        });
      } catch {}
    }
    const children = new Set([process.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of processes)
        if (children.has(p.ppid) && !children.has(p.pid)) {
          children.add(p.pid);
          changed = true;
        }
    }
    const own = processes.filter((p) => children.has(p.pid));
    let cpu = own.reduce((n, p) => n + p.cpu, 0),
      memory = own.reduce((n, p) => n + p.rss, 0),
      scope = "process-tree";
    const tree = cpu;
    let cgroupIdentity: string | undefined;
    let limitMB: number | undefined,
      usedMB: number | undefined,
      quotaCores: number | undefined;
    try {
      const base = "/sys/fs/cgroup";
      const identity = await fs.stat(base);
      cgroupIdentity = `${identity.dev}:${identity.ino}`;
      const stat = await fs.readFile(base + "/cpu.stat", "utf8");
      cpu = Number(stat.match(/usage_usec (\d+)/)?.[1]) / 1e6;
      scope = "cgroup-v2";
      usedMB =
        Number(await fs.readFile(base + "/memory.current", "utf8")) / 1048576;
      const max = (await fs.readFile(base + "/memory.max", "utf8")).trim();
      if (max !== "max") limitMB = Number(max) / 1048576;
      const [quota, period] = (await fs.readFile(base + "/cpu.max", "utf8"))
        .trim()
        .split(" ");
      if (quota !== "max") quotaCores = Number(quota) / Number(period);
    } catch {}
    const now = performance.now() / 1000,
      percent = this.previous
        ? Math.max(
            0,
            ((cpu - this.previous.cpu) / (now - this.previous.time)) * 100,
          )
        : 0;
    const treePercent = this.previous
      ? Math.max(
          0,
          ((tree - this.previous.tree) / (now - this.previous.time)) * 100,
        )
      : 0;
    this.previous = { cpu, tree, time: now };
    return {
      timestamp: Date.now(),
      cpuPercent: percent,
      treeCpuPercent: treePercent,
      cpuScope: scope,
      cgroupIdentity,
      cpuQuotaCores: quotaCores,
      treeRssMB: memory / 1048576,
      cgroupUsedMB: usedMB,
      memoryLimitMB: limitMB,
      processes: own.length,
      freeMB:
        Math.min(os.freemem(), process.availableMemory?.() ?? Infinity) /
        1048576,
    };
  }
}
