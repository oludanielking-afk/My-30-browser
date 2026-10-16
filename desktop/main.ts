import { app, BrowserWindow, ipcMain, safeStorage, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { Store } from "./store";
import { Manager } from "./manager";
import type { Action, Profile } from "./types";
if (app.isPackaged)
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.resourcesPath,
    "browsers",
  );
app.setName("Multi Browser Manager");
if (!app.commandLine.hasSwitch("user-data-dir"))
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "Multi Browser Manager"),
  );
let manager: Manager;
let quitting = false;
let worker: { url: string; token: string } | undefined;
let win: BrowserWindow;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app.whenReady().then(async () => {
    try {
      if (process.platform === "win32" && !safeStorage.isEncryptionAvailable())
        throw Error("Windows secure storage is unavailable");
      const root = path.join(app.getPath("userData"), "vault");
      const store = new Store(
        root,
        (s) =>
          safeStorage.isEncryptionAvailable()
            ? safeStorage.encryptString(s)
            : Buffer.from(s),
        (b) =>
          safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(b)
            : b.toString(),
      );
      await store.init();
      manager = new Manager(store);
      async function remote(route: string, method = "GET", body?: unknown) {
        if (!worker) throw Error("No worker connected");
        const response = await fetch(worker.url + "/api" + route, {
          method,
          headers: {
            Authorization: "Bearer " + worker.token,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(45000),
          redirect: "error",
        });
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || `Worker HTTP ${response.status}`);
        return data;
      }
      ipcMain.handle("snapshot", async () =>
        worker ? remote("/profiles") : manager.snapshot(),
      );
      ipcMain.handle(
        "update",
        async (_, id: string, patch: Partial<Profile>) => {
          if (worker)
            return remote(
              `/profiles/${encodeURIComponent(id)}`,
              "PATCH",
              patch,
            );
          return manager.exclusive(async () => {
            if (manager.live.has(id))
              throw Error("Close profile before changing settings");
            await store.update(id, patch);
          });
        },
      );
      ipcMain.handle("action", (_, id: string, action: Action) =>
        worker
          ? remote(
              `/profiles/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
              "POST",
            )
          : manager.action(id, action),
      );
      ipcMain.handle("limit", (_, n: number) =>
        manager.exclusive(async () => {
          if (worker) throw Error("Configure limits on the worker host");
          if (!Number.isInteger(n) || n < 1 || n > 10 || n < manager.live.size)
            throw Error(
              "Limit must be 1–10 and at least the current active count",
            );
          store.maxActive = n;
          await store.save();
        }),
      );
      ipcMain.handle("worker", async (_, url: string, token: string) => {
        const u = new URL(url);
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.pathname !== "/" ||
          u.search ||
          u.hash ||
          token.length < 24 ||
          token.length > 4096
        )
          throw Error(
            "Use an HTTPS worker origin and a token of at least 24 characters",
          );
        if (manager.live.size)
          throw Error("Close local profiles before connecting a worker");
        const previous = worker;
        worker = { url: u.origin, token };
        try {
          const data = await remote("/profiles");
          if (!Array.isArray(data.profiles) || data.profiles.length !== 30)
            throw Error("Worker must provide 30 profiles");
        } catch (e) {
          worker = previous;
          throw e;
        }
      });
      ipcMain.handle("disconnect", () => {
        worker = undefined;
      });
      win = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 960,
        minHeight: 680,
        backgroundColor: "#0d111a",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.session.setPermissionRequestHandler((_, __, cb) =>
        cb(false),
      );
      win.webContents.session.setPermissionCheckHandler(() => false);
      await win.loadFile(path.join(__dirname, "ui/index.html"));
      if (process.env.MBAM_SMOKE === "1") {
        await win.webContents.executeJavaScript(
          'new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelectorAll(".profile").length===30){clearInterval(t);resolve(true);}else if(++n>100){clearInterval(t);reject(Error("Dashboard did not load 30 profiles"));}},100);})',
        );
        await fs.writeFile(
          path.join(app.getPath("temp"), "mbam-dashboard.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        await fs.writeFile(
          process.env.MBAM_SMOKE_FILE ||
            path.join(app.getPath("temp"), "mbam-smoke.json"),
          JSON.stringify(
            await win.webContents.executeJavaScript(
              '({title:document.title,cards:document.querySelectorAll(".profile").length,text:document.body.innerText})',
            ),
          ),
        );
        app.quit();
      }
    } catch (e: any) {
      if (process.env.MBAM_SMOKE === "1") console.error(e);
      else dialog.showErrorBox("Startup failed", e.message);
      app.exit(1);
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (e) => {
    if (!quitting && manager) {
      e.preventDefault();
      quitting = true;
      void manager.close().finally(() => app.quit());
    }
  });
}
