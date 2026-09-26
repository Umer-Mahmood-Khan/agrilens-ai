import { fileURLToPath } from 'node:url';
import { aiConfig, requestModel } from '../lib/ai.mjs';

try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const config = aiConfig();
console.log(JSON.stringify({ provider: config.provider, model: config.model, keyConfigured: Boolean(config.key) }));
try {
  const value = await requestModel('connection_test', {
    type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false
  }, 'Return a JSON object with ok set to true.', [{ type: 'input_text', text: 'Connection check.' }], { maxRetries: 0 });
  if (value.ok !== true) throw new Error('Connection check returned ok=false.');
  console.log('Connection and structured output check passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
