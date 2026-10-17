const $ = (id) => document.getElementById(id);
let token = "",
  snapshot,
  busy = false,
  refreshing = false;
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
async function request(route, method = "GET", body) {
  const response = await fetch(route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "HTTP " + response.status);
  return data;
}
async function run(fn) {
  if (busy) return;
  busy = true;
  $("error").textContent = "";
  try {
    await fn();
    await refresh();
  } catch (e) {
    $("error").textContent = e.message;
  } finally {
    busy = false;
  }
}
function button(text, fn, disabled = false) {
  const b = el("button", text);
  b.disabled = disabled;
  b.onclick = () => run(fn);
  return b;
}
async function refresh() {
  if (!token || refreshing) return;
  refreshing = true;
  try {
    snapshot = await request("/api/status");
    $("total").textContent =
      `${snapshot.running} / 30 observed active · ${snapshot.allHealthy ? "all workers healthy" : "worker unavailable"}`;
    $("workers").replaceChildren();
    for (const w of snapshot.workers) {
      const box = el("article", undefined, "worker");
      box.append(
        el("h2", w.id),
        el(
          "div",
          w.healthy ? "Healthy" : "Unavailable",
          w.healthy ? "healthy" : "unhealthy",
        ),
      );
      if (w.healthy) {
        const r = w.resources;
        box.append(
          el("div", `${w.running} active / ${w.maxActive} slots`),
          el(
            "div",
            `CPU ${r.cpuPercent.toFixed(1)}% (${r.cpuScope}; 100%=1 core)`,
          ),
          el(
            "div",
            `RAM ${Math.round(r.cgroupUsedMB ?? r.treeRssMB)} MB${r.memoryLimitMB ? " / " + Math.round(r.memoryLimitMB) + " MB" : ""}`,
          ),
          el(
            "div",
            `${r.processes} processes · ${w.incidents} crash/close incidents`,
          ),
        );
        const last = w.recentIncidents?.at(-1);
        if (last)
          box.append(
            el(
              "div",
              `Last: ${last.id} · ${last.kind} · ${new Date(last.time).toLocaleTimeString()}`,
              "note",
            ),
          );
        const blocked = Object.values(w.recovery || {}).filter(
          (f) => f.blocked,
        ).length;
        if (blocked)
          box.append(
            el(
              "div",
              `${blocked} recovery budgets exhausted; operator action required`,
              "unhealthy",
            ),
          );
      } else
        box.append(el("div", w.error || "Waiting for first health response"));
      $("workers").append(box);
    }
    if (document.activeElement?.matches(".profile input")) return;
    $("profiles").replaceChildren();
    for (const p of snapshot.profiles) {
      const card = el("article", undefined, "profile"),
        open = p.browserOpen,
        state = el("div", p.state, p.state === "running" ? "healthy" : "");
      card.append(el("h2", p.name || p.id), el("small", p.id), state);
      if (p.url) {
        const url = el("input");
        url.type = "url";
        url.value = p.url;
        url.disabled = open;
        url.setAttribute("aria-label", "Assigned HTTPS website for " + p.id);
        const name = el("input");
        name.value = p.name;
        name.maxLength = 80;
        name.disabled = open;
        name.setAttribute("aria-label", "Profile name for " + p.id);
        const min = el("input"),
          max = el("input");
        for (const input of [min, max]) {
          input.type = "number";
          input.min = "120";
          input.max = "300";
          input.disabled = open;
        }
        min.value = p.minSeconds;
        max.value = p.maxSeconds;
        min.setAttribute("aria-label", "Minimum reload seconds");
        max.setAttribute("aria-label", "Maximum reload seconds");
        const interval = el("div", undefined, "row");
        interval.append(min, max);
        const row = el("div", undefined, "row");
        row.append(
          button(
            "Save settings",
            () =>
              request("/api/profiles/" + p.id, "PATCH", {
                name: name.value,
                url: url.value,
                minSeconds: Number(min.value),
                maxSeconds: Number(max.value),
              }),
            open,
          ),
        );
        card.append(name, url, interval, row);
        const actions = el("div", undefined, "row");
        actions.append(
          button(
            open ? "Stop" : "Start",
            () =>
              request(
                `/api/profiles/${p.id}/${open ? "stop" : "start"}`,
                "POST",
              ),
            p.state === "starting",
          ),
          button(
            "Pause reload",
            () => request(`/api/profiles/${p.id}/pause`, "POST"),
            !open,
          ),
          button(
            "Resume",
            () => request(`/api/profiles/${p.id}/resume`, "POST"),
            !open,
          ),
        );
        card.append(actions);
        const auto = el("input");
        auto.type = "checkbox";
        auto.checked = p.autoReload;
        auto.disabled = open;
        auto.onchange = () =>
          run(() =>
            request("/api/profiles/" + p.id, "PATCH", {
              autoReload: auto.checked,
            }),
          );
        const label = el("label", "Auto reload 120–300s");
        label.prepend(auto);
        card.append(label);
        if (p.nextReload)
          card.append(
            el(
              "div",
              "Next reload " + new Date(p.nextReload).toLocaleTimeString(),
            ),
          );
      }
      if (p.note || p.error) card.append(el("p", p.error || p.note, "note"));
      $("profiles").append(card);
    }
  } finally {
    refreshing = false;
  }
}
$("connect").onclick = () =>
  run(async () => {
    token = $("token").value.trim();
    await refresh();
    $("token").value = "";
  });
$("disconnect").onclick = () => {
  token = "";
  snapshot = undefined;
  $("profiles").replaceChildren();
  $("workers").replaceChildren();
  $("total").textContent = "Disconnected";
};
for (const [id, action] of [
  ["start-all", "start"],
  ["stop-all", "stop"],
])
  $(id).onclick = () =>
    run(async () => {
      if (!snapshot) throw Error("Connect first");
      for (const w of snapshot.workers) {
        if (!w.healthy) throw Error("All workers must be healthy");
      }
      await Promise.all(
        snapshot.workers.map(async (w) => {
          for (const p of w.profiles) {
            if (action === "start" && p.browserOpen) continue;
            await request(`/api/profiles/${p.id}/${action}`, "POST");
          }
        }),
      );
    });
setInterval(
  () => refresh().catch((e) => ($("error").textContent = e.message)),
  5000,
);
