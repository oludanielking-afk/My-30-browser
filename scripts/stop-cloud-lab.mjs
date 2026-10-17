import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw Error("Provide the laboratory report directory");
const owner = JSON.parse(
  await fs.readFile(path.join(root, "harness.json"), "utf8"),
);
let live = false;
try {
  const text = await fs.readFile(`/proc/${owner.pid}/stat`, "utf8"),
    fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  const args = (await fs.readFile(`/proc/${owner.pid}/cmdline`, "utf8")).split(
    "\0",
  );
  live =
    fields[19] === owner.startTicks &&
    fields[0] !== "Z" &&
    args.some((a) => a.endsWith("scripts/cloud-lab.mjs"));
} catch {}
if (process.argv.includes("--status")) {
  let summary;
  try {
    summary = JSON.parse(
      await fs.readFile(path.join(root, "summary.json"), "utf8"),
    );
  } catch {}
  console.log(JSON.stringify({ live, summary }, null, 2));
} else if (live) {
  process.kill(owner.pid, "SIGTERM");
  console.log(
    "Requested graceful shutdown of the verified laboratory and its own workers",
  );
} else
  throw Error(
    "Original laboratory is no longer running; no process was signaled",
  );
