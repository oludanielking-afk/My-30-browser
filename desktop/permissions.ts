import fs from "node:fs/promises";
import path from "node:path";

// Apply Chromium's native default before launch, including on versions where
// Browser.setPermission without an origin does not affect permission queries.
// Keep unrelated generated browser preferences intact.
export async function denyGeolocation(profileDirectory: string) {
  const directory = path.join(profileDirectory, "Default");
  const file = path.join(directory, "Preferences");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let preferences: any = {};
  try {
    preferences = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error: any) {
    if (error.code !== "ENOENT")
      throw Error(
        "Cannot read browser preferences; no profile data was overwritten.",
      );
  }
  const object = (value: any) =>
    value && typeof value === "object" && !Array.isArray(value);
  if (!object(preferences))
    throw Error(
      "Invalid browser preferences; no profile data was overwritten.",
    );
  preferences.profile ??= {};
  if (!object(preferences.profile))
    throw Error("Invalid browser profile preferences");
  preferences.profile.default_content_setting_values ??= {};
  if (!object(preferences.profile.default_content_setting_values))
    throw Error("Invalid permission preferences");
  preferences.profile.default_content_setting_values.geolocation = 2;
  const exceptions =
    preferences.profile.content_settings?.exceptions?.geolocation;
  if (object(exceptions)) {
    for (const entry of Object.values(exceptions)) {
      if (object(entry)) (entry as any).setting = 2;
    }
  }
  await fs.writeFile(file + ".tmp", JSON.stringify(preferences), {
    mode: 0o600,
  });
  await fs.rename(file + ".tmp", file);
}
