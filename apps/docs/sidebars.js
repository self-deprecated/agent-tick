// @ts-check

const sidebars = {
  launchDocs: [
    'index',
    'quick-start',
    'cli',
    {
      type: 'category',
      label: 'Integrations',
      link: { type: 'doc', id: 'integrations' },
      items: ['claude-code-verified-hook-demo', 'cursor-gemini-opencode-support', 'codex-mcp-adapter-demo', 'github-actions-release-sanction-tutorial', 'workflow-no-code-connector-strategy', 'n8n-community-node-plan', 'zapier-app-action-opportunity-brief', 'approval-templates']
    },
    'self-hosting',
    'mobile-app',
    'entitlement-lifecycle',
    {
      type: 'category',
      label: 'Security',
      link: { type: 'doc', id: 'security' },
      items: ['encrypted-approval-content', 'scoped-guest-approval-links', 'activity-history-cleanup-deletion', 'deletion-controls-verification', 'hosted-data-inventory']
    },
    'api-sdk'
  ]
};

module.exports = sidebars;
