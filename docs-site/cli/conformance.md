# a2amesh conformance

<!-- Synced from scripts/generate-command-docs.mjs. -->

Runs the A2A conformance fixture suite against an endpoint, emits a machine-readable report, and can write JUnit XML for CI systems.

## Usage

```text
Usage: a2amesh conformance [options] <url>

Runs the A2A conformance fixture suite against an endpoint, emits a machine-readable report, and can
write JUnit XML for CI systems.

Options:
  --profile <id>                Compatibility profile to run: official-a2a-v1.0, legacy-a2amesh, or
                                experimental-a2a-v1.2
  --strict                      Run the strict official compatibility profile when --profile is not
                                supplied
  --protocol-version <version>  Protocol fixture version to run: 1.0 (or 1.2 with
                                --experimental-profiles) (default: "1.0")
  --experimental-profiles       Allow a2amesh experimental protocol fixture profiles such as 1.2
  --json                        Machine-readable JSON output
  --gate                        Run as the local release gate using the strict official A2A v1.0
                                profile
  --junit <path>                Write a JUnit XML report to a path
  --header <key:value...>       HTTP header to send; accepts one or more key:value entries
  --bearer-token <token>        Bearer token sent as Authorization: Bearer <token>
  --api-key <name:value>        API key header as name:value; repeat for multiple keys
  --timeout-ms <ms>             Per-request timeout in milliseconds
  --retries <count>             Retry count for transient network failures
  --request-id <id>             Request id sent as x-request-id
  --origin <url>                Origin header to send
  -h, --help                    display help for command
```

## Examples

### Run conformance fixtures and emit JSON. (Linux/macOS)

```bash
a2amesh conformance http://127.0.0.1:3000 --profile official-a2a-v1.0 --strict --json
```

### Run conformance fixtures and emit JSON. (PowerShell)

```powershell
a2amesh conformance http://127.0.0.1:3000 --profile official-a2a-v1.0 --strict --json
```

### Write a JUnit report. (Linux/macOS)

```bash
a2amesh conformance http://127.0.0.1:3000 --junit ./reports/a2a-conformance.xml
```

### Write a JUnit report. (PowerShell)

```powershell
a2amesh conformance http://127.0.0.1:3000 --junit .\reports\a2a-conformance.xml
```

## Report Behavior

`--json` emits a stable conformance report with package metadata, endpoint capability metadata, pass/fail/skip counts, case results, and skipped optional capabilities.

Case `status` is one of `pass`, `fail`, or `skip`. Required failures increment `summary.requiredFailed` and make the command return a nonzero exit code.

Use `--profile official-a2a-v1.0 --strict` to run the official strict compatibility profile. The JSON report includes a `profile` summary and a `coverage` matrix with supported, partial, legacy-alias, and unsupported rows.

`--protocol-version 1.2` and `--profile experimental-a2a-v1.2` are a2amesh experimental fixture profiles and require `--experimental-profiles`; official conformance defaults to A2A `1.0`.

## JUnit Output

Use `--junit <path>` to write CI-compatible JUnit XML. The XML includes one `<testcase>` per report case, `<failure>` entries for failed cases, and `<skipped>` entries for skipped optional capabilities.
