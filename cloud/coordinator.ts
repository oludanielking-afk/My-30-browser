import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { auth, headers, secret } from "./common";

type Worker = {
  id: string;
  url: string;
  tokenFile: string;
  profiles: string[];
  token?: string;
};
export async function startCoordinator() {
  const token = await secret("ADMIN_TOKEN"),
    cluster = await secret("CLUSTER_TOKEN");
  const workers: Worker[] = JSON.parse(
    await fs.readFile(
      process.env.WORKERS_FILE || "deployment/workers.json",
      "utf8",
    ),
  );
  const owners = new Map<string, Worker>();
  const names = new Set<string>();
  if (!Array.isArray(workers) || workers.length < 3)
    throw Error("At least three configured workers are required");
  for (const w of workers) {
    const url = new URL(w.url);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (!["https:"].includes(url.protocol) &&
        !(process.env.ALLOW_INTERNAL_HTTP === "1" && url.protocol === "http:"))
    )
      throw Error(
        "Worker URL must be an HTTPS origin (or explicitly trusted internal HTTP)",
      );
    if (names.has(w.id)) throw Error("Duplicate worker ID");
    names.add(w.id);
    w.url = url.origin;
    w.token = (await fs.readFile(w.tokenFile, "utf8")).trim();
    if (w.token.length < 32) throw Error("Missing worker credential");
    if (
      !Array.isArray(w.profiles) ||
      w.profiles.length > 10 ||
      w.profiles.length < 1
    )
      throw Error("Workers must own 1–10 profiles");
    for (const id of w.profiles) {
      if (!/^profile-(0[1-9]|[12][0-9]|30)$/.test(id) || owners.has(id))
        throw Error("Invalid or overlapping profile ownership");
      owners.set(id, w);
    }
  }
  if (owners.size !== 30)
    throw Error("Exactly 30 unique assigned profiles are required");
  async function call(
    w: Worker,
    route: string,
    method = "GET",
    body?: unknown,
    timeout = 5000,
  ) {
    const r = await fetch(w.url + route, {
      method,
      headers: {
        Authorization: "Bearer " + w.token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.error || `Worker returned ${r.status}`);
    return value;
  }
  const cache = new Map<string, any>();
  let polling = false;
  const rate = new Map<string, number>();
  const permitAfter = Date.now() + 30000;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      await Promise.all(
        workers.map(async (w) => {
          try {
            const s = await call(w, "/api/profiles");
            const found = s.profiles?.map((p: any) => p.id);
            if (
              s.workerId !== w.id ||
              !Array.isArray(found) ||
              found.length !== w.profiles.length ||
              found.some((id: string) => !w.profiles.includes(id)) ||
              new Set(found).size !== found.length
            )
              throw Error("Worker ownership mismatch");
            cache.set(w.id, {
              id: w.id,
              healthy: true,
              seenAt: Date.now(),
              ...s,
            });
          } catch (e: any) {
            cache.set(w.id, {
              id: w.id,
              healthy: false,
              seenAt: cache.get(w.id)?.seenAt || null,
              error: e.message,
              profiles: w.profiles.map((id) => ({
                id,
                name: id,
                state: "unreachable",
                url: "",
                autoReload: false,
              })),
              running: 0,
            });
          }
        }),
      );
    } finally {
      polling = false;
    }
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(headers);
  app.use(express.json({ limit: "16kb" }));
  app.get("/health/live", (_, res) => res.json({ ok: true }));
  app.post("/internal/reload-permit", auth(cluster), (req, res) => {
    try {
      const u = new URL(req.body.origin);
      if (u.origin !== req.body.origin || u.protocol !== "https:")
        throw Error("Invalid origin");
      const now = Date.now(),
        allowed =
          now >= permitAfter && now - (rate.get(u.origin) || 0) >= 30000;
      if (allowed) rate.set(u.origin, now);
      for (const [origin, time] of rate)
        if (now - time > 3600000) rate.delete(origin);
      res.json({ allowed });
    } catch {
      res.status(400).json({ error: "Invalid origin" });
    }
  });
  app.use("/api", auth(token));
  app.get("/api/status", (_, res) => {
    const rows = workers.map(
      (w) =>
        cache.get(w.id) || {
          id: w.id,
          healthy: false,
          profiles: w.profiles.map((id) => ({ id, state: "unreachable" })),
          running: 0,
        },
    );
    res.json({
      workers: rows,
      profiles: rows.flatMap((w) => w.profiles),
      running: rows.reduce((n, w) => n + (w.healthy ? w.running : 0), 0),
      target: 30,
      allHealthy: rows.every((w) => w.healthy && Date.now() - w.seenAt < 15000),
      timestamp: Date.now(),
    });
  });
  app.get("/health/ready", auth(token), (_, res) => {
    const ready = workers.every(
      (w) =>
        cache.get(w.id)?.healthy && Date.now() - cache.get(w.id).seenAt < 15000,
    );
    res.status(ready ? 200 : 503).json({ ok: ready });
  });
  app.patch("/api/profiles/:id", async (req, res) => {
    const w = owners.get(req.params.id);
    if (!w) {
      res.status(404).json({ error: "Unknown profile" });
      return;
    }
    try {
      await call(w, `/api/profiles/${req.params.id}`, "PATCH", req.body, 45000);
      await poll();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });
  app.post("/api/profiles/:id/:action", async (req, res) => {
    const w = owners.get(req.params.id);
    if (
      !w ||
      !["start", "stop", "pause", "resume", "reload"].includes(
        req.params.action,
      )
    ) {
      res.status(400).json({ error: "Unknown profile or action" });
      return;
    }
    try {
      await call(
        w,
        `/api/profiles/${req.params.id}/${req.params.action}`,
        "POST",
        {},
        45000,
      );
      await poll();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });
  app.use(express.static(path.resolve("cloud/public")));
  app.use((e: Error, _: unknown, res: any, _next: unknown) =>
    res.status(400).json({ error: e.message }),
  );
  await poll();
  const timer = setInterval(() => void poll(), 3000);
  const server = app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => console.log(`Coordinator ready ${(server.address() as any).port}`),
  );
  const stop = () => {
    clearInterval(timer);
    server.close();
  };
  process.once("SIGTERM", () => {
    stop();
    setTimeout(() => process.exit(0), 1000).unref();
  });
  process.once("SIGINT", stop);
  return { server, stop };
}
if (require.main === module)
  void startCoordinator().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
