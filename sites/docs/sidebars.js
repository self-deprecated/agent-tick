// @ts-check

const sidebars = {
  docs: [
    {
      type: 'category',
      label: 'Start',
      items: ['index', 'quick-start', 'core-concepts']
    },
    {
      type: 'category',
      label: 'Use the app',
      items: ['native-app', 'personal-console', 'access']
    },
    {
      type: 'category',
      label: 'Connect coding-agent integrations',
      link: { type: 'doc', id: 'coding-agent-integrations' },
      items: ['claude-code', 'codex', 'pi', 'other-tools']
    },
    'prompting-agents',
    'cli',
    'workspaces',
    {
      type: 'category',
      label: 'Self-hosting',
      link: { type: 'doc', id: 'self-hosting' },
      items: ['self-hosting-operator-reference']
    },
    'security',
    'philosophy',
    {
      type: 'category',
      label: 'Reference',
      items: ['api-sdk']
    }
  ]
};

module.exports = sidebars;
