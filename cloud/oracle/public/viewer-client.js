import RFB from "/viewer/core/rfb.js";
const scheme = location.protocol === "https:" ? "wss:" : "ws:";
const rfb = new RFB(
  document.getElementById("screen"),
  `${scheme}//${location.host}/viewer/websockify`,
  { shared: true },
);
rfb.scaleViewport = true;
rfb.resizeSession = false;
rfb.viewOnly = false;
rfb.addEventListener(
  "connect",
  () =>
    (document.getElementById("state").textContent =
      "Connected • Clipboard/file transfer disabled • session expires in 15 minutes"),
);
rfb.addEventListener(
  "disconnect",
  () =>
    (document.getElementById("state").textContent =
      "Disconnected. Re-authenticate from the dashboard if needed."),
);
document.getElementById("end").onclick = async () => {
  rfb.disconnect();
  await fetch("/viewer/logout", { method: "POST" });
  document.getElementById("screen").replaceChildren();
  document.getElementById("state").textContent = "Session ended";
};
window.addEventListener("pagehide", () => rfb.disconnect());
