import { spawnSync } from "node:child_process";
import path from "node:path";
const result = spawnSync(
  process.execPath,
  ["node_modules/playwright/cli.js", "install", "chromium"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_HOST_PLATFORM: "win64",
      PLAYWRIGHT_BROWSERS_PATH: path.resolve("windows-browsers"),
    },
  },
);
process.exit(result.status ?? 1);
