import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../desktop/store";
import { Manager } from "../desktop/manager";
import type { Action } from "../desktop/types";
import { atomicJson, auth, codec, headers, ids, secret } from "./common";
import { Metrics } from "./metrics";
import { recoverOwnedBrowsers } from "./recovery";

type Control = {
  desired: string[];
  paused: string[];
  failures: Record<
    string,
    { attempts: number; next: number; blocked: boolean }
  >;
  incidents: number;
  events?: { id: string; kind: string; time: number }[];
};
export async function startWorker() {
  const root = path.resolve(process.env.DATA_DIR || "data/cloud-worker");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const assigned = ids(
    Number(process.env.PROFILE_START || 1),
    Number(process.env.PROFILE_COUNT || 10),
  );
  const token = await secret("WORKER_TOKEN"),
    vault = codec(await secret("VAULT_KEY"));
  const store = new Store(root, vault.encode, vault.decode, assigned);
  await store.init();
  store.maxActive = assigned.length;
  await store.save();
  const controlFile = path.join(root, "control.json");
  let control: Control = {
    desired: [],
    paused: [],
    failures: {},
    incidents: 0,
  };
  try {
    control = JSON.parse(await fs.readFile(controlFile, "utf8"));
    if (
      !Array.isArray(control.desired) ||
      !Array.isArray(control.paused) ||
      !control.failures ||
      typeof control.failures !== "object" ||
      Array.isArray(control.failures) ||
      !Number.isInteger(control.incidents) ||
      control.incidents < 0 ||
      new Set(control.desired).size !== control.desired.length ||
      new Set(control.paused).size !== control.paused.length ||
      !Array.isArray(control.events || []) ||
      Object.values(control.failures).some(
        (f) =>
          !Number.isInteger(f.attempts) ||
          f.attempts < 1 ||
          f.attempts > 3 ||
          !Number.isFinite(f.next) ||
          f.next < 0 ||
          typeof f.blocked !== "boolean" ||
          f.blocked !== f.attempts >= 3,
      ) ||
      [
        ...control.desired,
        ...control.paused,
        ...Object.keys(control.failures),
      ].some((id) => !assigned.includes(id))
    )
      throw Error("Invalid control state");
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw Error(
        "Control state is invalid; restore a backup (not overwritten)",
      );
  }
  control.events = (control.events || []).slice(-50);
  let pending = 0;
  let chain = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    if (pending >= 32)
      return Promise.reject<T>(Error("Worker control queue full; try later"));
    pending++;
    const next = chain.then(fn, fn).finally(() => {
      pending--;
    });
    chain = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const save = () => atomicJson(controlFile, control);
  let closing = false,
    recovering = false;
  const bootId = crypto.randomUUID();
  const coordinator = process.env.COORDINATOR_URL,
    clusterToken = coordinator ? await secret("CLUSTER_TOKEN") : undefined;
  const test = process.env.MBAM_TEST_MODE === "1";
  if (test && process.env.NODE_ENV === "production")
    throw Error("Test instrumentation cannot run in production");
  const ownership = await recoverOwnedBrowsers(root, assigned);
  if (ownership.recovered)
    console.log(`Recovered ${ownership.recovered} owned browser processes`);
  const manager = new Manager(store, {
    headless: false,
    browserArgs: [`--mbam-worker-owner=${ownership.owner}`],
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    minFreeMB: Number(process.env.MIN_FREE_MB || 1024),
    beforeReload: coordinator
      ? async (origin) => {
          try {
            const r = await fetch(coordinator + "/internal/reload-permit", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + clusterToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ origin }),
              signal: AbortSignal.timeout(3000),
              redirect: "error",
            });
            return r.ok && (await r.json()).allowed === true;
          } catch {
            return false;
          }
        }
      : undefined,
    onIncident: (id, kind) => {
      control.incidents++;
      control.events = [
        ...(control.events || []),
        { id, kind, time: Date.now() },
      ].slice(-50);
      void serial(save).catch(() => {});
    },
    prepareContext: test
      ? async (context) => {
          await context.route("https://fixture.invalid/**", async (route) => {
            const id = new URL(route.request().url()).pathname.slice(1);
            if (!assigned.includes(id)) {
              await route.fulfill({ status: 404, body: "Unknown fixture" });
              return;
            }
            await route.fulfill({
              status: 200,
              contentType: "text/html",
              body: `<!doctype html><title>Authorized fixture ${id}</title><h1>Controlled browser load fixture</h1><output id="ticks">0</output><script>let ticks=0;setInterval(()=>{const end=performance.now()+2;while(performance.now()<end){};document.querySelector('#ticks').textContent=String(++ticks)},1000);</script>`,
            });
          });
        }
      : undefined,
  });
  async function recover() {
    if (closing || recovering) return;
    recovering = true;
    try {
      await serial(async () => {
        for (const id of control.desired) {
          if (closing) break;
          const s = manager.snapshot().profiles.find((p) => p.id === id)!;
          if (s.state === "running" || s.state === "starting") continue;
          const f = control.failures[id] || {
            attempts: 0,
            next: 0,
            blocked: false,
          };
          if (f.blocked || f.next > Date.now()) continue;
          f.attempts++;
          f.next = Date.now() + Math.min(120000, 30000 * 2 ** (f.attempts - 1));
          f.blocked = f.attempts >= 3;
          control.failures[id] = f;
          await save();
          try {
            await manager.action(id, "stop");
            await manager.action(id, "start");
            if (control.paused.includes(id)) await manager.action(id, "pause");
          } catch {}
        }
      });
    } finally {
      recovering = false;
    }
  }
  const metrics = new Metrics();
  let resource = await metrics.sample();
  const sampler = setInterval(
    () =>
      void metrics
        .sample()
        .then((m) => (resource = m))
        .catch(() => {}),
    2000,
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(headers);
  app.use(express.json({ limit: "16kb" }));
  app.get("/health/live", (_, res) => res.json({ ok: true, bootId }));
  app.use(auth(token));
  app.get("/health/ready", (_, res) =>
    res.status(closing ? 503 : 200).json({
      ok: !closing,
      workerId: process.env.WORKER_ID || "worker",
      bootId,
      assigned,
      recovering,
      desired: control.desired.length,
    }),
  );
  app.get("/api/profiles", (_, res) =>
    res.json({
      ...manager.snapshot(),
      workerId: process.env.WORKER_ID || "worker",
      bootId,
      resources: resource,
      incidents: control.incidents,
      recovery: control.failures,
      desired: control.desired,
    }),
  );
  app.patch("/api/profiles/:id", async (req, res) => {
    try {
      await serial(async () => {
        if (manager.live.has(req.params.id))
          throw Error("Stop profile before editing");
        await store.update(req.params.id, req.body);
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/profiles/:id/:action", async (req, res) => {
    try {
      const id = req.params.id,
        action = req.params.action as Action;
      if (!assigned.includes(id))
        throw Error("Profile is not owned by this worker");
      if (!["start", "stop", "reload", "pause", "resume"].includes(action))
        throw Error("Unknown action");
      await serial(async () => {
        if (action === "start") {
          if (!control.desired.includes(id)) control.desired.push(id);
          delete control.failures[id];
          await save();
        }
        if (action === "stop") {
          control.desired = control.desired.filter((p) => p !== id);
          delete control.failures[id];
          await save();
        }
        if (action === "pause" && !control.paused.includes(id)) {
          control.paused.push(id);
          await save();
        }
        if (action === "resume") {
          control.paused = control.paused.filter((p) => p !== id);
          await save();
        }
        await manager.action(id, action);
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  // This fixture API is absent in production. It touches only fixture.invalid.
  if (test)
    app.post("/test/:id/:operation", async (req, res) => {
      try {
        const id = req.params.id;
        if (!assigned.includes(id)) throw Error("Not assigned");
        const s = manager.live.get(id);
        if (!s?.page || new URL(s.page.url()).hostname !== "fixture.invalid")
          throw Error("Test operation is limited to the local fixture");
        const op = req.params.operation;
        if (op === "seed") {
          await s.context!.addCookies([
            {
              name: "fixture-session",
              value: id,
              url: "https://fixture.invalid",
            },
          ]);
          await s.page.evaluate((id) => {
            localStorage.setItem("fixture-owner", id);
          }, id);
          await store.checkpoint(id, await s.context!.cookies());
          res.json({ ok: true });
        } else if (op === "probe") {
          const state = await s.page.evaluate(() => ({
            owner: localStorage.getItem("fixture-owner"),
            ticks: Number(document.querySelector("#ticks")?.textContent || 0),
            navigation: performance.timeOrigin,
            title: document.title,
          }));
          const cookies = await s.context!.cookies();
          res.json({
            ...state,
            cookie:
              cookies.find((c) => c.name === "fixture-session")?.value || null,
            state: manager.snapshot().profiles.find((p) => p.id === id)?.state,
          });
        } else if (op === "crash") {
          const cdp = await s.context!.newCDPSession(s.page);
          void cdp.send("Page.crash").catch(() => {});
          res.json({ ok: true });
        } else throw Error("Unknown fixture operation");
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    });
  app.use((e: Error, _: unknown, res: any, _next: unknown) =>
    res.status(400).json({ error: e.message }),
  );
  const server = app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => console.log(`Cloud worker ready ${(server.address() as any).port}`),
  );
  const recoveryTimer = setInterval(() => void recover().catch(() => {}), 5000);
  void recover();
  const stop = async () => {
    if (closing) return;
    closing = true;
    clearInterval(sampler);
    clearInterval(recoveryTimer);
    server.close();
    await serial(() => manager.close());
    await save();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  return { server, manager, stop };
}
if (require.main === module)
  void startWorker().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
