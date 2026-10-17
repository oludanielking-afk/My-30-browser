import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
export async function preflight(allowX64 = false) {
  const env = Object.fromEntries(
    (await fs.readFile(dir + ".env", "utf8"))
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const at = l.indexOf("=");
        return [l.slice(0, at), l.slice(at + 1)];
      }),
  );
  const requireNumber = (k) => {
    const n = Number(env[k]);
    if (!env[k] || !Number.isFinite(n) || n <= 0)
      throw Error(`Set ${k} to the actual verified value`);
    return n;
  };
  if (env.FREE_TIER_VERIFIED !== "yes")
    throw Error(
      "Verify current Oracle console free eligibility and set FREE_TIER_VERIFIED=yes",
    );
  const checked = Date.parse(env.ALLOWANCE_CHECKED_ON);
  if (
    !Number.isFinite(checked) ||
    checked > Date.now() ||
    Date.now() - checked > 7 * 86400000
  )
    throw Error("Allowance check must be dated within the past seven days");
  for (const [used, remaining] of [
    ["SELECTED_INSTANCE_OCPUS", "REMAINING_FREE_OCPUS"],
    ["SELECTED_INSTANCE_RAM_GB", "REMAINING_FREE_RAM_GB"],
    ["SELECTED_STORAGE_GB", "REMAINING_FREE_STORAGE_GB"],
  ])
    if (requireNumber(used) > requireNumber(remaining))
      throw Error(`${used} exceeds remaining verified free allowance`);
  const memory = /^(\d+(?:\.\d+)?)g$/.exec(env.MEMORY_LIMIT);
  if (!memory) throw Error("MEMORY_LIMIT must use GiB notation, e.g. 18g");
  if (requireNumber("CPU_LIMIT") > requireNumber("SELECTED_INSTANCE_OCPUS"))
    throw Error("Container CPU limit exceeds selected instance");
  if (Number(memory[1]) + 2 > requireNumber("SELECTED_INSTANCE_RAM_GB"))
    throw Error("Leave at least 2 GiB for OS and Docker");
  if (
    Number(memory[1]) * 1024 <
    Number(env.MEMORY_RESERVE_MB) + Number(env.BROWSER_BUDGET_MB) + 512
  )
    throw Error(
      "Container memory cannot accommodate reserve, startup allowance and one browser budget",
    );
  if (
    !Number.isInteger(Number(env.MAX_ACTIVE)) ||
    Number(env.MAX_ACTIVE) < 1 ||
    Number(env.MAX_ACTIVE) > 10
  )
    throw Error("MAX_ACTIVE must be 1–10");
  if (os.arch() !== "arm64" && !allowX64)
    throw Error(
      "Oracle production deployment requires native ARM64; this host is " +
        os.arch(),
    );
  if (process.platform !== "linux") throw Error("Linux required");
  if (
    !allowX64 &&
    (os.totalmem() / 2 ** 30 + 0.5 < Number(env.SELECTED_INSTANCE_RAM_GB) ||
      os.availableParallelism() < Number(env.CPU_LIMIT))
  )
    throw Error("Actual host resources do not match selected configuration");
  console.log(
    "Local configuration checks passed. This cannot verify Oracle billing, eligibility, egress, other account resources, or available regional capacity.",
  );
  return env;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await preflight(process.argv.includes("--allow-non-arm64-validation"));
