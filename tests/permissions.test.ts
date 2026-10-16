import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { denyGeolocation } from "../desktop/permissions";
test("default geolocation denial preserves unrelated preferences and blocks saved grants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mbam-permissions-"));
  try {
    await denyGeolocation(root);
    const file = path.join(root, "Default", "Preferences");
    const prefs = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(prefs.profile.default_content_setting_values.geolocation, 2);
    prefs.custom = { keep: true };
    prefs.profile.default_content_setting_values.notifications = 1;
    prefs.profile.content_settings = {
      exceptions: {
        geolocation: {
          "https://example.com,*": { setting: 1, last_modified: "123" },
        },
      },
    };
    await fs.writeFile(file, JSON.stringify(prefs));
    await denyGeolocation(root);
    const updated = JSON.parse(await fs.readFile(file, "utf8"));
    assert.deepEqual(updated.custom, { keep: true });
    assert.equal(
      updated.profile.default_content_setting_values.notifications,
      1,
    );
    assert.equal(
      updated.profile.content_settings.exceptions.geolocation[
        "https://example.com,*"
      ].setting,
      2,
    );
    await fs.writeFile(file, "corrupt");
    await assert.rejects(
      denyGeolocation(root),
      /no profile data was overwritten/,
    );
    assert.equal(await fs.readFile(file, "utf8"), "corrupt");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
