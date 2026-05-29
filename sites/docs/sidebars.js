// @ts-check

const sidebars = {
  launchDocs: [
    'index',
    'quick-start',
    'mobile-app',
    {
      type: 'category',
      label: 'Integrations',
      link: { type: 'doc', id: 'integrations' },
      items: ['claude-code', 'codex', 'pi', 'github-actions-release-sanction-tutorial']
    },
    'cli',
    'self-hosting',
    {
      type: 'category',
      label: 'Reference',
      items: ['session-identity', 'security', 'api-sdk', 'entitlement-lifecycle']
    }
  ]
};

module.exports = sidebars;
