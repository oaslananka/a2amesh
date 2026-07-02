# Input validation

## Boundary policy

Validate all untrusted input at repository boundaries:

- HTTP/JSON-RPC request bodies.
- Agent cards and registry metadata.
- CLI arguments and file paths.
- MCP tool inputs.
- WebSocket and transport payloads.

## Requirements

- Prefer schema-based validation for structured payloads.
- Reject ambiguous or unsupported protocol versions explicitly.
- Keep error responses deterministic and non-leaky.
- Redact secrets before logging.
- Add negative tests for validation failures.

## Security review triggers

Changes touching auth, registry trust, SSRF/network policy, push notifications, MCP tool execution, or release publishing require explicit security notes in the PR.
