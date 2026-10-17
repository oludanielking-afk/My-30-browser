import type { Express } from "express";
import type { Server, IncomingMessage } from "node:http";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import path from "node:path";
// Short-lived, opaque, HttpOnly session. Never place the management token in URLs.
export function viewer(
  app: Express,
  server: Server,
  auth: express.RequestHandler,
) {
  const sessions = new Map<string, number>();
  const peers = new Map<string, Set<import("node:stream").Duplex>>();
  const ttl = 15 * 60 * 1000;
  function sid(req: IncomingMessage) {
    return (
      /(?:^|;\s*)mbam_viewer=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie || "",
      )?.[1] || ""
    );
  }
  function valid(req: IncomingMessage) {
    return (sessions.get(sid(req)) || 0) > Date.now();
  }
  function revoke(id: string) {
    sessions.delete(id);
    for (const p of peers.get(id) || []) p.destroy();
    peers.delete(id);
  }
  const timer = setInterval(() => {
    for (const [id, expires] of sessions) if (expires <= Date.now()) revoke(id);
  }, 1000);
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  app.post("/api/viewer-session", auth, (req, res) => {
    // Bearer authentication prevents CSRF. Cookies are only for viewer HTTP/WS.
    if (sessions.size >= 16) {
      res.status(429).json({ error: "Viewer session limit reached" });
      return;
    }
    revoke(sid(req));
    const id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, Date.now() + ttl);
    res.setHeader(
      "Set-Cookie",
      `mbam_viewer=${id}; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=900${secure}`,
    );
    res.json({ url: "/viewer/viewer.html", expiresInSeconds: 900 });
  });
  app.post("/viewer/logout", (req, res) => {
    if (!valid(req)) {
      res.sendStatus(401);
      return;
    }
    const origin = req.get("origin");
    if (origin && origin !== `http${process.env.COOKIE_SECURE === "1" ? "s" : ""}://${req.get("host")}`) {
      res.sendStatus(403);
      return;
    }
    revoke(sid(req));
    res.setHeader(
      "Set-Cookie",
      `mbam_viewer=; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=0${secure}`,
    );
    res.json({ ok: true });
  });
  app.use(
    "/viewer",
    (req, res, next) => {
      if (!valid(req)) {
        res.sendStatus(401);
        return;
      }
      next();
    },
    express.static(path.resolve("cloud/oracle/public"), {
      index: false,
      dotfiles: "deny",
    }),
    express.static(path.resolve(process.env.NOVNC_DIR || "/usr/share/novnc"), {
      index: false,
      dotfiles: "deny",
    }),
  );
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/viewer/websockify" ||
      !valid(req) ||
      req.headers.origin !==
        `http${process.env.COOKIE_SECURE === "1" ? "s" : ""}://${req.headers.host}`
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const id = sid(req);
    const set = peers.get(id) || new Set();
    peers.set(id, set);
    set.add(socket);
    const forwarded = { ...req.headers };
    delete forwarded.cookie;
    delete forwarded.authorization;
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: Number(process.env.VIEWER_BACKEND_PORT || 6081),
      path: "/",
      method: "GET",
      headers: { ...forwarded, host: "127.0.0.1" },
    });
    upstream.on("upgrade", (response, remote, initial) => {
      set.add(remote);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (initial.length) socket.write(initial);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      const close = () => {
        remote.destroy();
        socket.destroy();
        set.delete(socket);
        set.delete(remote);
      };
      socket.on("close", close);
      remote.on("close", close);
      remote.on("error", close);
    });
    upstream.on("response", () => socket.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.end();
  });
  return () => {
    clearInterval(timer);
    for (const id of sessions.keys()) revoke(id);
  };
}
