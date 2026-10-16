import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { Store } from "./store";
import { Manager } from "./manager";
import type { Action } from "./types";
async function main() {
  const token = process.env.ADMIN_TOKEN || "";
  if (token.length < 24 || token.startsWith("REPLACE_"))
    throw Error("Set ADMIN_TOKEN to a random secret of at least 24 characters");
  const store = new Store(path.resolve(process.env.DATA_DIR || "data"));
  await store.init();
  if (process.env.MAX_ACTIVE) {
    const n = Number(process.env.MAX_ACTIVE);
    if (!Number.isInteger(n) || n < 1 || n > 10)
      throw Error("MAX_ACTIVE must be 1–10");
    store.maxActive = n;
    await store.save();
  }
  const manager = new Manager(store);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.static(path.resolve("public"), { index: "index.html" }));
  app.use("/api", (req, res, next) => {
    const a = Buffer.from(
        (req.get("authorization") || "").replace(/^Bearer /, ""),
      ),
      b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
  app.get("/api/profiles", (_, res) => res.json(manager.snapshot()));
  app.patch("/api/profiles/:id", async (req, res) => {
    try {
      await manager.exclusive(async () => {
        if (manager.live.has(req.params.id))
          throw Error("Close profile before editing");
        await store.update(req.params.id, req.body);
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/profiles/:id/:action", async (req, res) => {
    try {
      await manager.action(req.params.id, req.params.action as Action);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.use((error: Error, _req: unknown, res: any, _next: unknown) =>
    res.status(400).json({ error: error.message }),
  );
  const server = app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => {
      const addr = server.address();
      console.log(`Worker ready ${typeof addr === "object" ? addr?.port : ""}`);
    },
  );
  const stop = () => {
    server.close();
    void manager.close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
