import OpenAI from 'openai';
import {
  runLiveSmoke,
  type OpenAICompatibleClient,
  type OpenAICompatibleClientFactory,
} from './index.js';

const clientFactory: OpenAICompatibleClientFactory = (options) =>
  new OpenAI(options) as unknown as OpenAICompatibleClient;

runLiveSmoke({ env: process.env, clientFactory })
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Live provider smoke failed.');
    process.exit(1);
  });
