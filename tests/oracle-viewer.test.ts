import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { once } from "node:events";
import { viewer } from "../cloud/oracle/viewer";
import { auth } from "../cloud/common";
test("viewer authenticates HTTP and WebSocket origins, and logout revokes an open connection", async () => {
  const app = express(),
    server = http.createServer(app),
    backend = http.createServer();
  const token = crypto.randomBytes(32).toString("hex");
  backend.on("upgrade", (req, socket) => {
    const accept = crypto
      .createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  process.env.VIEWER_BACKEND_PORT = String((backend.address() as any).port);
  const dispose = viewer(app, server, auth(token));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  let peer: import("node:stream").Duplex | undefined;
  try {
    assert.equal((await fetch(base + "/viewer/viewer.html")).status, 401);
    const r = await fetch(base + "/api/viewer-session", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    assert.equal(r.status, 200);
    const set = r.headers.get("set-cookie")!;
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    assert.ok(!set.includes(token));
    const cookie = set.split(";")[0];
    assert.equal(
      (
        await fetch(base + "/viewer/viewer.html", {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    async function upgrade(origin: string, c?: string) {
      return new Promise<{
        status: number;
        socket?: import("node:stream").Duplex;
      }>((resolve, reject) => {
        const req = http.request(base + "/viewer/websockify", {
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
            "Sec-WebSocket-Version": "13",
            Origin: origin,
            ...(c ? { Cookie: c } : {}),
          },
        });
        req.on("upgrade", (r, s) =>
          resolve({ status: r.statusCode!, socket: s }),
        );
        req.on("response", (r) => {
          r.resume();
          resolve({ status: r.statusCode! });
        });
        req.on("error", reject);
        req.end();
      });
    }
    assert.equal((await upgrade(base)).status, 401);
    assert.equal((await upgrade("https://wrong.invalid", cookie)).status, 401);
    const opened = await upgrade(base, cookie);
    assert.equal(opened.status, 101);
    peer = opened.socket;
    const closed = once(peer!, "close");
    peer!.resume();
    assert.equal(
      (
        await fetch(base + "/viewer/logout", {
          method: "POST",
          headers: { Cookie: cookie, Origin: base },
        })
      ).status,
      200,
    );
    await closed;
    assert.equal(
      (
        await fetch(base + "/viewer/viewer.html", {
          headers: { Cookie: cookie },
        })
      ).status,
      401,
    );
  } finally {
    peer?.destroy();
    dispose();
    server.closeAllConnections();
    server.close();
    backend.closeAllConnections();
    backend.close();
    delete process.env.VIEWER_BACKEND_PORT;
  }
});
