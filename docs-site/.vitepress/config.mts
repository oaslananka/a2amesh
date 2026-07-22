import { defineConfig } from 'vitepress';

const docsBasePath = '/a2amesh/';
const docsPublicUrl = 'https://oaslananka.github.io/a2amesh/';

export default defineConfig({
  base: docsBasePath,
  title: 'A2A Mesh',
  description: 'Independent TypeScript runtime and toolkit for the Agent2Agent protocol.',
  cleanUrls: true,
  lastUpdated: true,
  vite: {
    server: {
      host: '127.0.0.1',
    },
    preview: {
      host: '127.0.0.1',
    },
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${docsBasePath}logo.svg` }],
    ['meta', { property: 'og:image', content: `${docsPublicUrl}og-image.png` }],
    ['meta', { property: 'og:url', content: docsPublicUrl }],
  ],
  themeConfig: {
    siteTitle: 'A2A Mesh',
    logo: `${docsBasePath}logo.svg`,
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Fleet', link: '/fleet/roadmap' },
      { text: 'CLI', link: '/cli/' },
      { text: 'Packages', link: '/packages/runtime' },
      { text: 'Protocol', link: '/protocol/compliance' },
      { text: 'Interop', link: '/interop/official-sdks' },
      { text: 'Operations', link: '/operations/task-retries' },
      { text: 'Release', link: '/release/process' },
      { text: 'GitHub', link: 'https://github.com/oaslananka/a2amesh' },
    ],
    sidebar: {
      '/fleet/': [
        {
          text: 'Fleet',
          items: [
            { text: 'Quickstart', link: '/fleet/quickstart' },
            { text: 'Roadmap', link: '/fleet/roadmap' },
            { text: 'Control Plane', link: '/fleet/control-plane' },
            { text: 'Control Plane Server', link: '/fleet/control-plane-server' },
            { text: 'Policy, Sandbox, and Artifacts', link: '/fleet/policy-sandbox-artifacts' },
            {
              text: 'Provider Workers and Mission Control',
              link: '/fleet/provider-workers-mission-control',
            },
            { text: 'Package Map', link: '/fleet/package-map' },
          ],
        },
      ],
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: '5-Minute Demo', link: '/guide/demo' },
            { text: 'Examples', link: '/guide/examples' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Production Checklist', link: '/guide/production-checklist' },
            { text: 'Official SDKs vs A2A Mesh', link: '/guide/sdk-comparison' },
            { text: 'Telemetry', link: '/guide/telemetry' },
            { text: 'Compatibility', link: '/guide/compatibility' },
          ],
        },
      ],
      '/cli/': [
        {
          text: 'CLI',
          items: [
            { text: 'Overview', link: '/cli/' },
            { text: 'benchmark', link: '/cli/benchmark' },
            { text: 'conformance', link: '/cli/conformance' },
            { text: 'discover', link: '/cli/discover' },
            { text: 'doctor', link: '/cli/doctor' },
            { text: 'export-card', link: '/cli/export-card' },
            { text: 'health', link: '/cli/health' },
            { text: 'monitor', link: '/cli/monitor' },
            { text: 'registry', link: '/cli/registry' },
            { text: 'scaffold', link: '/cli/scaffold' },
            { text: 'send', link: '/cli/send' },
            { text: 'task', link: '/cli/task' },
            { text: 'validate', link: '/cli/validate' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Packages',
          items: [
            { text: 'Protocol', link: '/packages/protocol' },
            { text: 'Core Runtime', link: '/packages/runtime' },
            { text: 'Registry', link: '/packages/registry' },
            { text: 'MCP Bridge', link: '/packages/mcp' },
            { text: 'CLI', link: '/packages/cli' },
            { text: 'Scaffolder', link: '/packages/create-a2amesh' },
          ],
        },
      ],
      '/adapters/': [
        {
          text: 'Adapters',
          items: [
            { text: 'OpenAI', link: '/adapters/openai' },
            { text: 'Anthropic', link: '/adapters/anthropic' },
            { text: 'LangChain', link: '/adapters/langchain' },
            { text: 'Google ADK', link: '/adapters/google-adk' },
            { text: 'CrewAI', link: '/adapters/crewai' },
            { text: 'LlamaIndex', link: '/adapters/llamaindex' },
            { text: 'Custom Adapter', link: '/adapters/custom-adapter' },
          ],
        },
      ],
      '/interop/': [
        {
          text: 'Interop',
          items: [{ text: 'Official SDKs', link: '/interop/official-sdks' }],
        },
      ],
      '/protocol/': [
        {
          text: 'Protocol',
          items: [
            { text: 'Compatibility', link: '/protocol/compliance' },
            { text: 'A2A v1 Matrix', link: '/protocol/a2a-v1-compatibility-matrix' },
            { text: 'Profiles', link: '/protocol/profiles' },
            { text: 'JSON Schemas', link: '/protocol/schemas' },
            { text: 'Agent Cards', link: '/protocol/agent-card' },
            { text: 'Task Lifecycle', link: '/protocol/task-lifecycle' },
            { text: 'Extensions', link: '/protocol/extensions' },
            { text: 'Push Notifications', link: '/protocol/push-notifications' },
          ],
        },
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Task Retries', link: '/operations/task-retries' },
            { text: 'Idempotency', link: '/operations/idempotency' },
          ],
        },
      ],
      '/security/': [
        {
          text: 'Security',
          items: [
            { text: 'Authentication', link: '/security/authentication' },
            { text: 'Security Upgrades', link: '/security/security-upgrades' },
            { text: 'Rate Limiting', link: '/security/rate-limiting' },
            { text: 'OIDC Publishing', link: '/security/oidc' },
            { text: 'Policy Engine', link: '/security/policy-engine' },
            { text: 'MCP Audit', link: '/security/mcp-audit' },
            { text: 'Threat Model', link: '/security/threat-model' },
            { text: 'Trust Evidence', link: '/security/trust-evidence' },
          ],
        },
      ],
      '/release/': [
        {
          text: 'Release',
          items: [
            { text: 'Release Process', link: '/release/process' },
            { text: 'Package Verification', link: '/release/package-verification' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Core', link: '/api/core' },
            { text: 'Client', link: '/api/client' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/oaslananka/a2amesh' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@a2amesh/runtime' },
    ],
    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright 2026 oaslananka',
    },
    search: {
      provider: 'local',
    },
  },
});
