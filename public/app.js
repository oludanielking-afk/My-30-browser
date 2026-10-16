const $ = id => document.getElementById(id);
let token = '';
async function request(path, method = 'GET', data) {
  const res = await fetch('/api' + path, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const parsed = await res.json();
  if (!res.ok) throw new Error(parsed.error || `HTTP ${res.status}`);
  return parsed;
}
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function button(label, fn) { const b = el('button', label); b.addEventListener('click', async () => { b.disabled = true; try { await fn(); await refresh(); } catch (e) { $('error').textContent = e.message; } finally { b.disabled = false; } }); return b; }
async function refresh() {
  if (!token) return;
  const data = await request('/profiles');
  $('summary').textContent = `${data.profiles.length} profiles · ${data.running} running · ${data.maxActive} maximum concurrently`;
  const cards = $('cards'); cards.replaceChildren();
  for (const p of data.profiles) {
    const card = el('article', undefined, 'card');
    const head = el('h2', p.name); card.append(head, el('div', `${p.id} — ${p.state}`, 'status'));
    const name = el('input'); name.value = p.name; name.setAttribute('aria-label', 'Profile name');
    const url = el('input'); url.value = p.url; url.setAttribute('aria-label', 'Website HTTPS URL');
    const toggler = el('input'); toggler.type = 'checkbox'; toggler.checked = p.autoReload;
    const label = el('label'); label.append(toggler, el('span', 'Automatic reload enabled'));
    const actions = el('div', undefined, 'row');
    const running = p.state === 'running', stopped = p.state === 'stopped' || p.state === 'error';
    const save = button('Save settings', () => request(`/profiles/${p.id}`, 'PATCH', { name: name.value, url: url.value, autoReload: toggler.checked })); save.disabled = !stopped;
    const start = button('Start', () => request(`/profiles/${p.id}/start`, 'POST')); start.disabled = !stopped;
    const stop = button('Stop', () => request(`/profiles/${p.id}/stop`, 'POST')); stop.disabled = stopped;
    const reload = button('Reload now', () => request(`/profiles/${p.id}/reload`, 'POST')); reload.disabled = !running;
    actions.append(save, start, stop, reload);
    card.append(name, url, label, actions);
    if (p.nextReload) card.append(el('div', `Next reload: ${new Date(p.nextReload).toLocaleTimeString()}`, 'small'));
    if (p.note || p.error) card.append(el('div', p.note || p.error, 'note'));
    cards.append(card);
  }
}
$('connect').addEventListener('click', async () => {
  token = $('token').value.trim(); $('error').textContent = '';
  try { await refresh(); $('token').value = ''; } catch (e) { $('error').textContent = e.message; token = ''; }
});
setInterval(() => { if (token) refresh().catch(e => { $('error').textContent = e.message; }); }, 10000);
