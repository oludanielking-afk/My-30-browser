const { build, Platform, Arch } = require("electron-builder");
build({
  publish: "never",
  targets: Platform.WINDOWS.createTarget(["nsis", "portable"], Arch.x64),
  config: { extraResources: [{ from: "windows-browsers", to: "browsers" }] },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
