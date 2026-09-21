# Caller-Supplied Reputation Passport Verification Example

This example demonstrates how an A2A Mesh consumer or agent can evaluate an optional, caller-supplied external reputation credential ("Reputation Passport") before delegating external work.

## Security Invariants

1. **No Core Dependency**: The passport verifier is an optional consumer pattern, not a core runtime or registry dependency.
2. **Native Trust Inviolability**: An external passport credential NEVER promotes an unverified Agent Card into a trusted registration in A2A Mesh Registry.
3. **Explicit Endpoint Binding**: The passport signature proves issuer integrity and explicitly binds the subject DID/agent ID and endpoint URL.
4. **Fail Closed**: Missing, stale, expired, future-dated, malformed, or signature-mismatched passports return `isValid: false`.
5. **No External Network Calls**: Verification uses local cryptographic checks on synthetic fixtures. No external HTTP fetches, paid APIs, or network calls occur during verification.
