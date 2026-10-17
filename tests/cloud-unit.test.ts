import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { codec, ids } from "../cloud/common";
import { Store } from "../desktop/store";
test("cloud AES-GCM metadata authenticates ciphertext", () => {
  const key = crypto.randomBytes(32).toString("hex"),
    c = codec(key),
    data = c.encode("private settings");
  assert.ok(!data.includes(Buffer.from("private settings")));
  assert.equal(c.decode(data), "private settings");
  data[30] ^= 1;
  assert.throws(() => c.decode(data));
  assert.throws(() => codec("bad"));
});
test("fixed ten-profile shards preserve assignments and refuse reassignment of existing state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-shard-"));
  try {
    const c = codec(crypto.randomBytes(32).toString("hex"));
    const shard = new Store(root, c.encode, c.decode, ids(11, 10));
    await shard.init();
    assert.equal(shard.profiles.length, 10);
    assert.equal(shard.profiles[0].id, "profile-11");
    await shard.update("profile-11", { name: "Persistent cloud profile" });
    await assert.rejects(shard.update("profile-01", { name: "Wrong owner" }));
    const restored = new Store(root, c.encode, c.decode, ids(11, 10));
    await restored.init();
    assert.equal(restored.profiles[0].name, "Persistent cloud profile");
    await assert.rejects(
      new Store(root, c.encode, c.decode, ids(1, 10)).init(),
    );
    assert.throws(() => ids(25, 10));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
