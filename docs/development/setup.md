# Development Setup

A2A Mesh uses one toolchain ownership model:

- `mise.toml` pins the default Node.js version and enables Corepack shims;
- the root `packageManager` field pins the exact pnpm version used by Corepack;
- pnpm is not configured as a separate mise tool.

## mise users

Install the repository Node.js tool and refresh mise shims before installing dependencies.

Linux/macOS:

```bash
mise trust
mise install
mise reshim
corepack pnpm run toolchain:check
corepack pnpm install --frozen-lockfile
```

PowerShell:

```powershell
mise trust
mise install
mise reshim
corepack pnpm run toolchain:check
corepack pnpm install --frozen-lockfile
```

After `mise install`, `pnpm --version`, `corepack pnpm --version`, and pnpm launched by a Node.js child process must all resolve to the version in the root `packageManager` field.

## Corepack without mise

Install a Node.js version listed in `tools/runtime-versions.json`, then enable Corepack and use the explicit bootstrap path.

Linux/macOS:

```bash
corepack enable
corepack pnpm run toolchain:check
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
```

PowerShell:

```powershell
corepack enable
corepack pnpm run toolchain:check
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
```

## Automation and immutable hosts

Service accounts may intentionally have read-only home directories or externally managed shims. The repository launcher prepends an ephemeral Corepack-backed pnpm shim so nested package scripts cannot fall back to a stale external shim.

Linux/macOS:

```bash
node scripts/run-pnpm.mjs install --frozen-lockfile
node scripts/run-pnpm.mjs run verify
```

PowerShell:

```powershell
node scripts/run-pnpm.mjs install --frozen-lockfile
node scripts/run-pnpm.mjs run verify
```

The doctor still reports direct-shell drift and provides remediation before contributor workflows rely on it.
