import OpenAI from 'openai';
import {
  runLiveSmoke,
  type OpenAICompatibleClient,
  type OpenAICompatibleClientFactory,
} from './index.js';

const clientFactory: OpenAICompatibleClientFactory = (options) =>
  new OpenAI(options) as unknown as OpenAICompatibleClient;

try {
  const result = await runLiveSmoke({ env: process.env, clientFactory });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Live provider smoke failed.');
  process.exitCode = 1;
}
