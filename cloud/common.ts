import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { RequestHandler } from "express";
export async function secret(name: string) {
  const file = process.env[name + "_FILE"];
  const value = file
    ? (await fs.readFile(file, "utf8")).trim()
    : process.env[name] || "";
  if (value.length < 32)
    throw Error(
      `${name} must contain at least 32 characters (use a secret file)`,
    );
  return value;
}
export function auth(token: string): RequestHandler {
  return (req, res, next) => {
    const a = Buffer.from(
        (req.get("authorization") || "").replace(/^Bearer /, ""),
      ),
      b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
export const headers: RequestHandler = (_, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  });
  next();
};
export async function atomicJson(file: string, data: unknown) {
  await fs.writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
  const f = await fs.open(file + ".tmp", "r+");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
  await fs.rename(file + ".tmp", file);
}
export function codec(key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw Error("VAULT_KEY must be 32 bytes encoded as 64 hex characters");
  const k = Buffer.from(key, "hex");
  return {
    encode: (text: string) => {
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
      const body = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decode: (data: Buffer) => {
      const cipher = crypto.createDecipheriv(
        "aes-256-gcm",
        k,
        data.subarray(0, 12),
      );
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString();
    },
  };
}
export function ids(start: number, count: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    start < 1 ||
    count < 1 ||
    count > 10 ||
    start + count > 31
  )
    throw Error("Shard must contain 1–10 IDs in range 01–30");
  return Array.from(
    { length: count },
    (_, i) => `profile-${String(start + i).padStart(2, "0")}`,
  );
}
