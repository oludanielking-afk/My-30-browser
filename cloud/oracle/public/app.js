let token = "",
  busy = false;
const $ = (id) => document.getElementById(id);
let last;
async function api(path, method = "GET", body) {
  const r = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request rejected");
  return data;
}
function message(e) {
  $("message").textContent = String(e.message || e);
}
$("login").onsubmit = async (e) => {
  e.preventDefault();
  token = $("token").value;
  $("token").value = "";
  await refresh();
};
$("disconnect").onclick = async () => {
  await fetch("/viewer/logout", { method: "POST" }).catch(() => {});
  token = "";
  $("profiles").replaceChildren();
  $("overview").replaceChildren();
  $("viewer-link").hidden = true;
  message("Disconnected. Viewer sessions expire after 15 minutes.");
};
$("viewer").onclick = async () => {
  try {
    const r = await api("/api/viewer-session", "POST");
    $("viewer-link").href = r.url;
    $("viewer-link").hidden = false;
    message(
      "Viewer session created. Use the link, then End session when finished.",
    );
  } catch (e) {
    message(e);
  }
};
function node(tag, text) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
async function refresh() {
  if (!token || busy) return;
  busy = true;
  try {
    const s = await api("/api/status");
    last = s;
    const r = s.resources;
    $("overview").replaceChildren(
      ...[
        `Worker: ${s.application} • uptime ${Math.floor(s.uptimeSeconds)}s`,
        `Alerts: ${s.alerts?.join("; ") || "none"}`,
        `Active ${s.running} / ${s.effectiveLimit} effective (${s.profiles.length} slots)`,
        `CPU ${r.cpuPercent.toFixed(1)}% of available cores • ${r.cores} cores`,
        `RAM available ${r.availableMB.toFixed(0)} MiB / limit ${r.memoryLimitMB.toFixed(0)} MiB`,
        `Disk free ${r.diskFreeMB.toFixed(0)} MiB • crashes ${s.crashes}`,
      ].map((v) => node("article", v)),
    );
    $("capacity").textContent =
      s.calibration +
      `. Configured ceiling ${s.policy.configured}; memory reserve ${s.policy.reserveMB} MiB.`;
    $("events").textContent = s.events
      .slice(-12)
      .map((e) => `${new Date(e.time).toLocaleString()} ${e.id}: ${e.kind}`)
      .join("\n");
    if (!$("profiles").contains(document.activeElement))
      $("profiles").replaceChildren(...s.profiles.map(card));
    message("Connected • private single-worker management");
  } catch (e) {
    message(e);
  } finally {
    busy = false;
  }
}
function card(p) {
  const c = node("article");
  c.className = "profile";
  c.append(
    node("h2", p.name),
    node("p", `${p.id} • ${p.state} • ${p.mode}`),
    node(
      "p",
      `Page: ${p.health ? (p.health.responsive ? "responsive" : "unresponsive") : "not checked"} • Login: unknown`,
    ),
  );
  const f = node("form");
  const fields = {};
  function field(key, label, value, type = "text") {
    const l = node("label", label),
      i = node("input");
    i.type = type;
    if (type === "checkbox") i.checked = value;
    else i.value = value;
    i.name = key;
    fields[key] = i;
    l.append(i);
    f.append(l);
    return i;
  }
  field("name", "Display name", p.name);
  field("url", "Assigned HTTPS website", p.url, "url");
  field(
    "ownerAcknowledged",
    "Owner authorization acknowledged",
    p.ownerAcknowledged,
    "checkbox",
  );
  field(
    "autoReload",
    "Controlled reload (off = idle)",
    p.autoReload,
    "checkbox",
  );
  field("minSeconds", "Minimum seconds", p.minSeconds, "number").min = 120;
  field("maxSeconds", "Maximum seconds", p.maxSeconds, "number").max = 300;
  field("notes", "Administrator notes", p.notes).maxLength = 2000;
  const save = node("button", "Save while stopped");
  save.disabled = p.browserOpen;
  f.append(save);
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(
        Object.entries(fields).map(([k, i]) => [
          k,
          i.type === "checkbox"
            ? i.checked
            : i.type === "number"
              ? Number(i.value)
              : i.value,
        ]),
      );
      await api("/api/profiles/" + p.id, "PATCH", body);
      await refresh();
    } catch (e) {
      message(e);
    }
  };
  c.append(f);
  const controls = node("div");
  for (const action of [
    "start",
    "stop",
    "restart",
    "pause",
    "resume",
    "view",
  ]) {
    const b = node("button", action);
    b.onclick = async () => {
      try {
        await api(`/api/profiles/${p.id}/${action}`, "POST");
        await refresh();
        if (action === "view") $("viewer").click();
      } catch (e) {
        message(e);
      }
    };
    controls.append(b);
  }
  c.append(
    controls,
    node(
      "p",
      `Launched: ${p.lastLaunch ? new Date(p.lastLaunch).toLocaleString() : "—"} • Reloads ${p.reloadCount} • Last reload ${p.lastReload ? new Date(p.lastReload).toLocaleString() : "—"}`,
    ),
    node(
      "p",
      `Recovery attempts ${p.attempts}/3${p.blocked ? " • exhausted; manual review required" : ""}`,
    ),
    node("p", p.lastError || p.error || p.note || ""),
  );
  return c;
}
setInterval(refresh, 5000);
