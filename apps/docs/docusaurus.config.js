// @ts-check

const config = {
  title: 'Agent Tick Docs',
  tagline: 'Least-permission approvals for coding agents',
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
            'claude-code.md',
            'codex.md',
            'pi.md',
            'github-actions-release-sanction-tutorial.md',
            'self-hosting.md',
            'mobile-app.md',
            'clerk-production.md',
            'entitlement-lifecycle.md',
            'security.md',
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
        { type: 'docSidebar', sidebarId: 'launchDocs', position: 'left', label: 'Docs' },
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
            { label: 'CLI', to: '/cli' },
            { label: 'Integrations', to: '/integrations' },
            { label: 'Self-Hosting', to: '/self-hosting' }
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
