# @a2amesh/cli

`@a2amesh/cli` is the command-line interface for testing, configuring, bootstrapping, and validating A2A Mesh nodes, registries, and agents.

## Purpose

- **Bootstrapping**: Scaffold new adapter templates using `a2amesh init`.
- **Validation & Diagnostics**: Diagnostic verification of environments via `a2amesh doctor`.
- **Conformance Testing**: Enforce spec compliance on local endpoints using `a2amesh conformance`.
- **Local Control Plane**: Launch local testing instances via `a2amesh registry start`.

## Installation

```bash
npm install -g @a2amesh/cli
```

## Available Commands

```bash
# Verify environment readiness
a2amesh doctor

# Initialize/Scaffold a custom adapter template
a2amesh init

# Test conformance on a running endpoint
a2amesh conformance http://127.0.0.1:3000 --protocol-version 1.0

# Start a local registry control plane
a2amesh registry start
```

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`
