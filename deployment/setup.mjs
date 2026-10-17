import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
const dir = path.resolve("deployment/.secrets");
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
await fs.chmod(dir, 0o700);
for (const name of [
  "admin-token",
  "cluster-token",
  "worker-1-token",
  "worker-2-token",
  "worker-3-token",
  "worker-1-key",
  "worker-2-key",
  "worker-3-key",
]) {
  try {
    const handle = await fs.open(path.join(dir, name), "wx", 0o444);
    await handle.writeFile(crypto.randomBytes(32).toString("hex") + "\n");
    await handle.close();
    console.log("Created", name);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    console.log("Preserved", name);
  }
}
console.log(
  "Secrets were not printed. Read deployment/.secrets/admin-token privately to sign in. Back up keys securely.",
);
