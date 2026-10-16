import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, safeUrl } from "../desktop/store";
import { randomDelay, mayReload, Manager } from "../desktop/manager";
test("30 independent settings persist across restarts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-"));
  try {
    const s = new Store(dir);
    await s.init();
    assert.equal(s.profiles.length, 30);
    assert.equal(new Set(s.profiles.map((p) => p.id)).size, 30);
    await s.update("profile-01", {
      name: "Work",
      url: "https://example.org/",
      autoReload: true,
    });
    const restored = new Store(dir);
    await restored.init();
    assert.equal(restored.profiles[0].name, "Work");
    assert.equal(restored.profiles[1].name, "Profile 02");
    assert.equal(restored.profiles[0].autoReload, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("URL and reload setting validation", async () => {
  assert.throws(() => safeUrl("http://example.com"));
  assert.throws(() => safeUrl("https://user:pass@example.com"));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-"));
  try {
    const s = new Store(dir);
    await s.init();
    await assert.rejects(s.update("profile-01", { minSeconds: 119 }));
    await assert.rejects(s.update("profile-01", { maxSeconds: 301 }));
    await assert.rejects(s.update("../escape", {}));
    assert.equal(s.profiles[0].minSeconds, 120);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("reload range, navigation and cooldown safeguards", () => {
  assert.equal(randomDelay(120, 300, 0), 120000);
  assert.ok(randomDelay(120, 300, 0.999999) < 300000);
  for (let i = 0; i < 10000; i++) {
    const n = randomDelay(120, 300);
    assert.ok(n >= 120000 && n <= 300000);
  }
  assert.equal(mayReload("https://a/", "https://a/", 100, 120100), true);
  assert.equal(mayReload("https://a/login", "https://a/", 0, 200000), false);
  assert.equal(mayReload("https://a/", "https://a/", 100, 120099), false);
});
test("corrupt settings fail without overwriting existing data", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-"));
  try {
    await fs.writeFile(path.join(dir, "settings.bin"), "bad");
    await assert.rejects(new Store(dir).init(), /no data was overwritten/);
    assert.equal(
      await fs.readFile(path.join(dir, "settings.bin"), "utf8"),
      "bad",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("reload timers cancel on pause and honor disabled setting", async () => {
  const s = new Store("/tmp/not-used");
  const m = new Manager(s);
  const p = {
    id: "profile-01",
    name: "Test",
    url: "https://example.com/",
    autoReload: true,
    minSeconds: 120,
    maxSeconds: 300,
  };
  const session: any = {
    busy: false,
    stopping: false,
    last: 0,
    failures: 0,
    paused: false,
    page: {},
  };
  m.live.set(p.id, session);
  s.profiles = [p];
  m.schedule(p, session);
  assert.ok(session.next - Date.now() >= 119900);
  await m.action(p.id, "pause");
  assert.equal(session.timer, undefined);
  assert.equal(session.next, undefined);
  await m.action(p.id, "resume");
  assert.ok(session.timer);
  m.clear(session);
  p.autoReload = false;
  m.schedule(p, session);
  assert.equal(session.timer, undefined);
});
test("reload protects forms, throttles shared origins and pauses on 429", async () => {
  const store = new Store("/tmp/not-used");
  const manager = new Manager(store);
  let requests = 0;
  let editing = true;
  let code = 200;
  const p = {
    id: "profile-01",
    name: "A",
    url: "https://example.com/",
    autoReload: true,
    minSeconds: 120,
    maxSeconds: 300,
  };
  const session: any = {
    page: {
      url: () => p.url,
      evaluate: async () => editing,
      reload: async () => {
        requests++;
        return { status: () => code };
      },
    },
    busy: false,
    stopping: false,
    last: 0,
    failures: 0,
    paused: false,
  };
  await assert.rejects(manager.reload(p, session), /form/);
  assert.equal(requests, 0);
  editing = false;
  await manager.reload(p, session);
  assert.equal(requests, 1);
  const second: any = { ...session, last: 0 };
  await assert.rejects(
    manager.reload({ ...p, id: "profile-02" }, second),
    /shared website/,
  );
  assert.equal(requests, 1);
  const other = { ...p, url: "https://other.example/" };
  second.page = { ...session.page, url: () => other.url };
  code = 429;
  await assert.rejects(manager.reload(other, second), /backoff/);
  assert.equal(second.paused, true);
  assert.equal(requests, 2);
});
test("scheduler executes one reload and schedules a fresh interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const store = new Store("/tmp/not-used");
  const manager = new Manager(store);
  const p = {
    id: "profile-01",
    name: "A",
    url: "https://example.com/",
    autoReload: true,
    minSeconds: 120,
    maxSeconds: 120,
  };
  store.profiles = [p];
  let requests = 0;
  const session: any = {
    page: {
      url: () => p.url,
      evaluate: async () => false,
      reload: async () => {
        requests++;
        return { status: () => 200 };
      },
    },
    busy: false,
    stopping: false,
    last: 1_000_000,
    failures: 0,
    paused: false,
  };
  manager.live.set(p.id, session);
  manager.schedule(p, session);
  t.mock.timers.tick(119999);
  await Promise.resolve();
  assert.equal(requests, 0);
  t.mock.timers.tick(1);
  await manager.exclusive(async () => {});
  assert.equal(requests, 1);
  assert.equal(session.next, 1_240_000);
  manager.clear(session);
  t.mock.timers.reset();
});
