# @a2amesh/runtime

`@a2amesh/runtime` provides the core server and client implementation, task lifecycle management, push notification routing, and telemetry hooks for Agent2Agent-native systems.

## Purpose

- **A2A Client & Server**: Direct HTTP/SSE/WebSocket communication, serialization, and handshake handling.
- **Task Lifecycle**: Methods to start, cancel, update, and retrieve task states.
- **Pluggable Architecture**: Integrates with custom storage backend providers, telemetry exporters, and authorization checks.

## Installation

```bash
npm install @a2amesh/runtime
```

## Usage Example

```typescript
import { A2AServer, A2AClient } from '@a2amesh/runtime';

const server = new A2AServer({
  port: 8080,
  handlers: {
    'message/send': async (message) => {
      // Process incoming A2A message
      return { status: 'completed' };
    },
  },
});

await server.start();
```

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`
