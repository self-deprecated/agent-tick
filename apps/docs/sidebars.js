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
      items: ['workflow-no-code-connector-strategy']
    },
    'self-hosting',
    'mobile-app',
    {
      type: 'category',
      label: 'Security',
      link: { type: 'doc', id: 'security' },
      items: ['scoped-guest-approval-links', 'activity-history-cleanup-deletion']
    },
    'api-sdk'
  ]
};

module.exports = sidebars;
