# A2A Mesh Agent Plugin Plan

## Status

The product-owned `a2amesh` plugin is a validated **skills-only alpha bundle**. It is intentionally not active in the `oaslananka/agent-tools` marketplace. The current public package baseline is `0.15.0-alpha.1`, and marketplace activation remains blocked until a stable standalone MCP distribution contract and clean runtime-specific installation evidence exist.

## Plugin identity

- Plugin name: `a2amesh`
- Source of product behavior: `oaslananka/a2amesh`
- Manifest: `.claude-plugin/plugin.json`
- Canonical skills: `skills/`
- OpenCode mirrors: `.opencode/skills/`
- Catalog/discovery repository: `oaslananka/agent-tools`
- Catalog state: `planned_plugins`

The plugin version follows the supported public `@a2amesh/cli` alpha version. Product-specific instructions, safety boundaries, tests, and examples remain in this repository; the catalog only points users to them.

## First-phase workflow matrix

| Workflow                                | CLI                                                       | Registry                     | Fleet                               | Transport                         | MCP                                                | Credentials                               | Network                                                   | Status      |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------- | ----------------------------------- | --------------------------------- | -------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- | ----------- |
| Endpoint and Agent Card validation      | `doctor`, `validate`, `discover`, `health`, `conformance` | Optional read-only discovery | Not required                        | HTTP/A2A                          | Not required                                       | Optional endpoint auth                    | Outbound policy; private networks require explicit opt-in | Alpha skill |
| Task send, status, monitor, cancel      | `send`, `task`, `monitor`                                 | Optional endpoint lookup     | Deferred as a public plugin surface | HTTP/A2A                          | Not required                                       | Endpoint auth by named runtime variable   | Validated destination; bounded retries and output         | Alpha skill |
| Bounded MCP consumption                 | Repository example and client probe commands              | Static agent allowlist       | Not exposed                         | stdio or loopback Streamable HTTP | `a2a_discover`, `a2a_send_message`, `a2a_get_task` | Named variables; send approval identifier | SSRF/outbound policy remains authoritative                | Alpha skill |
| Registry import or write administration | `registry import`                                         | Required                     | Not required                        | Registry HTTP                     | Not exposed                                        | Operator auth                             | Explicit target and approval                              | Deferred    |
| Fleet execution and worker management   | Internal packages and operator docs                       | Required                     | Required                            | Control-plane HTTP/SSE            | Not exposed                                        | Operator and worker credentials           | Confinement and outbound policy                           | Deferred    |

## Non-goals

The first phase does not:

- activate an installable marketplace entry;
- publish a dedicated OpenClaw plugin, public MCP-server package, or separate integration repository;
- expose Fleet administration, registry writes, terminal access, credentials, merge, publish, deployment, or destructive infrastructure tools;
- provide a hosted remote MCP endpoint;
- bypass tenant, audience, scope, approval, authentication, or outbound-network policy;
- claim that one client probe proves generic MCP or A2A conformance; or
- claim production readiness for the current alpha packages.

## Installation

### Claude Code local validation

From a clean checkout of the supported release or reviewed commit:

```bash
claude plugin validate --strict .
claude --plugin-dir .
```

This loads the product skills for one session. It does not install or launch an MCP server automatically.

### OpenCode local skills

Copy or link `.opencode/skills/` into the project that will use the workflows. The mirrored files are checked byte-for-byte against the canonical `skills/` directory.

### CLI prerequisite

Use the supported alpha CLI without a global install:

```bash
pnpm dlx @a2amesh/cli@alpha doctor --json
```

Pin `@a2amesh/cli@0.15.0-alpha.1` in repeatable automation rather than relying on a moving dist-tag.

### MCP prerequisite

The bounded MCP workflow currently requires a source checkout and the `examples/openclaw-mcp` build. Follow that example's README and ADR-0016. No product plugin file contains concrete credentials or an unrestricted MCP launch configuration.

## Upgrade

