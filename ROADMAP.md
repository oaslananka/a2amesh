# Roadmap

A2A Mesh is an independent TypeScript runtime and operational toolkit for Agent2Agent (A2A) systems. The near-term roadmap prioritizes a clear developer experience for operating A2A systems while preserving the repository's existing security, release-integrity, conformance, and interoperability standards.

## Product direction

A2A Mesh is not positioned as a replacement for the official A2A SDKs. Its product focus is the operational layer required to build and run A2A systems: runtime lifecycle, registry-backed discovery, persistence, observability, security boundaries, MCP interoperability, CLI workflows, and conformance tooling.

The primary near-term audience is TypeScript developers building real A2A services. Platform, DevOps, and MCP-heavy workflows build on that developer experience rather than defining the first onboarding path.

## Near-term priorities

1. Deliver a credential-free production golden path that a new user can scaffold, start, and verify in five minutes or less.
2. Add a small public, provider-neutral, bounded MCP tool-invocation surface that does not depend on Fleet or other internal packages.
3. Keep the existing live interoperability evidence with the official A2A JavaScript and Python SDKs current, pinned, and visible in the product onboarding story.
4. Strengthen the registry as a production discovery primitive with clear health, trust, tenancy, and persistence guidance.
5. Turn the existing telemetry surface into an easy-to-run observability experience with useful local output and optional OpenTelemetry export.
6. Keep required CI, docs, security, CodeQL, Scorecard, release provenance, package-verification, and interoperability controls green while product adoption work proceeds.

## Production golden path

The canonical onboarding target is a generated `production-demo` project created through `@a2amesh/create-a2amesh`. The default path must require no external account, provider credential, or network service beyond installing the published packages.

The generated system should demonstrate two A2A agents, registry-based discovery without hard-coded worker URLs, authenticated A2A requests, SQLite task persistence, one bounded MCP tool invocation, correlated telemetry, and a deterministic artifact result. A real-provider mode may be offered separately and must remain optional.

A single verification command should fail closed and report which layer failed while checking registry health, agent health, authenticated request completion, persisted task state, MCP invocation, artifact production, A2A conformance, and `a2amesh doctor`.

## Security and reliability boundaries

The golden path is a production-principles demonstration, not a security-relaxed sample. Services bind to loopback by default, public agent operations require authentication, MCP tools use explicit allowlists and bounded execution, and errors, logs, traces, and artifacts must not expose credentials. Generated `.env.example` files contain names and safe placeholders only.

Credential-free verification is the canonical CI path. Optional external providers must not become required release gates because third-party credentials and network availability are outside the project's release-integrity boundary.

## Existing interoperability baseline

A2A Mesh already maintains live, loopback-only interoperability tests against pinned official SDKs in both directions. The current baseline covers the official JavaScript SDK and official Python SDK, in addition to deterministic fixture replay.

Product work should reuse and surface that evidence rather than create a second interoperability harness. Protocol or SDK version changes may extend the existing lab when they expose a real compatibility gap.

## Fleet boundary

Fleet remains an experimental, post-1.0 control-plane layer above the provider-neutral public runtime. Worker routing, Mission Control, sandboxed provider execution, and other Fleet capabilities should not be required to understand or use the core public A2A Mesh product.

Fleet may reuse the same runtime, registry, policy, persistence, and observability foundations after the core production developer experience is established.

## Delivery sequence

The intended implementation sequence is:

1. Product positioning and roadmap alignment, including clearer visibility for existing official-SDK interoperability evidence.
2. Public bounded MCP invocation.
3. `production-demo` golden path.

Each step should remain independently reviewable, testable, and reversible rather than being combined into one large feature change.

## Adoption success criteria

Technical success means a fresh user can reach a verified local golden path in five minutes or less. Product success is evaluated over the following 8–12 weeks using independent usage signals such as external questions or issues, external integrations or pull requests, growth in genuine package dependents, quickstart usage, and concrete production feedback. Stars and raw download counts are supporting signals rather than primary adoption measures.

## Current maturity target

**Target:** Professional OSS / Mature OSS.

The project should not claim Gold or foundation-grade maturity until it has multiple active maintainers, independent human review, a sustainable governance process, repeatable releases, and strong release-integrity evidence.

## Foundation-grade gaps

Foundation-grade readiness requires more than automation. The project still needs independent maintainers, human review, contributor diversity, documented governance rotation, published security response metrics, and durable release-cadence evidence.
