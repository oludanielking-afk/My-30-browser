// Two equal-duration, sequential fixture runs. Never targets public websites.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const out = path.resolve(
    process.env.REPORT_DIR || "reports/oracle-free/comparison",
  ),
  duration = process.env.DURATION_SECONDS || "600";
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const results = {};
for (const mode of ["idle", "reload"]) {
  const dir = path.join(out, mode);
  const child = spawn(process.execPath, ["tools/soak-test.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      MODE: mode,
      DURATION_SECONDS: duration,
      REPORT_DIR: dir,
    },
  });
  const exit = await new Promise((r, j) => {
    child.on("error", j);
    child.on("exit", r);
  });
  results[mode] = JSON.parse(
    await fs.readFile(path.join(dir, "summary.json"), "utf8"),
  );
  if (exit !== 0) throw Error(`${mode} failed; comparison is incomplete`);
}
await fs.writeFile(
  path.join(out, "comparison.json"),
  JSON.stringify(
    {
      completed: true,
      durationSeconds: Number(duration),
      results,
      limitations: [
        "Sequential light-fixture runs, not real-site presence or engagement tests",
        "Idle first, reload second; time-of-day/host-load ordering effects remain",
        "RSS includes duplicated shared pages",
      ],
    },
    null,
    2,
  ),
);
