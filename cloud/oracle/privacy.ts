import fs from "node:fs/promises";
import path from "node:path";
// Oracle profiles are newly allocated; do not offer to save website passwords.
// Preserve all unrelated Chromium preferences, including permission settings.
export async function disablePasswordSaving(directory: string) {
  const file = path.join(directory, "Default", "Preferences");
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let prefs: any = {};
  try {
    prefs = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw Error(
        "Invalid browser preferences; preserve profile and restore backup",
      );
  }
  if (
    !prefs ||
    typeof prefs !== "object" ||
    Array.isArray(prefs) ||
    (prefs.profile &&
      (typeof prefs.profile !== "object" || Array.isArray(prefs.profile)))
  )
    throw Error("Invalid browser preferences");
  prefs.profile ??= {};
  prefs.profile.password_manager_enabled = false;
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  await fs.writeFile(file + ".oracle-tmp", JSON.stringify(prefs), {
    mode: 0o600,
  });
  await fs.rename(file + ".oracle-tmp", file);
}
