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
      items: ['claude-code', 'codex', 'pi', 'github-actions-release-sanction-tutorial']
    },
    'self-hosting',
    'mobile-app',
    'entitlement-lifecycle',
    'security',
    'api-sdk'
  ]
};

module.exports = sidebars;
