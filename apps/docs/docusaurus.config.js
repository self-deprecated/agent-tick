// @ts-check

const config = {
  title: 'Agent Tick Docs',
  tagline: 'Least-permission approvals for coding agents',
  favicon: 'img/favicon.svg',
  url: 'https://docs.agenttick.sh',
  baseUrl: '/',
  organizationName: 'self-deprecated',
  projectName: 'agent-tick',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../../docs',
          include: [
            'index.md',
            'quick-start.md',
            'cli.md',
            'integrations.md',
            'cursor-gemini-opencode-support.md',
            'codex-mcp-adapter-demo.md',
            'workflow-no-code-connector-strategy.md',
            'n8n-community-node-plan.md',
            'zapier-app-action-opportunity-brief.md',
            'approval-templates.md',
            'self-hosting.md',
            'mobile-app.md',
            'security.md',
            'encrypted-approval-content.md',
            'scoped-guest-approval-links.md',
            'activity-history-cleanup-deletion.md',
            'api-sdk.md'
          ],
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/self-deprecated/agent-tick/tree/main/docs/'
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css'
        }
      }
    ]
  ],
  themeConfig: {
    image: 'img/social-card.svg',
    navbar: {
      title: 'Agent Tick Docs',
      logo: { alt: 'Agent Tick', src: 'img/favicon.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'launchDocs', position: 'left', label: 'Docs' },
        { to: '/quick-start', label: 'Quick Start', position: 'left' },
        { href: 'https://agenttick.sh', label: 'Website', position: 'right' },
        { href: 'https://github.com/self-deprecated/agent-tick', label: 'GitHub', position: 'right' }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Launch docs',
          items: [
            { label: 'Quick Start', to: '/quick-start' },
            { label: 'CLI', to: '/cli' },
            { label: 'Integrations', to: '/integrations' },
            { label: 'Self-Hosting', to: '/self-hosting' },
            { label: 'Mobile App', to: '/mobile-app' },
            { label: 'Security', to: '/security' },
            { label: 'API/SDK', to: '/api-sdk' }
          ]
        },
        {
          title: 'Agent Tick',
          items: [
            { label: 'Website', href: 'https://agenttick.sh' },
            { label: 'Privacy', href: 'https://agenttick.sh/privacy' },
            { label: 'Support', href: 'https://agenttick.sh/support' }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Self-Deprecated.`
    },
    prism: {
      additionalLanguages: ['bash', 'json', 'typescript', 'toml', 'yaml']
    }
  }
};

module.exports = config;
