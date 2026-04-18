package approval

import (
	"net/http"
	"strconv"
	"strings"
)

const adminHTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Tick</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f7f2e8; color: #202124; }
    header { padding: 20px; display: flex; justify-content: space-between; align-items: center; }
    main { padding: 20px; display: grid; gap: 16px; }
    input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #ded6c6; }
    button { background: #202124; color: white; font-weight: 800; cursor: pointer; }
    button.secondary { background: white; color: #202124; }
    summary { cursor: pointer; font-weight: 900; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .card { background: white; border: 1px solid #ded6c6; border-radius: 8px; padding: 14px; }
    .error { background: #fff0f0; border-color: #c43737; color: #8a1f1f; }
    .meta { color: #6d6657; font-size: 13px; font-weight: 700; }
    pre { white-space: pre-wrap; background: #202124; color: #f8f5ed; padding: 12px; border-radius: 8px; overflow: auto; }
    .status { text-transform: uppercase; font-size: 12px; font-weight: 900; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Agent Tick</h1>
      <div class="meta">Approval dashboard</div>
    </div>
  </header>
  <main>
    <section class="toolbar" id="single-auth">
      <input id="token" type="password" autocomplete="off" placeholder="Bearer token">
      <button onclick="connectDashboard()">Connect</button>
      <button onclick="refreshDashboard()">Refresh</button>
    </section>
    <section class="toolbar" id="user-auth">
      <input id="email" type="email" autocomplete="username" placeholder="Email">
      <input id="password" type="password" autocomplete="current-password" placeholder="Password">
      <button onclick="loginDashboard()">Sign In</button>
      <button onclick="refreshDashboard()">Refresh</button>
    </section>
    <section id="session"></section>
    <section id="devices"></section>
    <section id="agents"></section>
    <section id="approvals"></section>
  </main>
  <script>
    const serverMode = "__MODE__";
    const serverPublicURL = "__PUBLIC_URL__" || window.location.origin;
    const tokenInput = document.getElementById('token');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    let pairingClearTimer;
    localStorage.removeItem('agent-tick.adminToken');
    document.getElementById('single-auth').style.display = serverMode === 'user' ? 'none' : 'flex';
    document.getElementById('user-auth').style.display = serverMode === 'user' ? 'flex' : 'none';
    tokenInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') connectDashboard();
    });
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loginDashboard();
    });

    function headers() {
      const output = { 'Content-Type': 'application/json' };
      if (tokenInput.value) output.Authorization = 'Bearer ' + tokenInput.value;
      return output;
    }

    async function loginDashboard() {
      document.getElementById('approvals').innerHTML = '<div class="card meta">Signing in...</div>';
      try {
        const session = await requestJSON('/v1/session', {
          method: 'POST',
          body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
        });
        passwordInput.value = '';
        renderSignedIn(session);
        await connectDashboard();
      } catch (error) {
        document.getElementById('approvals').innerHTML = renderError(error.message);
      }
    }

    async function connectDashboard() {
      clearPairing();
      await refreshDashboard();
    }

    async function refreshDashboard() {
      await Promise.all([loadDevices(), loadAgents(), loadApprovals()]);
    }

    async function loadDevices() {
      const target = document.getElementById('devices');
      target.innerHTML = '<details class="card"><summary>Devices</summary><div class="meta">Loading devices...</div>' + renderPairingEmpty() + '</details>';
      try {
        const devices = await requestJSON('/v1/devices');
        target.innerHTML = '<details class="card"><summary>Devices</summary>' + (
          devices.length
            ? devices.map(renderDevice).join('')
            : '<div class="meta">No paired devices yet.</div>'
        ) + renderPairingEmpty() + '</details>';
      } catch (error) {
        target.innerHTML = renderError(error.message);
      }
    }

    async function loadApprovals() {
      const target = document.getElementById('approvals');
      target.innerHTML = '<div class="card meta">Loading approvals...</div>';
      try {
        const approvals = await requestJSON('/v1/approval-requests');
        target.innerHTML = approvals.length
          ? approvals.map(renderApproval).join('')
          : '<div class="card meta">No approval requests yet.</div>';
      } catch (error) {
        target.innerHTML = renderError(error.message);
      }
    }

    async function loadAgents() {
      const target = document.getElementById('agents');
      target.innerHTML = '<details class="card"><summary>Agents</summary><div class="meta">Loading agents...</div></details>';
      try {
        const agents = await requestJSON('/v1/agent-tokens');
        const agentList = Array.isArray(agents) ? agents : [];
        target.innerHTML = '<details class="card"><summary>Agents</summary>' + (
          agentList.length
            ? agentList.map(renderAgent).join('')
            : '<div class="meta">No agent tokens yet.</div>'
        ) + '<div id="new-agent-token"><button class="secondary" onclick="createAgentToken()">Create Agent Token</button></div></details>';
      } catch (error) {
        target.innerHTML = renderError(error.message);
      }
    }

    async function createAgentToken() {
      const target = document.getElementById('new-agent-token');
      if (target) target.innerHTML = '<div class="meta">Creating token...</div>';
      try {
        const credential = await requestJSON('/v1/agent-tokens', {
          method: 'POST',
          body: JSON.stringify({ name: 'agent', scopes: ['approval:write'] })
        });
        const setup = 'agent-tick setup --server ' + shellQuote(serverPublicURL) + ' --token ' + shellQuote(credential.token);
        const test = "agent-tick request --title 'Run command?' --body 'Agent Tick test approval from the CLI' --command 'npm install'";
        if (target) target.innerHTML = '<div class="meta">Run setup once. The token will not be shown again.</div><pre>' + escapeHTML(setup + '\n' + test) + '</pre>';
      } catch (error) {
        if (target) target.innerHTML = renderError(error.message);
      }
    }

    async function createPairing() {
      try {
        const pairing = await requestJSON('/v1/pairing-tokens', { method: 'POST', body: '{}' });
        const expiresAt = new Date(pairing.expiresAt);
        const pairingTarget = document.getElementById('pairing');
        if (pairingTarget) pairingTarget.innerHTML = renderPairing(pairing.qrDataUrl, expiresAt);
        clearTimeout(pairingClearTimer);
        pairingClearTimer = setTimeout(clearPairing, Math.max(0, expiresAt.getTime() - Date.now()));
      } catch (error) {
        const pairingTarget = document.getElementById('pairing');
        if (pairingTarget) pairingTarget.innerHTML = renderError(error.message);
      }
    }

    async function respond(id, choiceId) {
      try {
        await requestJSON('/v1/approval-requests/' + id + '/responses', { method: 'POST', body: JSON.stringify({ choiceId }) });
        await loadApprovals();
      } catch (error) {
        document.getElementById('approvals').innerHTML = renderError(error.message);
      }
    }

    async function requestJSON(path, options = {}) {
      const response = await fetch(path, { ...options, headers: headers() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || response.statusText);
      }
      return body;
    }

    function clearPairing() {
      clearTimeout(pairingClearTimer);
      const pairingTarget = document.getElementById('pairing');
      if (pairingTarget) pairingTarget.innerHTML = renderPairingEmpty();
    }

    function renderPairingEmpty() {
      return '<div id="pairing"><div class="meta">Create a short-lived QR when you are ready to pair a phone.</div><button class="secondary" onclick="createPairing()">Create QR</button></div>';
    }

    function renderPairing(qrDataUrl, expiresAt) {
      const qr = qrDataUrl ? '<img alt="Pairing QR" src="' + escapeHTML(qrDataUrl) + '" style="width:220px;height:220px;image-rendering:pixelated;display:block;margin:12px 0;">' : '';
      return qr + '<div class="meta">Scan this QR in the phone app. The pairing secret is hidden and expires ' + escapeHTML(expiresAt.toLocaleString()) + '.</div><button class="secondary" onclick="createPairing()">Renew</button> <button class="secondary" onclick="clearPairing()">Clear</button>';
    }

    function renderSignedIn(session) {
      document.getElementById('user-auth').style.display = 'none';
      document.getElementById('session').innerHTML = '<div class="card meta">Signed in as ' + escapeHTML(session.userId) + '</div>';
    }

    function renderDevice(device) {
      const push = device.pushNotifications ? 'Push on' : 'Push off';
      if (device.unpairedAt) {
        return '<div><pre>' + escapeHTML(device.deviceId) + '</pre><div class="meta">' + escapeHTML(device.name) + ' · <span style="opacity:0.5">Unpaired ' + escapeHTML(new Date(device.unpairedAt).toLocaleString()) + '</span></div></div>';
      }
      return '<div><pre>' + escapeHTML(device.deviceId) + '</pre><div class="meta">' + escapeHTML(device.name) + ' · ' + push + ' · Paired ' + escapeHTML(new Date(device.createdAt).toLocaleString()) + '</div><button class="secondary" onclick="unpairDevice(' + JSON.stringify(device.deviceId) + ')">Revoke</button></div>';
    }

    async function unpairDevice(id) {
      if (!confirm('Revoke this device? The device will no longer be able to authenticate.')) return;
      try {
        await requestJSON('/v1/devices/' + id + '/unpair', { method: 'POST' });
        await loadDevices();
      } catch (error) {
        document.getElementById('devices').innerHTML = renderError(error.message);
      }
    }

    function renderAgent(agent) {
      if (agent.revokedAt) {
        return '<div><pre>' + escapeHTML(agent.agentId) + '</pre><div class="meta">' + escapeHTML(agent.name) + ' · <span style="opacity:0.5">Revoked ' + escapeHTML(new Date(agent.revokedAt).toLocaleString()) + '</span></div></div>';
      }
      return '<div><pre>' + escapeHTML(agent.agentId) + '</pre><div class="meta">' + escapeHTML(agent.name) + ' · Active · Created ' + escapeHTML(new Date(agent.createdAt).toLocaleString()) + '</div><button class="secondary" onclick="revokeAgent(' + JSON.stringify(agent.agentId) + ')">Revoke</button></div>';
    }

    async function revokeAgent(id) {
      if (!confirm('Revoke this agent token? This cannot be undone.')) return;
      try {
        await requestJSON('/v1/agent-tokens/' + id + '/revoke', { method: 'POST' });
        await loadAgents();
      } catch (error) {
        document.getElementById('agents').innerHTML = renderError(error.message);
      }
    }

    function shellQuote(value) {
      return "'" + String(value).replace(/'/g, "'\\''") + "'";
    }

    function renderApproval(approval) {
      const command = approval.command ? '<pre>' + escapeHTML(approval.command) + '</pre>' : '';
      const actions = approval.status === 'pending'
        ? '<button onclick="respond(\'' + approval.id + '\', \'approve\')">Approve</button> <button onclick="respond(\'' + approval.id + '\', \'deny\')">Deny</button>'
        : '';
      return '<div class="card"><div class="status">' + approval.status + '</div><h2>' + escapeHTML(approval.title) + '</h2><div class="meta">' + escapeHTML((approval.requester.host || approval.requester.name || 'Agent')) + '</div>' + command + '<div>' + actions + '</div></div>';
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderError(message) {
      return '<div class="card error"><b>Error</b><div>' + escapeHTML(message) + '</div></div>';
    }

    document.getElementById('approvals').innerHTML = serverMode === 'user'
      ? '<div class="card meta">Sign in to connect this dashboard.</div>'
      : '<div class="card meta">Enter the bearer token and press Enter.</div>';
    if (serverMode === 'user') {
      requestJSON('/v1/session')
        .then((session) => {
          renderSignedIn(session);
          return connectDashboard();
        })
        .catch(() => {});
    }
  </script>
</body>
</html>`

func (a *API) admin(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	publicURL := a.publicURL
	page := strings.NewReplacer(
		`"__MODE__"`, strconv.Quote(a.mode),
		`"__PUBLIC_URL__"`, strconv.Quote(publicURL),
	).Replace(adminHTML)
	_, _ = w.Write([]byte(page))
}
