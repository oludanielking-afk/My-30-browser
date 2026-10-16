import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../desktop/store";
import { Manager } from "../desktop/manager";
test("Chromium cookies, storage and geolocation isolate and survive restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-browser-"));
  const store = new Store(root);
  await store.init();
  const manager = new Manager(store, {
    headless: !process.env.DISPLAY,
    executablePath: process.env.TEST_CHROMIUM,
    minFreeMB: 0,
    prepareContext: async (context) => {
      await context.route("https://example.com/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Profile persistence test</title><h1>Test website</h1>",
        }),
      );
    },
  });
  try {
    await manager.action("profile-01", "start");
    const a = manager.live.get("profile-01")!;
    await a.context!.addCookies([
      {
        name: "session",
        value: "account-one",
        url: "https://example.com",
        expires: Date.now() / 1000 + 86400,
      },
    ]);
    await a.context!.addCookies([
      {
        name: "session-only",
        value: "ephemeral-login",
        url: "https://example.com",
      },
    ]);
    await a.page!.evaluate(() => localStorage.setItem("account", "one"));
    await manager.action("profile-02", "start");
    const b = manager.live.get("profile-02")!;
    assert.equal(
      (await b.context!.cookies()).find((c) => c.name === "session"),
      undefined,
    );
    assert.equal(
      await b.page!.evaluate(() => localStorage.getItem("account")),
      null,
    );
    assert.equal(
      await a.page!.evaluate(
        async () =>
          (await navigator.permissions.query({ name: "geolocation" })).state,
      ),
      "denied",
    );
    await manager.action("profile-01", "stop");
    await manager.action("profile-01", "start");
    const restored = manager.live.get("profile-01")!;
    assert.equal(
      (await restored.context!.cookies()).find((c) => c.name === "session")
        ?.value,
      "account-one",
    );
    assert.equal(
      await restored.page!.evaluate(() => localStorage.getItem("account")),
      "one",
    );
    assert.equal(
      (await restored.context!.cookies()).find((c) => c.name === "session-only")
        ?.value,
      "ephemeral-login",
    );
    await assert.rejects(manager.action("profile-01", "reload"), /cooldown/);
    store.maxActive = 2;
    await assert.rejects(manager.action("profile-03", "start"), /limit/);
  } finally {
    await manager.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
