import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { Store } from "../../desktop/store";
import { Manager } from "../../desktop/manager";
import type { Action } from "../../desktop/types";
import { auth, codec, headers, secret } from "../common";
import { recoverOwnedBrowsers } from "../recovery";
import {
  ResourceMonitor,
  policyFromEnv,
  permittedLimit,
  admissionReason,
} from "./resources";
import { viewer } from "./viewer";
import { disablePasswordSaving } from "./privacy";
type RecordState = {
  ownerAcknowledged: boolean;
  notes: string;
  reloadPaused: boolean;
  lastLaunch?: number;
  lastReload?: number;
  reloadCount: number;
  lastError?: string;
  attempts: number;
  nextAttempt: number;
  blocked: boolean;
};
type State = {
  desired: string[];
  records: Record<string, RecordState>;
  events: { id: string; kind: string; time: number }[];
  crashes: number;
};
const blank = (): RecordState => ({
  ownerAcknowledged: false,
  notes: "",
  reloadPaused: false,
  reloadCount: 0,
  attempts: 0,
  nextAttempt: 0,
  blocked: false,
});
export async function startOracle() {
  const root = path.resolve(process.env.DATA_DIR || "data/oracle-free");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const token = await secret("ADMIN_TOKEN"),
    vault = codec(await secret("VAULT_KEY"));
  const store = new Store(root, vault.encode, vault.decode);
  await store.init();
  const assigned = store.profiles.map((p) => p.id),
    ownership = await recoverOwnedBrowsers(root, assigned);
  const stateFile = path.join(root, "oracle-state.bin");
  let state: State = {
    desired: [],
    records: Object.fromEntries(assigned.map((id) => [id, blank()])),
    events: [],
    crashes: 0,
  };
  try {
    state = JSON.parse(vault.decode(await fs.readFile(stateFile)));
    if (
      !Array.isArray(state.desired) ||
      new Set(state.desired).size !== state.desired.length ||
      state.desired.some((id) => !assigned.includes(id)) ||
      !state.records ||
      Object.keys(state.records).length !== 30 ||
      !Array.isArray(state.events) ||
      !Number.isInteger(state.crashes) ||
      state.crashes < 0
    )
      throw Error("Invalid state");
    for (const id of assigned) {
      const r = state.records[id];
      if (
        !r ||
        typeof r.ownerAcknowledged !== "boolean" ||
        typeof r.reloadPaused !== "boolean" ||
        typeof r.notes !== "string" ||
        r.notes.length > 2000 ||
        !Number.isInteger(r.reloadCount) ||
        r.reloadCount < 0 ||
        !Number.isInteger(r.attempts) ||
        r.attempts < 0 ||
        r.attempts > 3 ||
        !Number.isFinite(r.nextAttempt) ||
        r.nextAttempt < 0 ||
        typeof r.blocked !== "boolean"
      )
        throw Error("Invalid state");
    }
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw Error(
        "Invalid or undecryptable Oracle state: restore a backup; not overwritten",
      );
  }
  let writes = Promise.resolve();
  const save = () => {
    const data = vault.encode(JSON.stringify(state));
    const next = writes.then(async () => {
      await fs.writeFile(stateFile + ".tmp", data, { mode: 0o600 });
      const f = await fs.open(stateFile + ".tmp", "r+");
      try {
        await f.sync();
      } finally {
        await f.close();
      }
      await fs.rename(stateFile + ".tmp", stateFile);
    });
    writes = next.catch(() => {});
    return next;
  };
  const monitor = new ResourceMonitor(),
    policy = policyFromEnv();
  const calibrationFile =
    process.env.CAPACITY_FILE || path.join(root, "capacity-results.json");
  let calibration =
    "Uncalibrated: one-profile pilot ceiling; not a proven Oracle capacity";
  try {
    const c = JSON.parse(await fs.readFile(calibrationFile, "utf8"));
    if (
      c.completed === true &&
      c.architecture === process.arch &&
      Number.isInteger(c.recommendedLimit) &&
      c.recommendedLimit >= 1 &&
      c.recommendedLimit <= 10 &&
      c.reserveMB >= policy.reserveMB &&
      c.cpuCeiling <= policy.cpuCeiling &&
      c.measuredSecondsPerStep >= 30 &&
      Date.now() - Date.parse(c.finishedAt) < 30 * 86400000
    ) {
      const current = await monitor.sample(root);
      if (
        current.memoryLimitMB >= c.environment.memoryLimitMB * 0.95 &&
        current.cores >= c.environment.cores
      ) {
        policy.calibrated = c.recommendedLimit;
        calibration =
          "Accepted local controlled-fixture calibration (not a real-site guarantee)";
      }
    }
  } catch (e: any) {
    if (e.code !== "ENOENT")
      calibration =
        "Calibration unreadable or invalid; one-profile pilot ceiling";
  }
  let resources = await monitor.sample(root),
    cpuPressure = 0,
    lowMemorySamples = 0,
    closing = false,
    working = false,
    pending = 0;
  let chain = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    if (pending >= 32) return Promise.reject<T>(Error("Control queue full"));
    pending++;
    const n = chain.then(fn, fn).finally(() => pending--);
    chain = n.then(
      () => {},
      () => {},
    );
    return n;
  };
  function event(id: string, kind: string) {
    state.events.push({ id, kind, time: Date.now() });
    state.events = state.events.slice(-100);
  }
  const test = process.env.MBAM_TEST_MODE === "1";
  if (test && process.env.NODE_ENV !== "test")
    throw Error("Fixture instrumentation requires NODE_ENV=test");
  const pageHealth = new Map<
    string,
    { responsive: boolean; checkedAt: number }
  >();
  let fixtureRequests = 0;
  const manager = new Manager(store, {
    headless: false,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    minFreeMB: policy.reserveMB,
    chromiumSandbox: true,
    exponentialReloadBackoff: true,
    browserArgs: [`--mbam-worker-owner=${ownership.owner}`],
    beforeStart: async (id) => {
      if (!state.records[id].ownerAcknowledged)
        throw Error("Owner authorization acknowledgement is required");
      resources = await monitor.sample(root);
      store.maxActive = permittedLimit(policy, resources, manager.live.size);
      const why = admissionReason(
        policy,
        resources,
        manager.live.size,
        cpuPressure,
      );
      if (why) {
        state.records[id].lastError = why;
        event(id, "resource-blocked");
        await save();
        throw Error(`${id} could not start: ${why}`);
      }
      await disablePasswordSaving(path.join(root, "profiles", id));
    },
    onLaunch: (id) => {
      state.records[id].lastLaunch = Date.now();
      state.records[id].lastError = undefined;
      event(id, "launched");
      void save().catch(() => {});
    },
    onReload: (id, time, ok) => {
      const r = state.records[id];
      r.lastReload = time;
      r.reloadCount++;
      if (!ok) r.lastError = "Reload failed or server requested backoff";
      event(id, ok ? "reload" : "reload-failed");
      void save().catch(() => {});
    },
    onIncident: (id, kind) => {
      state.crashes++;
      state.records[id].lastError = kind;
      event(id, kind);
      void save().catch(() => {});
    },
    prepareContext: test
      ? async (c) => {
          await c.route("https://fixture.invalid/**", async (route) => {
            fixtureRequests++;
            const id = new URL(route.request().url()).pathname.slice(1);
            if (!assigned.includes(id)) {
              await route.abort();
              return;
            }
            await route.fulfill({
              contentType: "text/html",
              body: `<!doctype html><title>Oracle authorized fixture</title><input aria-label="Test input"><output id="ticks">0</output><script>let n=0;setInterval(()=>document.querySelector('output').textContent=++n,1000)</script>`,
            });
          });
        }
      : undefined,
  });
  store.maxActive = Math.max(1, Math.min(policy.configured, policy.calibrated));
  async function cycle() {
    if (working || closing) return;
    working = true;
    try {
      resources = await monitor.sample(root);
      cpuPressure =
        resources.cpuPercent >= policy.cpuCeiling ? cpuPressure + 1 : 0;
      lowMemorySamples =
        resources.availableMB < policy.reserveMB ? lowMemorySamples + 1 : 0;
      store.maxActive = permittedLimit(policy, resources, manager.live.size);
      await serial(async () => {
        if (lowMemorySamples >= 3 && manager.live.size) {
          const id = [...manager.live.keys()].at(-1)!;
          state.desired = state.desired.filter((x) => x !== id);
          state.records[id].lastError =
            "Safety stop: memory reserve breached; manual review required";
          event(id, "low-memory-safety-stop");
          await save();
          await manager.action(id, "stop");
          return;
        }
        for (const id of state.desired) {
          const r = state.records[id],
            s = manager.snapshot().profiles.find((p) => p.id === id)!;
          if (
            s.state === "running" ||
            s.state === "starting" ||
            r.blocked ||
            r.nextAttempt > Date.now()
          )
            continue;
          // A crashed context still consumes its slot. Close only that profile
          // before checking whether its replacement can be admitted.
          if (manager.live.has(id)) await manager.action(id, "stop");
          resources = await monitor.sample(root);
          const why = admissionReason(
            policy,
            resources,
            manager.live.size,
            cpuPressure,
          );
          if (why) {
            r.lastError = why;
            continue;
          }
          r.attempts++;
          r.blocked = r.attempts >= 3;
          r.nextAttempt = Date.now() + 30000 * 2 ** (r.attempts - 1);
          event(id, "recovery-attempt");
          await save();
          try {
            await manager.action(id, "stop");
            await manager.action(id, "start");
            if (r.reloadPaused) await manager.action(id, "pause");
          } catch (e: any) {
            r.lastError = "Recovery launch failed; inspect private logs";
            await save();
          }
        }
      });
      // Local JS evaluations do not request the assigned website or infer login status.
      for (const [id, s] of manager.live) {
        if (!s.page) continue;
        let responsive = false;
        try {
          responsive = await Promise.race([
            s.page.evaluate(() => document.readyState !== "loading"),
            new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
          ]);
        } catch {}
        pageHealth.set(id, { responsive, checkedAt: Date.now() });
      }
    } finally {
      working = false;
    }
  }
  const timer = setInterval(() => void cycle().catch(() => {}), 2000);
  void cycle();
  const app = express();
  app.disable("x-powered-by");
  app.use(headers);
  app.use(express.json({ limit: "16kb" }));
  const server = http.createServer(app),
    authenticate = auth(token),
    stopViewer = viewer(app, server, authenticate);
  app.get("/health/live", (_, res) => res.json({ ok: !closing }));
  app.get("/health/ready", authenticate, (_, res) =>
    res.status(closing ? 503 : 200).json({
      ok: !closing,
      application: "running",
      architecture: process.arch,
    }),
  );
  app.get("/api/status", authenticate, (_, res) =>
    res.json({
      ...manager.snapshot(),
      fixtureRequests: test ? fixtureRequests : undefined,
      alerts: [
        resources.availableMB < policy.reserveMB ? "Low memory reserve" : null,
        resources.diskFreeMB < policy.diskReserveMB ? "Low disk space" : null,
        cpuPressure >= 3 ? "Sustained CPU pressure" : null,
      ].filter(Boolean),
      profiles: manager.snapshot().profiles.map((p) => ({
        ...p,
        ...state.records[p.id],
        mode: p.autoReload ? "CONTROLLED_RELOAD" : "IDLE",
        health: pageHealth.get(p.id),
        authentication: "unknown; manual verification required",
      })),
      resources,
      policy,
      effectiveLimit: permittedLimit(policy, resources, manager.live.size),
      calibration,
      crashes: state.crashes,
      events: state.events,
      desired: state.desired,
      uptimeSeconds: process.uptime(),
      worker: "single Oracle worker",
      application: "running",
    }),
  );
  app.patch("/api/profiles/:id", authenticate, async (req, res) => {
    try {
      await serial(async () => {
        const id = String(req.params.id);
        if (!assigned.includes(id)) throw Error("Unknown profile");
        if (manager.live.has(id)) throw Error("Stop profile before editing");
        const body = req.body,
          r = state.records[id];
        if (
          body.ownerAcknowledged !== undefined &&
          typeof body.ownerAcknowledged !== "boolean"
        )
          throw Error("Invalid acknowledgement");
        if (
          body.notes !== undefined &&
          (typeof body.notes !== "string" || body.notes.length > 2000)
        )
          throw Error("Notes limited to 2000 characters");
        const acknowledged = body.ownerAcknowledged ?? r.ownerAcknowledged;
        if (body.autoReload === true && !acknowledged)
          throw Error(
            "Controlled reload requires owner acknowledgement and website permission",
          );
        const allowed = [
          "name",
          "url",
          "autoReload",
          "minSeconds",
          "maxSeconds",
        ];
        await store.update(
          id,
          Object.fromEntries(
            Object.entries(body).filter(([k]) => allowed.includes(k)),
          ),
        );
        r.ownerAcknowledged = acknowledged;
        r.notes = body.notes ?? r.notes;
        await save();
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/profiles/:id/:action", authenticate, async (req, res) => {
    try {
      await serial(async () => {
        const id = String(req.params.id),
          action = String(req.params.action);
        if (!assigned.includes(id)) throw Error("Unknown profile");
        const r = state.records[id];
        if (action === "view") {
          await manager.live.get(id)?.page?.bringToFront();
          return;
        }
        if (
          !["start", "stop", "restart", "pause", "resume", "reload"].includes(
            action,
          )
        )
          throw Error("Unknown action");
        if (action === "stop") {
          state.desired = state.desired.filter((x) => x !== id);
          await save();
          await manager.action(id, "stop");
          return;
        }
        if (action === "start" && manager.live.has(id))
          throw Error("Profile already open; use Restart");
        if (action === "start" || action === "restart") {
          if (action === "restart") await manager.action(id, "stop");
          r.attempts = 0;
          r.blocked = false;
          r.nextAttempt = 0;
          if (!state.desired.includes(id)) state.desired.push(id);
          await save();
          try {
            await manager.action(id, "start");
            if (r.reloadPaused) await manager.action(id, "pause");
          } catch (e) {
            state.desired = state.desired.filter((x) => x !== id);
            await save();
            throw e;
          }
          return;
        }
        if (
          action === "reload" &&
          !store.profiles.find((p) => p.id === id)!.autoReload
        )
          throw Error("Idle mode does not permit reload actions");
        if (action === "pause" || action === "resume") {
          if (!manager.live.has(id)) throw Error("Start this profile first");
          r.reloadPaused = action === "pause";
          await save();
        }
        await manager.action(id, action as Action);
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  if (test) {
    app.post("/test/:id/:operation", authenticate, async (req, res) => {
      try {
        const id = String(req.params.id),
          operation = String(req.params.operation),
          s = manager.live.get(id);
        if (!s?.page || new URL(s.page.url()).hostname !== "fixture.invalid")
          throw Error("Fixture page required");
        if (operation === "seed") {
          await s.context!.addCookies([
            { name: "owner", value: id, url: "https://fixture.invalid" },
          ]);
          await s.page.evaluate((id) => localStorage.setItem("owner", id), id);
          await store.checkpoint(id, await s.context!.cookies());
          res.json({ ok: true });
        } else if (operation === "probe") {
          res.json({
            ...(await s.page.evaluate(async () => ({
              owner: localStorage.getItem("owner"),
              ticks: Number(document.querySelector("output")?.textContent),
              input: (document.querySelector("input") as HTMLInputElement)
                ?.value,
              geo: (await navigator.permissions.query({ name: "geolocation" }))
                .state,
            }))),
            cookie: (await s.context!.cookies()).find((c) => c.name === "owner")
              ?.value,
          });
        } else if (operation === "focus") {
          await s.page.bringToFront();
          await s.page.locator("input").focus();
          res.json({ ok: true });
        } else if (operation === "crash") {
          // A real browser-process loss, not an unsupported/swallowed CDP crash.
          let killed = false;
          for (const pid of await fs.readdir("/proc")) {
            if (!/^\d+$/.test(pid)) continue;
            try {
              const birth = (await fs.readFile(`/proc/${pid}/stat`, "utf8"))
                .split(") ")
                .at(-1)!
                .split(" ")[19];
              const args = (
                await fs.readFile(`/proc/${pid}/cmdline`, "utf8")
              ).split("\0");
              if (
                !args.includes(`--mbam-worker-owner=${ownership.owner}`) ||
                !args.includes(
                  `--user-data-dir=${path.join(root, "profiles", id)}`,
                )
              )
                continue;
              const current = (await fs.readFile(`/proc/${pid}/stat`, "utf8"))
                .split(") ")
                .at(-1)!
                .split(" ")[19];
              if (birth === current) {
                process.kill(Number(pid), "SIGKILL");
                killed = true;
                break;
              }
            } catch {}
          }
          if (!killed)
            throw Error(
              "Owned fixture browser process was not found; crash test did not run",
            );
          res.json({ ok: true });
        } else throw Error("Unknown test action");
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    });
  }
  for (const asset of ["index.html", "app.js", "style.css"])
    app.get(asset === "index.html" ? "/" : "/" + asset, (_req, res) =>
      res.sendFile(path.resolve("cloud/oracle/public", asset)),
    );
  app.use((e: Error, _req: unknown, res: any, _next: unknown) =>
    res.status(400).json({ error: "Invalid request" }),
  );
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
  );
  async function stop() {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    stopViewer();
    server.close();
    await chain;
    await manager.close();
    await save();
    await writes;
  }
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  return { server, stop };
}
if (require.main === module)
  void startOracle().catch(() => {
    console.error(
      "Oracle worker startup failed; verify secret files, state integrity and deployment permissions",
    );
    process.exit(1);
  });
