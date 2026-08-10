# @a2amesh/protocol

`@a2amesh/protocol` defines the core data types, JSON Schema files, validators, and compatibility fixtures for the Agent2Agent (A2A) protocol.

## Purpose

- **Protocol Types & Interfaces**: Declares TypeScript types for the A2A spec, including `AgentCard`, `Task`, `Message`, and `Artifact`.
- **JSON Schemas**: Bundles standalone schema assets for editor, validator, and runtime integration.
- **Zero Runtime Dependencies**: Optimized for lightweight transport layers and client SDKs.

## Installation

```bash
npm install @a2amesh/protocol
```

## Usage Example

```typescript
import type { AgentCard, Task, Message } from '@a2amesh/protocol';

const card: AgentCard = {
  a2aVersion: '1.0',
  name: 'my-agent',
  description: 'An example A2A agent',
  endpoints: [
    {
      transport: 'http-json-rest',
      url: 'https://api.example.com/a2a',
    },
  ],
};
```

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`
