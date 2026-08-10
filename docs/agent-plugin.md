# A2A Mesh Agent Plugin Plan

## Status

The product-owned `a2amesh` plugin is a validated **distribution-capable alpha bundle**. It contains canonical skills, OpenCode mirrors, runtime-specific client examples, and the standalone `a2amesh-mcp` server distributed by `@a2amesh/mcp`. Marketplace state is owned by `oaslananka/agent-tools` and changes only through a separate catalog pull request backed by a published release artifact.

## Plugin identity

- Plugin name: `a2amesh`
- Source of product behavior: `oaslananka/a2amesh`
- Manifest: `.claude-plugin/plugin.json`
- Standalone server: `a2amesh-mcp` from `@a2amesh/mcp`
- Canonical skills: `skills/`
- OpenCode mirrors: `.opencode/skills/`
- Claude MCP example: `.mcp.json`
- Codex example: `.codex/config.example.toml`
- VS Code example: `.vscode/mcp.example.json`
- OpenCode example: `opencode.example.jsonc`
- Catalog/discovery repository: `oaslananka/agent-tools`
- Catalog state: managed externally from release evidence

The plugin version follows the linked public `@a2amesh/cli` and `@a2amesh/mcp` package version. Product behavior, safety boundaries, tests, and examples remain here; the catalog contains discovery metadata only.

## First-phase workflow matrix

| Workflow                                | CLI                                                       | Registry                     | Fleet                               | Transport                         | MCP                                                | Credentials                             | Network                                                   | Status      |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------- | ----------------------------------- | --------------------------------- | -------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- | ----------- |
| Endpoint and Agent Card validation      | `doctor`, `validate`, `discover`, `health`, `conformance` | Optional read-only discovery | Not required                        | HTTP/A2A                          | Not required                                       | Optional endpoint auth                  | Outbound policy; private networks require explicit opt-in | Alpha skill |
| Task send, status, monitor, cancel      | `send`, `task`, `monitor`                                 | Optional endpoint lookup     | Deferred as a public plugin surface | HTTP/A2A                          | Not required                                       | Endpoint auth by named runtime variable | Validated destination; bounded retries and output         | Alpha skill |
| Bounded MCP consumption                 | `a2amesh-mcp --transport stdio`                           | Static agent allowlist       | Not exposed                         | stdio or loopback Streamable HTTP | `a2a_discover`, `a2a_send_message`, `a2a_get_task` | Named variables; scoped approval IDs    | SSRF/outbound policy remains authoritative                | Alpha       |
| Registry import or write administration | `registry import`                                         | Required                     | Not required                        | Registry HTTP                     | Not exposed                                        | Operator auth                           | Explicit target and approval                              | Deferred    |
| Fleet execution and worker management   | Internal packages and operator docs                       | Required                     | Required                            | Control-plane HTTP/SSE            | Not exposed                                        | Operator and worker credentials         | Confinement and outbound policy                           | Deferred    |

## Non-goals

The first phase does not:

- place product behavior in the catalog repository;
- publish a dedicated OpenClaw plugin or separate integration repository;
- expose Fleet administration, registry writes, terminal access, credentials, merge, publish, deployment, or destructive infrastructure tools;
- provide or claim a hosted remote MCP endpoint;
- bypass tenant, audience, scope, approval, authentication, or outbound-network policy;
- claim that one client probe proves generic MCP or A2A conformance; or
- claim that the plugin's alpha status changes the supported package release channel.

## Installation

### Claude Code

Add this repository as a plugin or use it for one session:

```bash
claude plugin validate --strict .
claude --plugin-dir .
```

The project-local `.mcp.json` starts the published `a2amesh-mcp` command through `npx`. Replace its placeholder tenant and endpoint before use.

### Codex, VS Code, and OpenCode

Use the matching product-owned example:

- Codex: `.codex/config.example.toml`
- VS Code / GitHub Copilot: `.vscode/mcp.example.json`
- OpenCode: `opencode.example.jsonc` plus `.opencode/skills/`

All examples start with only `a2a_discover` and `a2a_get_task`. They disable localhost and private-network targets and contain no concrete secret values.

### Generic MCP clients

Use the published local command:

```bash
npx -y -p @a2amesh/mcp a2amesh-mcp --transport stdio
```

