import fs from "node:fs/promises";
import path from "node:path";
import type { Profile } from "./types";
import type { Cookie } from "playwright";
export function safeUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Enter an HTTPS URL without credentials");
  return u.href;
}
export function validate(p: Profile): Profile {
  if (!/^profile-(0[1-9]|[12][0-9]|30)$/.test(p.id))
    throw Error("Invalid profile");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80)
    throw Error("Name must contain 1–80 characters");
  if (
    typeof p.autoReload !== "boolean" ||
    !Number.isInteger(p.minSeconds) ||
    !Number.isInteger(p.maxSeconds) ||
    p.minSeconds < 120 ||
    p.maxSeconds > 300 ||
    p.minSeconds > p.maxSeconds
  )
    throw Error("Reload interval must be between 120 and 300 seconds");
  return { ...p, name: p.name.trim(), url: safeUrl(p.url) };
}
export class Store {
  profiles: Profile[] = [];
  maxActive = 5;
  private queue = Promise.resolve();
  constructor(
    public root: string,
    private encode: (s: string) => Buffer = (s) => Buffer.from(s),
    private decode: (b: Buffer) => string = (b) => b.toString(),
  ) {}
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      const x = JSON.parse(
        this.decode(await fs.readFile(path.join(this.root, "settings.bin"))),
      );
      if (!Array.isArray(x.profiles) || x.profiles.length !== 30)
        throw Error("Invalid settings");
      this.profiles = x.profiles.map(validate);
      if (new Set(this.profiles.map((p) => p.id)).size !== 30)
        throw Error("Duplicate profiles");
      this.maxActive = Math.max(1, Math.min(10, Number(x.maxActive) || 5));
    } catch (e: any) {
      if (e.code !== "ENOENT")
        throw Error(
          "Cannot read saved settings. Preserve settings.bin and restore a backup; no data was overwritten.",
        );
      this.profiles = Array.from({ length: 30 }, (_, i) =>
        validate({
          id: `profile-${String(i + 1).padStart(2, "0")}`,
          name: `Profile ${String(i + 1).padStart(2, "0")}`,
          url: "https://example.com/",
          autoReload: false,
          minSeconds: 120,
          maxSeconds: 300,
        }),
      );
      await this.save();
    }
  }
  save() {
    const data = this.encode(
      JSON.stringify({ profiles: this.profiles, maxActive: this.maxActive }),
    );
    const next = this.queue.then(async () => {
      const temp = path.join(this.root, "settings.tmp");
      await fs.writeFile(temp, data, { mode: 0o600 });
      const f = await fs.open(temp, "r+");
      try {
        await f.sync();
      } finally {
        await f.close();
      }
      await fs.rename(temp, path.join(this.root, "settings.bin"));
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async update(id: string, patch: Partial<Profile>) {
    const i = this.profiles.findIndex((p) => p.id === id);
    if (i < 0) throw Error("Unknown profile");
    const before = this.profiles[i];
    this.profiles[i] = validate({ ...before, ...patch, id });
    try {
      await this.save();
    } catch (e) {
      this.profiles[i] = before;
      throw e;
    }
  }
  private cookieFile(id: string) {
    if (!/^profile-(0[1-9]|[12][0-9]|30)$/.test(id))
      throw Error("Invalid profile");
    return path.join(this.root, `${id}-session.bin`);
  }
  async cookies(id: string): Promise<Cookie[]> {
    try {
      const data = JSON.parse(
        this.decode(await fs.readFile(this.cookieFile(id))),
      );
      if (!Array.isArray(data)) throw Error("Invalid cookie checkpoint");
      return data;
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw Error(
        "Cannot decrypt session checkpoint. Preserve your vault and restore a backup.",
      );
    }
  }
  async checkpoint(id: string, cookies: Cookie[]) {
    const file = this.cookieFile(id);
    const data = this.encode(
      JSON.stringify(cookies.filter((c) => c.expires === -1)),
    );
    const next = this.queue.then(async () => {
      await fs.writeFile(file + ".tmp", data, { mode: 0o600 });
      await fs.rename(file + ".tmp", file);
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
