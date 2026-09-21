import { describe, expect, it } from 'vitest';
import { createScaffoldCommand } from '../src/commands/scaffold.js';
import { expectCommandHelp } from './command-test-helpers.js';

describe('init command', () => {
  it('defines the init command and stable template options', () => {
    const command = createScaffoldCommand();

    expect(command.name()).toBe('init');
    expect(command.alias()).toBe('scaffold');
    expectCommandHelp(command, [
      'init|scaffold [options] <agent-name>',
      '--adapter <adapter>',
      '--auth',
      '--rate-limit',
      '--docker',
    ]);
  });
});
