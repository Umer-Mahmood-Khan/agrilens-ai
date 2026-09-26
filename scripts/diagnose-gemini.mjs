import { fileURLToPath } from 'node:url';
import { aiConfig, requestModel } from '../lib/ai.mjs';

try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const config = aiConfig({ provider: 'gemini' });
if (!config.key) { console.error('GEMINI_API_KEY is not configured.'); process.exit(1); }
const redact = value => String(value ?? '').replaceAll(config.key, '[REDACTED]').replace(/AIza[\w-]+/g, '[REDACTED]');
const headers = { 'x-goog-api-key': config.key, 'Content-Type': 'application/json' };
try {
  const list = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers, signal: AbortSignal.timeout(20000) });
  const available = await list.json();
  console.log(JSON.stringify({ check: 'models', httpStatus: list.status, configuredModel: config.model,
    configuredModelListed: available.models?.some(m => m.name === `models/${config.model}`),
    flashModels: available.models?.filter(m => /flash/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name),
    error: available.error ? redact(available.error.message).slice(0, 1200) : undefined }));
  if (!list.ok) { process.exitCode = 1; }
  else {
    // Exercise the actual app adapter so this diagnostic cannot drift from it.
    const value = await requestModel('connection_test', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      'Return a JSON object with ok set to true.', [{ type: 'input_text', text: 'Connection check.' }], {
        provider: 'gemini', fetchImpl: async (url, init) => {
          const result = await fetch(url, init);
          if (!result.ok) {
            const body = await result.clone().json().catch(() => ({}));
            console.log(JSON.stringify({ check: 'request-format', httpStatus: result.status, status: body.error?.status,
              error: redact(body.error?.message).slice(0, 1800) }));
          }
          return result;
        }
      });
    console.log(JSON.stringify({ check: 'request-format', validStructuredResponse: value.ok === true }));
  }
} catch (e) { console.error(`Gemini diagnostic failed: ${redact(e.message)}`); process.exitCode = 1; }
