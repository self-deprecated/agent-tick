<script lang="ts">
	let { onSignIn }: { onSignIn: () => void | Promise<void> } = $props();
</script>

<div class="auth-copy" data-testid="account-entry">
	<p class="eyebrow">Agent Tick</p>
	<h2>Sign in or create account</h2>
	<p class="subtle">Create your account first. Then Agent Tick will guide you through one agent token, one CLI setup command, and the mobile app.</p>
	<p class="subtle">Approvals, rules, and team settings stay hidden until there is something real to configure.</p>
</div>
<div class="clerk-card stack" aria-label="Clerk account entry">
	<p class="eyebrow">Secured by Clerk</p>
	<button class="provider-button" onclick={() => void onSignIn()}>Continue with GitHub</button>
	<button class="provider-button" onclick={() => void onSignIn()}>Continue with Google</button>
	<button class="provider-button" onclick={() => void onSignIn()}>Continue with Apple</button>
	<div class="divider">or continue with email</div>
	<button onclick={() => void onSignIn()}>Sign in or create account</button>
</div>

<style>
	.stack {
		display: grid;
		gap: 14px;
	}

	.auth-copy {
		max-width: 620px;
	}

	.eyebrow {
		margin: 0 0 6px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
		font-weight: 800;
		color: #38bdf8;
	}

	h2,
	p {
		margin: 0;
	}

	.subtle {
		color: #64748b;
		line-height: 1.6;
	}

	.clerk-card {
		min-width: min(360px, 100%);
		padding: 18px;
		border: 1px solid #dbeafe;
		border-radius: 22px;
		background: linear-gradient(180deg, #ffffff, #f8fbff);
		box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 10px 16px;
		font-weight: 700;
		cursor: pointer;
		background: linear-gradient(135deg, #38bdf8, #2563eb);
		color: white;
	}

	.provider-button {
		background: white;
		color: #0f172a;
		border: 1px solid #dbeafe;
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #94a3b8;
		font-size: 0.85rem;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: #dbeafe;
	}
</style>
