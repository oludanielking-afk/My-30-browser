import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { API, ProfileView, Snapshot } from "../desktop/types";
import "./style.css";
declare global {
  interface Window {
    manager: API;
  }
}
const api = window.manager;
function App() {
  const [data, setData] = useState<Snapshot>(),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [editing, setEditing] = useState<ProfileView>(),
    [busy, setBusy] = useState<string[]>([]),
    [cloud, setCloud] = useState(false),
    [connected, setConnected] = useState(false),
    [url, setUrl] = useState(""),
    [token, setToken] = useState("");
  async function refresh() {
    setData(await api.snapshot());
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const i = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(i);
  }, []);
  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy((x) => [...x, id]);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy((x) => x.filter((y) => y !== id));
    }
  }
  const profiles =
    data?.profiles.filter(
      (p) =>
        (filter === "all" ||
          (filter === "running"
            ? p.state === "running"
            : p.state === "stopped" || p.state === "error")) &&
        (p.name + " " + p.url + " " + p.id)
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="logo">▦</span> MULTI<span className="muted">/</span>
          BROWSER
        </div>
        <div className="workspace">WORKSPACE</div>
        <button className="nav selected" onClick={() => setFilter("all")}>
          ▦ <span>Browser profiles</span>
          <b>30</b>
        </button>
        <button className="nav" onClick={() => setCloud(true)}>
          ☁ <span>Cloud connection</span>
        </button>
        <div className="aside-bottom">
          <div className="secure">● Local-first storage</div>
          <p>
            Independent sessions.
            <br />
            Your accounts stay yours.
          </p>
          <small>DESKTOP · v1.0.0</small>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <span>/</span> Browser profiles
          </div>
          <button onClick={() => setCloud(true)} className="connection">
            <i /> {connected ? "Cloud worker" : "Local machine"}
          </button>
        </header>
        <section className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">YOUR BROWSER WORKSPACE</div>
              <h1>
                Browser profiles<span>.</span>
              </h1>
              <p>Thirty independent spaces. One place to manage them.</p>
            </div>
            <div className="shield">◇ Geolocation blocked by default</div>
          </div>
          <div className="stats">
            <div>
              <span>Total profiles</span>
              <strong>
                {data?.profiles.length ?? "—"}
                <small>persistent workspaces</small>
              </strong>
            </div>
            <div>
              <span>Active browsers</span>
              <strong className="green">
                {data?.running ?? 0}
                <small>of {data?.maxActive ?? 5} available</small>
              </strong>
            </div>
            <div>
              <span>Auto reload</span>
              <strong>
                {data?.profiles.filter((p) => p.autoReload).length ?? 0}
                <small>120–300 second intervals</small>
              </strong>
            </div>
            <div>
              <span>Session isolation</span>
              <strong className="text-value">
                Always on<small>separate cookies & storage</small>
              </strong>
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          <div className="toolbar">
            <div className="tabs">
              {["all", "running", "stopped"].map((f) => (
                <button
                  key={f}
                  className={filter === f ? "active" : ""}
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? "All profiles"
                    : f === "running"
                      ? "Running"
                      : "Stopped"}
                </button>
              ))}
            </div>
            <input
              aria-label="Search profiles"
              className="search"
              placeholder="⌕  Search profiles or websites"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="limit">
              Active limit{" "}
              <select
                aria-label="Active browser limit"
                value={data?.maxActive ?? 5}
                disabled={connected}
                onChange={(e) =>
                  void run("limit", () => api.limit(Number(e.target.value)))
                }
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid">
            {profiles.map((p, i) => {
              const active = p.state === "running",
                open = p.browserOpen ?? (active || p.state === "starting");
              return (
                <article className="profile" key={p.id}>
                  <div className="card-top">
                    <div className={"avatar a" + (i % 4)}>{p.id.slice(-2)}</div>
                    <span className={"badge " + p.state}>
                      <i />
                      {p.state}
                    </span>
                    <button
                      aria-label={"Edit " + p.name}
                      className="more"
                      disabled={open}
                      onClick={() =>
                        setEditing({
                          ...p,
                          minSeconds: p.minSeconds ?? 120,
                          maxSeconds: p.maxSeconds ?? 300,
                        })
                      }
                    >
                      ···
                    </button>
                  </div>
                  <h2>{p.name}</h2>
                  <div className="website">↗ {new URL(p.url).hostname}</div>
                  <div className="reload-line">
                    <span>⟳ Auto reload</span>
                    <button
                      disabled={busy.includes(p.id) || active}
                      className={"toggle " + (p.autoReload ? "on" : "")}
                      aria-label={"Toggle automatic reload for " + p.name}
                      aria-pressed={p.autoReload}
                      onClick={() =>
                        void run(p.id, async () => {
                          if (active)
                            throw Error(
                              "Close the browser before changing reload configuration. Use Pause or Resume while running.",
                            );
                          await api.update(p.id, { autoReload: !p.autoReload });
                        })
                      }
                    >
                      <i />
                    </button>
                  </div>
                  <div className="schedule">
                    {p.nextReload
                      ? `Next reload · ${new Date(p.nextReload).toLocaleTimeString()}`
                      : p.autoReload
                        ? `${p.minSeconds ?? 120}–${p.maxSeconds ?? 300}s · ${active ? "paused" : "starts with browser"}`
                        : "Manual browsing · reload off"}
                  </div>
                  {(p.note || p.error) && (
                    <div className="note">{p.error || p.note}</div>
                  )}
                  <div className="card-actions">
                    <button
                      className={open ? "secondary" : "primary"}
                      disabled={busy.includes(p.id)}
                      onClick={() =>
                        void run(p.id, () =>
                          api.action(p.id, open ? "stop" : "start"),
                        )
                      }
                    >
                      {busy.includes(p.id)
                        ? "Working…"
                        : open
                          ? "■  Close browser"
                          : "▶  Open browser"}
                    </button>
                    {active && (
                      <>
                        <button
                          title="Reload (120-second cooldown)"
                          onClick={() =>
                            void run(p.id, () => api.action(p.id, "reload"))
                          }
                        >
                          ⟳
                        </button>
                        {!connected && (
                          <button
                            title={
                              p.nextReload ? "Pause reloads" : "Resume reloads"
                            }
                            disabled={!p.autoReload}
                            onClick={() =>
                              void run(p.id, () =>
                                api.action(
                                  p.id,
                                  p.nextReload ? "pause" : "resume",
                                ),
                              )
                            }
                          >
                            {p.nextReload ? "Ⅱ" : "▷"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {profiles.length === 0 && (
            <p className="empty">No profiles match your search.</p>
          )}
          <footer>
            <span>● Profile data is saved automatically</span>
            <span>Visible Chromium · No fingerprint spoofing</span>
          </footer>
        </section>
      </main>
      {editing && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(editing.id, async () => {
                await api.update(editing.id, {
                  name: editing.name,
                  url: editing.url,
                  autoReload: editing.autoReload,
                  minSeconds: Number(editing.minSeconds),
                  maxSeconds: Number(editing.maxSeconds),
                });
                setEditing(undefined);
              });
            }}
          >
            <div className="eyebrow">PROFILE SETTINGS</div>
            <h2>{editing.name}</h2>
            {error && (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            )}
            <label>
              Name
              <input
                required
                maxLength={80}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Assigned HTTPS website
              <input
                required
                type="url"
                value={editing.url}
                onChange={(e) =>
                  setEditing({ ...editing, url: e.target.value })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.autoReload}
                onChange={(e) =>
                  setEditing({ ...editing, autoReload: e.target.checked })
                }
              />
              Enable automatic reload
            </label>
            <div className="interval">
              <label>
                Minimum seconds
                <input
                  type="number"
                  min={120}
                  max={300}
                  value={editing.minSeconds}
                  onChange={(e) =>
                    setEditing({ ...editing, minSeconds: +e.target.value })
                  }
                />
              </label>
              <label>
                Maximum seconds
                <input
                  type="number"
                  min={120}
                  max={300}
                  value={editing.maxSeconds}
                  onChange={(e) =>
                    setEditing({ ...editing, maxSeconds: +e.target.value })
                  }
                />
              </label>
            </div>
            <p>
              Reloads pause on edited forms, navigation changes and server
              throttling. Profile cookies are kept when you close a browser.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
              <button className="primary" disabled={busy.includes(editing.id)}>
                Save settings
              </button>
            </div>
          </form>
        </div>
      )}
      {cloud && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run("worker", async () => {
                await api.worker(url, token);
                setConnected(true);
                setToken("");
                setCloud(false);
              });
            }}
          >
            <div className="eyebrow">OPTIONAL CONNECTION</div>
            <h2>Connect a cloud worker</h2>
            {error && (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            )}
            <p>
              Use the included worker behind an authenticated HTTPS gateway.
              Manual cloud logins require a separately secured remote desktop.
              Local sessions are never uploaded. Tokens remain in memory only.
            </p>
            <label>
              Worker origin
              <input
                type="url"
                required
                placeholder="https://worker.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Admin token
              <input
                type="password"
                required
                minLength={24}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCloud(false)}>
                Cancel
              </button>
              {connected && (
                <button
                  type="button"
                  onClick={() =>
                    void run("worker", async () => {
                      await api.disconnect();
                      setConnected(false);
                      setCloud(false);
                    })
                  }
                >
                  Use local
                </button>
              )}
              <button className="primary" disabled={busy.includes("worker")}>
                Connect
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
