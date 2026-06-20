// @ts-check

const config = {
  title: 'Agent Tick Docs',
  tagline: 'Least-permission request routing for coding agents',
  favicon: 'img/favicon.svg',
  headTags: [
    { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/img/favicon-16x16.png' } },
    { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/img/favicon-32x32.png' } },
    { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/img/favicon-96x96.png' } },
    { tagName: 'link', attributes: { rel: 'apple-touch-icon', sizes: '180x180', href: '/img/apple-touch-icon.png' } }
  ],
  url: 'https://docs.agenttick.sh',
  baseUrl: '/',
  organizationName: 'self-deprecated',
  projectName: 'agent-tick',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw'
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
            'core-concepts.md',
            'native-app.md',
            'personal-console.md',
            'access.md',
            'coding-agent-integrations.md',
            'claude-code.md',
            'codex.md',
            'pi.md',
            'other-tools.md',
            'prompting-agents.md',
            'cli.md',
            'workspaces.md',
            'self-hosting.md',
            'self-hosting-operator-reference.md',
            'security.md',
            'private-encryption.md',
            'philosophy.md',
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
      logo: {
        alt: 'Agent Tick',
        src: 'img/agent-tick-logo.svg',
        srcDark: 'img/favicon.svg'
      },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/quick-start', label: 'Quick Start', position: 'left' },
        { href: 'https://agenttick.sh', label: 'Website', position: 'right' },
        { href: 'https://github.com/self-deprecated/agent-tick', label: 'GitHub', position: 'right' }
      ]
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'Quick Start', to: '/quick-start' },
            { label: 'Core Concepts', to: '/core-concepts' },
            { label: 'Coding-agent integrations', to: '/coding-agent-integrations' },
            { label: 'Self-hosting', to: '/self-hosting' }
          ]
        },
        {
          title: 'Project',
          items: [
            { label: 'Website', href: 'https://agenttick.sh' },
            { label: 'GitHub', href: 'https://github.com/self-deprecated/agent-tick' }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Agent Tick.`
    },
    prism: {
      additionalLanguages: ['bash', 'toml', 'json', 'yaml']
    }
  }
};

module.exports = config;