Pin the exact released version in repeatable automation. The command reads `A2AMESH_MCP_*` variables. `A2AMESH_MCP_AGENTS_JSON` accepts `tokenEnv` names but rejects inline token fields.

### Enabling message send

`a2a_send_message` is intentionally absent from the default client examples. Enable it only for an approved session by adding:

1. `a2a:messages:send` to `A2AMESH_MCP_SCOPES`;
2. `a2a_send_message` to `A2AMESH_MCP_ALLOWED_TOOLS`; and
3. a fresh, scoped `A2AMESH_MCP_SEND_APPROVAL_ID` produced after explicit user approval.

Restart the MCP process after changing the policy. Ordinary sends are not retried automatically.

## Upgrade

1. Record the installed plugin commit, manifest version, and exact `@a2amesh/mcp` version.
2. Fetch the reviewed target release.
3. Run the plugin and MCP distribution checks.
4. Review skill, scope, approval, credential, and network changes.
5. Replace the plugin bundle and package version atomically.
6. Start a new agent session and run read-only discovery before enabling state-changing tools.

Do not copy only the manifest; the manifest, skills, mirrors, runtime configs, package command, documentation, and tests form one contract.

## Rollback

1. Stop sessions using the upgraded bundle.
2. Restore the previously recorded plugin release and exact `@a2amesh/mcp` version.
3. Re-run plugin validation and the standalone binary help/version checks.
4. Start a new session so cached configuration is not reused.
5. Run only read-only endpoint and MCP discovery before restoring any send approval.

The repository checks isolated plugin replacement and packed-package install, upgrade replacement, and rollback restoration.

## Validation

Required repository validation:

```bash
node scripts/check-agent-plugin.mjs
pnpm run mcp:distribution:check
pnpm exec vitest run --project integration tests/integration/agent-plugin.test.ts
```

Optional real Claude Code lifecycle validation requires an absolute executable path:

```bash
CLAUDE_BIN="$(command -v claude)" node scripts/check-agent-plugin.mjs --claude
CLAUDE_BIN="$(command -v claude)" node scripts/check-agent-plugin.mjs --claude-lifecycle
```

The distribution checker packs protocol, runtime, and MCP artifacts, installs them in a clean consumer, invokes the installed binary, negotiates stdio, verifies the read-only tool set, exercises a synthetic upgrade, and proves byte-identical rollback. The Claude lifecycle checker validates clean marketplace installation, upgrade, and rollback of the complete product bundle.

### Optional OpenCode Zen skill evaluation

The manual `Provider Live Smoke` workflow evaluates the OpenCode mirrors with an isolated home, external plugins disabled, automatic sharing disabled, and every tool denied except `skill`. Hosted model availability and quotas make this non-gating. Bounded, secret-free evidence is retained for 14 days.

## Safety and privacy

- Runtime examples start read-only.
- Send and cancel require explicit approval immediately before execution.
- Concrete credentials remain outside Git, skill files, prompts, logs, audit payloads, and tool output.
- Tenant, audience, scope, tool, agent, destination, and approval checks fail closed.
- Localhost and private-network access require explicit, authorized opt-in.
- Retries are bounded and ordinary non-idempotent sends are not replayed automatically.
- The package exposes only the reviewed three-tool surface; client examples expose the read-only subset initially.
- Tool output, task artifacts, errors, and diagnostics are bounded and redacted.
- Telemetry excludes message bodies, credentials, authorization headers, and private artifact contents.

## Marketplace activation gate

A catalog activation pull request may move `a2amesh` from `planned_plugins` to `plugins` only when all of the following evidence exists:

1. A published release contains the manifest, skills, mirrors, runtime configs, and `a2amesh-mcp` binary.
2. Clean package installation, binary help/version, stdio negotiation, upgrade, rollback, and smallest read-only workflow checks pass.
3. Claude Code, OpenCode, Codex, VS Code, and generic MCP claims point to tested product-owned configuration.
4. The marketplace entry contains discovery metadata only and links to the product release evidence.
5. Security, CI, release integrity, provenance, and package visibility checks pass.
6. The catalog pull request documents rollback to `planned_plugins`.

Catalog activation never widens the package tool allowlist or grants send approval. Removing the catalog entry does not remove the published package and is the first rollback step for discovery problems.
