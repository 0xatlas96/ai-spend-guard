export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI Spend Guard</title>
<style>
  :root {
    color-scheme: light dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1020; color: #e8edf8; }
  main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 80px; }
  header { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:24px; }
  h1 { font-size: 24px; margin:0; letter-spacing:-.02em; }
  .sub { color:#9aa7bd; font-size:13px; margin-top:5px; }
  button,input,select { font:inherit; }
  button { cursor:pointer; border:1px solid #32405e; background:#16213a; color:#e8edf8; border-radius:10px; padding:9px 12px; }
  button:hover { background:#1d2a47; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:14px; }
  .card { border:1px solid #23304b; background:#111a2e; border-radius:16px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.18); }
  .card h2 { font-size:14px; margin:0 0 12px; color:#cbd5e7; }
  .metric { font-size:30px; font-weight:700; letter-spacing:-.03em; }
  .muted { color:#8d9ab1; font-size:12px; }
  .bar { height:8px; background:#202d47; border-radius:999px; overflow:hidden; margin-top:10px; }
  .bar > span { display:block; height:100%; background:linear-gradient(90deg,#61a7ff,#7ee0c3); width:0; }
  .danger > span { background:linear-gradient(90deg,#ffb15f,#ff6b74); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:10px 8px; border-bottom:1px solid #202c45; vertical-align:top; }
  th { color:#9aa7bd; font-weight:600; }
  code { color:#9fe8d2; }
  .pill { display:inline-block; border:1px solid #344361; border-radius:999px; padding:3px 8px; font-size:11px; color:#b7c3d9; }
  .warn { color:#ffc46b; }
  .bad { color:#ff7f88; }
  .good { color:#85e0be; }
  .section { margin-top:18px; }
  form { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; align-items:end; }
  label { display:flex; flex-direction:column; gap:6px; color:#9aa7bd; font-size:12px; }
  input,select { width:100%; border:1px solid #32405e; background:#0f1729; color:#e8edf8; border-radius:10px; padding:9px 10px; }
  pre { white-space:pre-wrap; word-break:break-word; background:#0a1121; border:1px solid #222f49; border-radius:12px; padding:12px; font-size:12px; min-height:72px; }
  #auth { display:none; gap:8px; align-items:center; }
  #auth input { width:220px; }
  @media (max-width: 640px) {
    header { align-items:flex-start; flex-direction:column; }
    .metric { font-size:24px; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>AI Spend Guard</h1>
      <div class="sub">Local financial firewall control center</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <div id="auth"><input id="token" type="password" placeholder="Bearer token" /><button id="saveToken">Connect</button></div>
      <button id="refresh">Refresh</button>
    </div>
  </header>

  <div class="grid" id="summary"></div>

  <section class="card section">
    <h2>Policies</h2>
    <div style="overflow:auto">
      <table>
        <thead><tr><th>Policy</th><th>Mode</th><th>Usage</th><th>Calls</th><th>In-flight</th><th>Groups</th></tr></thead>
        <tbody id="policies"></tbody>
      </table>
    </div>
  </section>

  <section class="card section">
    <h2>Explain a request — no spend is reserved</h2>
    <form id="explainForm">
      <label>Provider<input name="provider" placeholder="openai" /></label>
      <label>Resource<select name="resource"><option>llm</option><option>image</option><option>audio</option><option>video</option><option>embedding</option><option>search</option><option>tool</option><option>api</option><option>other</option></select></label>
      <label>Model<input name="model" placeholder="optional" /></label>
      <label>User ID<input name="userId" placeholder="optional" /></label>
      <label>Project ID<input name="projectId" placeholder="optional" /></label>
      <label>Agent ID<input name="agentId" placeholder="optional" /></label>
      <label>Session ID<input name="sessionId" placeholder="optional" /></label>
      <label>Estimated USD<input name="cost" type="number" min="0" step="0.000001" value="0.05" required /></label>
      <button type="submit">Explain</button>
    </form>
    <pre id="explainResult">Submit a hypothetical paid operation to see which policies would allow or block it.</pre>
  </section>

  <section class="card section">
    <h2>Open reservations</h2>
    <div style="overflow:auto">
      <table>
        <thead><tr><th>ID</th><th>Provider</th><th>Estimate</th><th>Age</th><th>Status</th><th>Context</th></tr></thead>
        <tbody id="reservations"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (n) => '$' + Number(n || 0).toFixed(4);
  const age = (ms) => ms < 60000 ? Math.round(ms/1000)+'s' : ms < 3600000 ? Math.round(ms/60000)+'m' : ms < 86400000 ? (ms/3600000).toFixed(1)+'h' : (ms/86400000).toFixed(1)+'d';

  function headers() {
    const token = sessionStorage.getItem('asg-token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type':'application/json', ...headers(), ...(options.headers || {}) }
    });
    if (response.status === 401) {
      $('auth').style.display = 'flex';
      throw new Error('Authentication required');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || response.statusText);
    return body;
  }

  function budgetPercent(policy, usage) {
    const limit = policy.limitUsd;
    if (typeof limit !== 'number' || limit <= 0) return 0;
    return Math.max(0, Math.min(100, usage.projectedUsd / limit * 100));
  }

  async function refresh() {
    try {
      const [status, reservations] = await Promise.all([
        api('/api/status'),
        api('/api/reservations')
      ]);

      const totalActual = status.policies.length ? Math.max(...status.policies.map(p => p.usage.actualUsd || 0)) : 0;
      const totalReserved = status.policies.length ? Math.max(...status.policies.map(p => p.usage.reservedUsd || 0)) : 0;
      $('summary').innerHTML = [
        ['Open reservations', status.openReservations, status.staleReservations ? '<span class="bad">'+status.staleReservations+' stale</span>' : '<span class="good">none stale</span>'],
        ['Largest policy actual', money(totalActual), 'settled spend'],
        ['Largest policy reserved', money(totalReserved), 'in-flight estimate'],
        ['Policies', status.policies.length, status.policies.filter(p => p.policy.mode === 'observe').length + ' observe-only']
      ].map(([title,value,foot]) => '<div class="card"><h2>'+esc(title)+'</h2><div class="metric">'+esc(value)+'</div><div class="muted">'+foot+'</div></div>').join('');

      $('policies').innerHTML = status.policies.map(entry => {
        const pct = budgetPercent(entry.policy, entry.usage);
        const usage = typeof entry.policy.limitUsd === 'number'
          ? money(entry.usage.projectedUsd) + ' / ' + money(entry.policy.limitUsd)
          : money(entry.usage.projectedUsd);
        const calls = typeof entry.policy.limitCalls === 'number'
          ? entry.usage.projectedCalls + ' / ' + entry.policy.limitCalls
          : entry.usage.projectedCalls;
        const concurrent = typeof entry.policy.maxConcurrent === 'number'
          ? entry.usage.concurrent + ' / ' + entry.policy.maxConcurrent
          : entry.usage.concurrent;
        const groups = (entry.groups || []).slice(0,6).map(g => '<div><code>'+esc(g.group.key)+'</code> — '+money(g.usage.projectedUsd)+'</div>').join('') + ((entry.groups || []).length > 6 ? '<div class="muted">+'+((entry.groups||[]).length-6)+' more</div>' : '');
        return '<tr><td><strong>'+esc(entry.policy.id)+'</strong><div class="bar '+(pct >= 95 ? 'danger':'')+'"><span style="width:'+pct+'%"></span></div></td><td><span class="pill">'+esc(entry.policy.mode || 'enforce')+'</span></td><td>'+esc(usage)+'</td><td>'+esc(calls)+'</td><td>'+esc(concurrent)+'</td><td>'+(groups || '—')+'</td></tr>';
      }).join('');

      $('reservations').innerHTML = reservations.length
        ? reservations.map(item => '<tr><td><code>'+esc(item.reservation.id)+'</code></td><td>'+esc(item.reservation.provider)+'</td><td>'+money(item.reservation.estimatedCostUsd)+'</td><td>'+age(item.ageMs)+'</td><td class="'+(item.stale?'bad':'good')+'">'+(item.stale?'STALE':'open')+'</td><td><code>'+esc(JSON.stringify(item.reservation.context || {}))+'</code></td></tr>').join('')
        : '<tr><td colspan="6" class="muted">No open reservations.</td></tr>';
    } catch (error) {
      $('summary').innerHTML = '<div class="card"><h2>Status</h2><div class="bad">'+esc(error.message)+'</div></div>';
    }
  }

  $('refresh').addEventListener('click', refresh);
  $('saveToken').addEventListener('click', () => {
    sessionStorage.setItem('asg-token', $('token').value);
    $('auth').style.display = 'none';
    refresh();
  });

  $('explainForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const context = {};
    for (const key of ['provider','resource','model','userId','projectId','agentId','sessionId']) {
      const v = data.get(key);
      if (v) context[key] = v;
    }
    try {
      const result = await api('/api/explain', {
        method:'POST',
        body: JSON.stringify({
          context,
          estimatedCostUsd: Number(data.get('cost'))
        })
      });
      $('explainResult').textContent = JSON.stringify(result, null, 2);
      $('explainResult').className = result.allowed ? 'good' : 'bad';
    } catch (error) {
      $('explainResult').textContent = error.message;
      $('explainResult').className = 'bad';
    }
  });

  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;
}
