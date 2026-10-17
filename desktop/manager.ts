import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { Store } from "./store";
import { denyGeolocation } from "./permissions";
import type { Action, Profile, ProfileView, Snapshot } from "./types";
export const randomDelay = (min: number, max: number, r = Math.random()) =>
  Math.floor((min + r * (max - min)) * 1000);
export function mayReload(
  current: string,
  assigned: string,
  last: number,
  now: number,
) {
  return current === assigned && now - last >= 120000;
}
type Session = {
  context?: BrowserContext;
  page?: Page;
  timer?: NodeJS.Timeout;
  checkpoint?: NodeJS.Timeout;
  busy: boolean;
  stopping: boolean;
  last: number;
  failures: number;
  paused: boolean;
  next?: number;
};
export class Manager {
  live = new Map<string, Session>();
  status = new Map<string, Partial<ProfileView>>();
  private queue = Promise.resolve();
  private originLast = new Map<string, number>();
  constructor(
    public store: Store,
    private options: {
      headless?: boolean;
      executablePath?: string;
      minFreeMB?: number;
      browserArgs?: string[];
      beforeReload?: (origin: string) => Promise<boolean>;
      onIncident?: (id: string, kind: string) => void;
      prepareContext?: (context: BrowserContext) => Promise<void>;
    } = {},
  ) {}
  snapshot(): Snapshot {
    return {
      profiles: this.store.profiles.map((p) => ({
        ...p,
        state: "stopped",
        browserOpen: this.live.has(p.id),
        ...this.status.get(p.id),
        nextReload: this.live.get(p.id)?.next,
      })),
      running: this.live.size,
      maxActive: this.store.maxActive,
      memoryFreeMB: Math.floor(
        Math.min(os.freemem(), process.availableMemory?.() ?? Infinity) /
          1048576,
      ),
    };
  }
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const n = this.queue.then(fn, fn);
    this.queue = n.then(
      () => {},
      () => {},
    );
    return n;
  }
  action(id: string, action: Action) {
    return this.exclusive(async () => {
      const p = this.store.profiles.find((p) => p.id === id);
      if (!p) throw Error("Unknown profile");
      if (action === "start") return this.start(p);
      if (action === "stop") return this.stop(id);
      const s = this.live.get(id);
      if (!s || !s.page) throw Error("Start this profile first");
      if (action === "pause") {
        s.paused = true;
        this.clear(s);
        this.status.set(id, {
          state: "running",
          note: "Reload paused by user",
        });
        return;
      }
      if (action === "resume") {
        s.paused = false;
        s.failures = 0;
        this.schedule(p, s);
        return;
      }
      if (action === "reload") {
        await this.reload(p, s);
        this.schedule(p, s);
        return;
      }
      throw Error("Unknown action");
    });
  }
  clear(s: Session) {
    clearTimeout(s.timer);
    s.timer = undefined;
    s.next = undefined;
  }
  schedule(p: Profile, s: Session) {
    this.clear(s);
    if (!p.autoReload || s.paused || s.stopping) return;
    s.next = Date.now() + randomDelay(p.minSeconds, p.maxSeconds);
    s.timer = setTimeout(() => {
      void this.exclusive(async () => {
        if (this.live.get(p.id) !== s || s.stopping) return;
        try {
          await this.reload(p, s);
        } catch (e: any) {
          this.status.set(p.id, { state: "running", note: e.message });
        } finally {
          this.schedule(p, s);
        }
      });
    }, s.next - Date.now());
  }
  async reload(p: Profile, s: Session) {
    if (s.busy || s.stopping || !s.page) throw Error("Browser is busy");
    const now = Date.now(),
      origin = new URL(p.url).origin;
    if (!mayReload(s.page.url(), p.url, s.last, now))
      throw Error("Reload skipped: navigation changed or 120-second cooldown");
    if (now - (this.originLast.get(origin) || 0) < 30000)
      throw Error("Reload skipped: shared website 30-second rate limit");
    if (
      await s.page.evaluate(() => {
        const e = document.activeElement;
        return (
          !!e &&
          (e.matches("input,textarea,select") ||
            (e as HTMLElement).isContentEditable)
        );
      })
    )
      throw Error("Reload skipped: a form is being edited");
    if (this.options.beforeReload && !(await this.options.beforeReload(origin)))
      throw Error("Reload skipped: cluster origin rate limit");
    s.busy = true;
    s.last = now;
    this.originLast.set(origin, now);
    try {
      const response = await s.page.reload({
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      if (response && [429, 503].includes(response.status())) {
        s.paused = true;
        throw Error(
          "Server requested backoff. Reload paused; resume manually.",
        );
      }
      s.failures = 0;
      this.status.set(p.id, { state: "running", lastReload: now });
    } catch (e) {
      s.failures++;
      if (s.failures >= 3) s.paused = true;
      throw e;
    } finally {
      s.busy = false;
    }
  }
  async start(p: Profile) {
    if (this.live.has(p.id)) throw Error("Profile already open");
    if (this.live.size >= this.store.maxActive)
      throw Error(`Active browser limit (${this.store.maxActive}) reached`);
    if (
      Math.min(os.freemem(), process.availableMemory?.() ?? Infinity) /
        1048576 <
      (this.options.minFreeMB ?? 1024)
    )
      throw Error("Less than 1 GB free memory; close a browser first");
    const s: Session = {
      busy: true,
      stopping: false,
      last: Date.now(),
      failures: 0,
      paused: false,
    };
    this.live.set(p.id, s);
    this.status.set(p.id, { state: "starting" });
    try {
      const directory = path.join(this.store.root, "profiles", p.id);
      await denyGeolocation(directory);
      s.context = await chromium.launchPersistentContext(directory, {
        headless: this.options.headless ?? false,
        executablePath: this.options.executablePath,
        channel:
          process.platform === "win32" &&
          !this.options.executablePath &&
          !existsSync(chromium.executablePath())
            ? "msedge"
            : undefined,
        permissions: [],
        acceptDownloads: false,
        viewport: null,
        args: [
          "--disable-background-mode",
          "--deny-permission-prompts",
          ...(this.options.browserArgs || []),
        ],
      });
      const cdp = await s.context.newCDPSession(
        s.context.pages()[0] || (await s.context.newPage()),
      );
      await cdp.send("Browser.setPermission", {
        permission: { name: "geolocation" },
        setting: "denied",
      });
      await cdp.send("Browser.setPermission", {
        permission: { name: "geolocation" },
        setting: "denied",
        origin: new URL(p.url).origin,
        embeddedOrigin: new URL(p.url).origin,
      });
      await cdp.detach();
      await this.options.prepareContext?.(s.context);
      const cookies = await this.store.cookies(p.id);
      if (cookies.length) await s.context.addCookies(cookies);
      s.context.on("close", () => {
        this.clear(s);
        clearInterval(s.checkpoint);
        if (this.live.get(p.id) === s) {
          this.live.delete(p.id);
          if (!s.stopping)
            this.options.onIncident?.(p.id, "unexpected-browser-close");
          this.status.set(p.id, {
            state: "stopped",
            note: s.stopping
              ? "Browser closed"
              : "Browser closed unexpectedly or manually. Session retained; restart when ready.",
          });
        }
      });
      s.page = s.context.pages()[0] || (await s.context.newPage());
      s.page.on("crash", () => {
        this.options.onIncident?.(p.id, "tab-crash");
        s.paused = true;
        this.clear(s);
        this.status.set(p.id, {
          state: "error",
          error: "Tab crashed. Close and restart the profile to recover.",
        });
      });
      await s.page.goto(p.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await this.store.checkpoint(p.id, await s.context.cookies());
      s.checkpoint = setInterval(() => {
        void this.exclusive(async () => {
          if (s.stopping || this.live.get(p.id) !== s || !s.context) return;
          try {
            await this.store.checkpoint(p.id, await s.context.cookies());
          } catch {
            this.status.set(p.id, {
              state: "running",
              note: "Session checkpoint failed. Check free disk space and back up your vault.",
            });
          }
        });
      }, 30000);
      s.busy = false;
      this.status.set(p.id, { state: "running" });
      this.schedule(p, s);
    } catch (e: any) {
      s.stopping = true;
      this.clear(s);
      clearInterval(s.checkpoint);
      await s.context?.close().catch(() => {});
      this.live.delete(p.id);
      this.status.set(p.id, { state: "error", error: e.message });
      throw e;
    }
  }
  async stop(id: string) {
    const s = this.live.get(id);
    if (!s) return;
    s.stopping = true;
    this.clear(s);
    clearInterval(s.checkpoint);
    try {
      if (s.context) {
        try {
          await this.store.checkpoint(id, await s.context.cookies());
        } finally {
          await s.context.close();
        }
      }
    } finally {
      this.live.delete(id);
      this.status.set(id, { state: "stopped" });
    }
  }
  async close() {
    await this.exclusive(async () => {
      for (const id of this.live.keys()) {
        try {
          await this.stop(id);
        } catch (e: any) {
          this.status.set(id, { state: "error", error: e.message });
        }
      }
    });
  }
}
