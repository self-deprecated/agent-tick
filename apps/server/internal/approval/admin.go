package approval

import "net/http"

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
    <section class="toolbar">
      <input id="token" placeholder="Bearer token">
      <button onclick="loadApprovals()">Refresh</button>
      <button onclick="createPairing()">Pairing Code</button>
    </section>
    <section id="pairing"></section>
    <section id="approvals"></section>
  </main>
  <script>
    const tokenInput = document.getElementById('token');
    let pairingClearTimer;
    tokenInput.value = localStorage.getItem('agent-tick.adminToken') || '';
    tokenInput.addEventListener('input', () => localStorage.setItem('agent-tick.adminToken', tokenInput.value));

    function headers() {
      return { 'Authorization': 'Bearer ' + tokenInput.value, 'Content-Type': 'application/json' };
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

    async function createPairing() {
      try {
        const pairing = await requestJSON('/v1/pairing-tokens', { method: 'POST', body: '{}' });
        const expiresAt = new Date(pairing.expiresAt);
        document.getElementById('pairing').innerHTML = '<div class="card"><b>Pairing code</b><pre>' + escapeHTML(pairing.token) + '</pre><div class="meta">Secret. Expires ' + escapeHTML(expiresAt.toLocaleString()) + '.</div><button class="secondary" onclick="clearPairing()">Hide</button></div>';
        clearTimeout(pairingClearTimer);
        pairingClearTimer = setTimeout(clearPairing, Math.max(0, expiresAt.getTime() - Date.now()));
      } catch (error) {
        document.getElementById('pairing').innerHTML = renderError(error.message);
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
      document.getElementById('pairing').innerHTML = '';
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

    loadApprovals();
  </script>
</body>
</html>`

func (a *API) admin(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(adminHTML))
}
