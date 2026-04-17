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
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .card { background: white; border: 1px solid #ded6c6; border-radius: 8px; padding: 14px; }
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
    tokenInput.value = localStorage.getItem('agent-tick.adminToken') || '';
    tokenInput.addEventListener('input', () => localStorage.setItem('agent-tick.adminToken', tokenInput.value));

    function headers() {
      return { 'Authorization': 'Bearer ' + tokenInput.value, 'Content-Type': 'application/json' };
    }

    async function loadApprovals() {
      const response = await fetch('/v1/approval-requests', { headers: headers() });
      const approvals = await response.json();
      document.getElementById('approvals').innerHTML = approvals.map(renderApproval).join('');
    }

    async function createPairing() {
      const response = await fetch('/v1/pairing-tokens', { method: 'POST', headers: headers(), body: '{}' });
      const pairing = await response.json();
      document.getElementById('pairing').innerHTML = '<div class="card"><b>Pairing code</b><pre>' + pairing.token + '</pre><div class="meta">Expires ' + pairing.expiresAt + '</div></div>';
    }

    async function respond(id, choiceId) {
      await fetch('/v1/approval-requests/' + id + '/responses', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ choiceId })
      });
      await loadApprovals();
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

    loadApprovals().catch(console.error);
  </script>
</body>
</html>`

func (a *API) admin(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(adminHTML))
}
