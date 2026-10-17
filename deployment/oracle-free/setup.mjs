import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { preflight } from "./preflight.mjs";
await preflight(process.argv.includes("--allow-non-arm64-validation"));
const root = fileURLToPath(new URL(".secrets/", import.meta.url));
await fs.mkdir(root, { recursive: true, mode: 0o700 });
await fs.chmod(root, 0o700);
for (const name of ["admin-token", "vault-key"]) {
  try {
    await fs.writeFile(root + name, crypto.randomBytes(32).toString("hex"), {
      mode: 0o444,
      flag: "wx",
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}
console.log(
  "Stable secrets created or preserved; no values printed. Back up the private secret directory securely.",
);
