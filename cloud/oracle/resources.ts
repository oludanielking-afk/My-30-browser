import fs from "node:fs/promises";
import os from "node:os";
import { Metrics } from "../metrics";
export const MiB = 1048576;
export type Resources = Awaited<ReturnType<ResourceMonitor["sample"]>>;
async function read(name: string) {
  try {
    return (await fs.readFile("/sys/fs/cgroup/" + name, "utf8")).trim();
  } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
}
export class ResourceMonitor {
  private metrics = new Metrics();
  private previous?: { used: number; total: number };
  async sample(root: string) {
    const [m, mem, cpu, max, used, quota, disk] = await Promise.all([
      this.metrics.sample(),
      fs.readFile("/proc/meminfo", "utf8"),
      fs.readFile("/proc/stat", "utf8"),
      read("memory.max"),
      read("memory.current"),
      read("cpu.max"),
      fs.statfs(root),
    ]);
    const totalMB = Number(mem.match(/MemTotal:\s+(\d+)/)?.[1]) / 1024;
    const hostAvailableMB =
      Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1]) / 1024;
    const memoryLimitMB = max && max !== "max" ? Number(max) / MiB : totalMB;
    const cgroupUsedMB = used === undefined ? undefined : Number(used) / MiB;
    const availableMB = Math.max(
      0,
      Math.min(
        hostAvailableMB,
        process.availableMemory() / MiB,
        cgroupUsedMB === undefined ? Infinity : memoryLimitMB - cgroupUsedMB,
      ),
    );
    const fields = cpu.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    const total = fields.slice(0, 8).reduce((a, b) => a + b, 0),
      busy = total - fields[3] - fields[4];
    const hostCpuPercent = this.previous
      ? (100 * (busy - this.previous.used)) /
        Math.max(1, total - this.previous.total)
      : 0;
    this.previous = { used: busy, total };
    const q = quota?.split(/\s+/);
    const cores =
      q && q[0] !== "max"
        ? Math.min(os.availableParallelism(), Number(q[0]) / Number(q[1]))
        : os.availableParallelism();
    const cpuPercent =
      m.cpuScope === "cgroup-v2" && q && q[0] !== "max"
        ? m.cpuPercent / cores
        : hostCpuPercent;
    return {
      ...m,
      totalMB,
      hostAvailableMB,
      availableMB,
      memoryLimitMB,
      cgroupUsedMB,
      cores,
      cpuPercent,
      hostCpuPercent,
      architecture: process.arch,
      diskFreeMB: (disk.bavail * disk.bsize) / MiB,
      diskTotalMB: (disk.blocks * disk.bsize) / MiB,
    };
  }
}
export type Policy = {
  configured: number;
  calibrated: number;
  reserveMB: number;
  diskReserveMB: number;
  perBrowserMB: number;
  startupMB: number;
  cpuCeiling: number;
};
export function permittedLimit(p: Policy, r: Resources, active: number) {
  const memorySlots =
    active +
    Math.floor((r.availableMB - p.reserveMB - p.startupMB) / p.perBrowserMB);
  return Math.max(0, Math.min(p.configured, p.calibrated, memorySlots));
}
export function admissionReason(
  p: Policy,
  r: Resources,
  active: number,
  cpuPressure: number,
) {
  if (r.diskFreeMB < p.diskReserveMB)
    return "Free disk space is below the configured safety reserve";
  if (r.availableMB < p.reserveMB + p.startupMB + p.perBrowserMB)
    return "Available memory is below the launch safety reserve and startup allowance";
  if (cpuPressure >= 3)
    return "Sustained CPU pressure is above the safety threshold";
  if (active >= permittedLimit(p, r, active))
    return "Resource-aware active-browser limit reached (capacity calibration may be required)";
  return undefined;
}
export function policyFromEnv(): Policy {
  const number = (key: string, fallback: number, low: number, high: number) => {
    const n = Number(process.env[key] ?? fallback);
    if (!Number.isFinite(n) || n < low || n > high)
      throw Error(`Invalid ${key}`);
    return n;
  };
  return {
    configured: number("MAX_ACTIVE", 3, 1, 10),
    calibrated: 1,
    reserveMB: number("MEMORY_RESERVE_MB", 1536, 1536, 1048576),
    diskReserveMB: number("DISK_RESERVE_MB", 2048, 512, 1048576),
    perBrowserMB: number("BROWSER_BUDGET_MB", 1024, 512, 65536),
    startupMB: number("STARTUP_ALLOWANCE_MB", 512, 256, 65536),
    cpuCeiling: number("CPU_CEILING_PERCENT", 85, 25, 95),
  };
}
