<script lang="ts">
	let {
		hasAgentToken = false,
		hasCliHeartbeat = false,
		hasMobileDevice = false
	}: {
		hasAgentToken?: boolean;
		hasCliHeartbeat?: boolean;
		hasMobileDevice?: boolean;
	} = $props();
</script>

<div class="setup-steps">
	<div class="setup-step" data-testid="onboarding-create-token" class:is-complete={hasAgentToken}>
		<strong>1. Create an agent token</strong>
		<span>Name your local agent below, copy the config command, and paste it into the project where your AI agent runs.</span>
	</div>
	<div class="setup-step" data-testid="onboarding-cli-setup" class:is-complete={hasCliHeartbeat}>
		<strong>2. Configure the CLI</strong>
		<span>Agent Tick marks the CLI connected after the token is used by your agent or a test request.</span>
	</div>
	<div class="setup-step" data-testid="onboarding-mobile-app" class:is-complete={hasMobileDevice}>
		<strong>3. Install and sign into mobile</strong>
		<span>The mobile app is the primary approval surface. Use the same Clerk account on your phone.</span>
	</div>
</div>

<style>
	.setup-steps {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}

	.setup-step {
		display: grid;
		gap: 8px;
		padding: 14px;
		border: 1px solid #dbeafe;
		border-radius: 18px;
		background: #f8fbff;
		color: #334155;
	}

	.setup-step.is-complete {
		border-color: #bbf7d0;
		background: #f0fdf4;
	}

	.setup-step span {
		color: #64748b;
		line-height: 1.5;
	}

	@media (max-width: 760px) {
		.setup-steps {
			grid-template-columns: 1fr;
		}
	}
</style>
