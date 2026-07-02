# Subscription and API Boundaries

This document defines the rules and boundaries for interacting with AI provider APIs, subscriptions, CLIs, and related tooling within the A2A Mesh ecosystem. It establishes guidelines to ensure secure, compliant, and robust integrations.

## Core Principles

1. **Strictly Official Interfaces:** All integrations must use official APIs, MCP (Model Context Protocol), or officially supported CLIs.
2. **No Scraping:** UI scraping, browser session automation, or reverse engineering of private endpoints is strictly forbidden.
3. **Respect Subscriptions:** Bypassing subscription limits, circumventing quotas, or extracting internal platform tokens is prohibited.
4. **Secure Credentials:** Secrets must be referenced, never stored raw in code, logs, or configuration files.
5. **Fail Closed:** Unknown or unsupported provider surfaces must fail closed and produce a human handoff rather than inventing an integration.

## Access Boundaries

It is critical to distinguish between different types of provider access to ensure the correct authentication and usage patterns are applied.

### API Access

Direct communication with a provider's REST, gRPC, or WebSocket endpoints.

* **Authentication:** Must use provider-issued API keys, OAuth tokens, or official service accounts.
* **Usage:** For programmatic invocation of models and services. Subject to rate limits and API billing.

### Subscription Access

Access granted via user subscriptions (e.g., ChatGPT Plus, Claude Pro).

* **Usage:** Subscriptions generally do not grant API access unless explicitly stated by the provider. Automated usage of subscription tiers must only be done through official APIs provided for that purpose (if any) or official CLIs that authenticate via the subscription.
* **Prohibition:** Do not attempt to use browser session cookies or undocumented internal endpoints to automate subscription access.

### Official CLI Access

Using official command-line tools provided by the vendor.

* **Usage:** Acceptable when the CLI provides supported automation capabilities.
* **Integration:** Must invoke the CLI binary directly and parse standard output/error according to the tool's documentation.

### IDE and Workspace Workflows

Interactions within IDE environments or specialized workspaces.

* **Usage:** Must utilize established extension APIs (e.g., VS Code Extension API) or standardized protocols (e.g., MCP).
* **Prohibition:** Do not manipulate IDE internal states directly or scrape IDE rendering buffers.

## Forbidden Practices

To maintain ecosystem integrity and avoid vendor policy violations, the following practices are explicitly forbidden:

* **UI Scraping:** Parsing DOM elements or capturing screen outputs from provider web interfaces.
* **Browser Session Automation:** Using tools like Puppeteer or Playwright to drive provider web apps to bypass API costs.
* **Token Extraction:** Attempting to extract short-lived session tokens from browser local storage or network intercepts for automated use.
* **Subscription-Limit Bypassing:** Implementing logic designed to evade rate limits, concurrent request limits, or usage quotas established by the provider.

## Credential Management

All provider credentials must be managed securely.

* **No Raw Secrets:** Do not hardcode API keys, passwords, or tokens in source files, test fixtures, or documentation examples.
* **References:** Use environment variables, secure secret managers, or standard configuration files (e.g., `~/.config/provider/credentials`) to supply credentials at runtime.
* **Logging:** Ensure logging and telemetry systems scrub or mask all credential references before output.

## Fleet planning

Fleet provider worker planning is documented in [Provider Workers and Mission Control Plan](/fleet/provider-workers-mission-control). Fleet uses manual handoff when a provider has no documented automation surface.

## Provider-Specific Examples

The following examples illustrate how to correctly integrate with specific providers while respecting the boundaries outlined above.

### OpenRouter

* **Correct:** Use the official HTTP API via `packages/adapter-base` using an environment variable for the `OPENROUTER_API_KEY`.
* **Incorrect:** Attempting to scrape the OpenRouter dashboard to retrieve usage stats or keys.

### OpenCode

* **Correct:** Integrations must use OpenCode-supported surfaces such as CLI, API, or MCP where available and documented.
* **Incorrect:** Extracting internal OpenCode session tokens to run standalone scripts outside the designated workspace environment.

### Claude Code

* **Correct:** Invoke the `claude` CLI tool using a properly authenticated terminal session, capturing its standard output for integration.
* **Incorrect:** Automating a browser to interact with the Claude web interface.

### Codex

* **Correct:** Use allowed surfaces such as the official Codex CLI, App Server, GitHub Action, API, or MCP where available.
* **Incorrect:** Intercepting internal IDE telemetry to extract Codex prompts.

### Gemini

* **Correct:** Use the official Google AI Studio API or Vertex AI API with standard Google Cloud authentication (e.g., Application Default Credentials).
* **Incorrect:** Scraping the Google AI Studio web interface to execute models.

### Antigravity Workspace Bridge

* **Correct:** Use only official APIs, CLIs, workspace extension protocols, or Git/worktree/artifact handoff. If no official automation surface exists, direct control is unsupported.
* **Incorrect:** Reverse-engineering the Antigravity internal database or bypassing gateways to read workspace state directly.
