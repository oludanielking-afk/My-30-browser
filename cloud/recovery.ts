import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson } from "./common";
// Called only while the worker volume's kernel flock is held. Never remove
// Chromium SingletonLock files or terminate a process based on PID alone.
export async function recoverOwnedBrowsers(root: string, assigned: string[]) {
  const file = path.join(root, "owner.json");
  let owner: string;
  try {
    owner = JSON.parse(await fs.readFile(file, "utf8")).owner;
    if (!/^[a-f0-9]{64}$/.test(owner)) throw Error("Invalid owner identity");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    owner = crypto.randomBytes(32).toString("hex");
    await atomicJson(file, { owner });
  }
  let recovered = 0;
  for (const name of await fs.readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let birth: string, group: number;
    try {
      const args = (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).split(
        "\0",
      );
      if (
        !args.includes(`--mbam-worker-owner=${owner}`) ||
        !assigned.some((id) =>
          args.includes(`--user-data-dir=${path.join(root, "profiles", id)}`),
        )
      )
        continue;
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8"),
        fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      birth = fields[19];
      group = Number(fields[2]);
    } catch {
      continue;
    }
    const same = async () => {
      try {
        const text = await fs.readFile(`/proc/${pid}/stat`, "utf8");
        const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
        return fields[19] === birth && fields[0] !== "Z";
      } catch {
        return false;
      }
    };
    if (!(await same())) continue;
    try {
      process.kill(group === pid ? -pid : pid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 10000;
    while ((await same()) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    if (await same()) {
      try {
        process.kill(group === pid ? -pid : pid, "SIGKILL");
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    recovered++;
  }
  return { owner, recovered };
}