1. Record the installed plugin commit and manifest version.
2. Fetch the reviewed target release or commit.
3. Run `node scripts/check-agent-plugin.mjs` and `claude plugin validate --strict .`.
4. Review skill changes, especially approval, credential, and network boundaries.
5. Replace the local plugin directory or OpenCode skill mirror atomically.
6. Run the endpoint-validation workflow before any state-changing task operation.

Do not upgrade by copying only the manifest; the manifest, canonical skills, mirrors, documentation, and tests form one versioned bundle.

## Rollback

1. Stop active agent sessions that loaded the upgraded bundle.
2. Restore the previously recorded release or commit as one complete bundle.
3. Re-run `node scripts/check-agent-plugin.mjs` and `claude plugin validate --strict .`.
4. Start a new agent session so cached plugin content is not reused.
5. Re-run only read-only endpoint validation before resuming task operations.

The portable lifecycle checker exercises clean install, upgrade replacement, and rollback restoration in an isolated temporary directory.

## Validation

Required repository validation:

```bash
node scripts/check-agent-plugin.mjs
pnpm exec vitest run --project integration tests/integration/agent-plugin.test.ts
```

Optional real Claude Code validation when the CLI is installed. Set `CLAUDE_BIN` to the absolute executable path so validation does not inherit an untrusted command lookup path:

```bash
CLAUDE_BIN="$(command -v claude)" node scripts/check-agent-plugin.mjs --claude
CLAUDE_BIN="$(command -v claude)" node scripts/check-agent-plugin.mjs --claude-lifecycle
```

The checker verifies manifest identity/version parity, canonical skill structure, OpenCode mirror parity, documentation gates, and isolated filesystem install/upgrade/rollback behavior. The optional `--claude-lifecycle` path also creates an isolated temporary marketplace and home directory, installs the plugin, upgrades to a generated next version, and rolls back by reinstalling the recorded version. It does not contact an external A2A endpoint.

### Optional OpenCode Zen skill evaluation

The manual `Provider Live Smoke` workflow can evaluate the OpenCode mirrors with a
selected OpenCode Zen chat-completions model. Each run uses an isolated OpenCode home
and configuration, disables external plugins and automatic sharing, denies every tool
by default, and permits only the `skill` tool. The evaluator requires exactly one
completed load of each expected skill and rejects any other tool call.

This evaluation is optional and non-gating because hosted model availability, quotas,
and behavior can change independently of the repository. Bounded JSONL evidence and a
secret-free summary are retained as workflow artifacts for 14 days.

## Safety and privacy

- Validation and discovery start read-only.
- Send and cancel require explicit approval immediately before execution.
- Concrete credentials remain outside Git, skill files, prompts, logs, audit payloads, and tool output.
- Tenant, audience, scope, tool, agent, destination, and approval checks fail closed.
- Private-network access requires an explicit, authorized opt-in.
- Retries are bounded and ordinary non-idempotent sends are not replayed automatically.
- MCP clients receive only the reviewed three-tool allowlist.
- Tool output, task artifacts, errors, and diagnostics are bounded and redacted.
- Telemetry must not include message bodies, credentials, authorization headers, or private artifact contents.

## Marketplace activation gate

Keep `a2amesh` under `planned_plugins` in `oaslananka/agent-tools` until all of the following are true:

1. A supported release contains this manifest, skills, mirrors, and validation evidence.
2. A stable standalone MCP server command or another explicit distribution contract exists; a source-only example is insufficient.
3. Claude Code, OpenCode, Codex, VS Code, and generic MCP support claims are each backed by tested configuration rather than copied placeholders.
4. Clean install, upgrade, rollback, and smallest-workflow evidence is repeated against the release artifact.
5. The marketplace entry points to product-owned files and contains no product behavior.
6. Security, CI, release integrity, and package visibility checks pass for the activation commit.
7. Activation is performed in a separate catalog pull request with a documented rollback.

Until then, the plugin bundle is a product-side alpha contract and the catalog entry remains intentionally non-installable.
