const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") return;
  const root = context.appOutDir;
  // Resource editing in JavaScript keeps Linux cross-builds independent of Wine.
  const PE = require("pe-library");
  const RE = require("resedit");
  const exePath = path.join(
    root,
    context.packager.appInfo.productFilename + ".exe",
  );
  const exe = PE.NtExecutable.from(await fs.readFile(exePath));
  const resources = PE.NtExecutableResource.from(exe);
  const icon = RE.Data.IconFile.from(
    await fs.readFile(path.join(context.packager.projectDir, "build/icon.ico")),
  );
  for (const group of RE.Resource.IconGroupEntry.fromEntries(
    resources.entries,
  )) {
    RE.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map((item) => item.data),
    );
  }
  for (const version of RE.Resource.VersionInfo.fromEntries(
    resources.entries,
  )) {
    version.setFileVersion(1, 0, 0, 0, 1033);
    version.setProductVersion(1, 0, 0, 0, 1033);
    version.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: "Multi Browser Manager",
        ProductName: "Multi Browser Manager",
        CompanyName: "Multi-Browser Account Manager",
        OriginalFilename: "Multi Browser Manager.exe",
        InternalName: "Multi Browser Manager",
        LegalCopyright: "Multi Browser Manager contributors",
      },
    );
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  await fs.writeFile(exePath + ".tmp", Buffer.from(exe.generate()));
  await fs.rename(exePath + ".tmp", exePath);
  const files = [];
  const dirs = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(relative);
        dirs.push(relative);
      } else files.push(relative);
    }
  }
  await walk("");
  const esc = (s) =>
    s.replaceAll("$", "$$").replaceAll('"', '$\\"').replaceAll("/", "\\");
  const lines = [
    ...files.map((f) => `Delete "$INSTDIR\\${esc(f)}"`),
    ...dirs.map((d) => `RMDir "$INSTDIR\\${esc(d)}"`),
  ];
  await fs.writeFile(
    path.join(context.packager.projectDir, "build/uninstall-files.nsh"),
    lines.join("\n") + "\n",
  );
};
