import RFB from "/viewer/core/rfb.js";
const scheme = location.protocol === "https:" ? "wss:" : "ws:";
const rfb = new RFB(
  document.getElementById("screen"),
  `${scheme}//${location.host}/viewer/websockify`,
  { shared: true },
);
let ending = false,
  ended = false;
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
    (document.getElementById("state").textContent = ended
      ? "Session ended"
      : ending
        ? "Ending session…"
        : "Disconnected. Re-authenticate from the dashboard if needed."),
);
document.getElementById("end").onclick = async () => {
  ending = true;
  rfb.disconnect();
  try {
    const response = await fetch("/viewer/logout", { method: "POST" });
    if (!response.ok && response.status !== 401)
      throw Error("Server logout rejected");
    ended = true;
    document.getElementById("screen").replaceChildren();
    document.getElementById("state").textContent = "Session ended";
  } catch {
    document.getElementById("state").textContent =
      "Viewer disconnected; server logout failed. Session expires within 15 minutes.";
  } finally {
    ending = false;
  }
};
window.addEventListener("pagehide", () => rfb.disconnect());
