// Optional live check: two AI extraction stages and deterministic recommendations plus bounded retries, using public/synthetic files.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyze, generatePlan } from '../lib/pipeline.mjs';
process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const file = async (name, mime) => ({ name, data: `data:${mime};base64,${(await readFile(new URL(`../sample-data/${name}`, import.meta.url))).toString('base64')}` });
const emit = event => { if (event.type === 'stage') console.log(`${event.stage}: ${event.status} - ${event.detail}`); };
const model = process.argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length);
const options = { model, cache: new Map(), fetchImpl: async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.clone().json().catch(() => ({}));
    const message = String(body.error?.message || '').replaceAll(process.env.OPENAI_API_KEY || '[no-openai-key]', '[REDACTED]').replaceAll(process.env.GEMINI_API_KEY || '[no-gemini-key]', '[REDACTED]');
    console.log(JSON.stringify({ httpStatus: response.status, code: body.error?.status, error: message.slice(0, 1200) }));
  }
  return response;
} };
try {
  const result = await analyze({ mode: 'live', context: { crop: 'Wheat', stage: 'Unknown', location: '', notes: 'Public reference photo and unrelated synthetic report for testing.' },
    photo: await file('wheat-leaf-rust.jpg', 'image/jpeg'), report: await file('sample-soil-report.png', 'image/png') }, emit, options);
  console.log(JSON.stringify({ check: 'extraction', usablePhoto: result.vision.usable, readableReport: result.soil.readable, soilRows: result.soil.readings.length }));
  const expected = JSON.parse((await readFile(new URL('../sample-data/expected-soil-readings.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
  const missing = expected.filter(row => !result.soil.readings.some(actual => actual.value === row.value && actual.unit === row.unit));
  if (missing.length) throw new Error('Some expected soil values/units did not match; inspect extraction manually.');
  const report = await generatePlan(result, result.soil.readings, emit, options);
  if (report.plan.actions.length !== 3 || report.recommendationMethod !== 'wheat-evidence-v1') throw new Error('Deterministic recommendation check failed.');
  console.log(JSON.stringify({ check: 'full-workflow', complete: true, actions: report.plan.actions.length, sources: report.sources.length, review: report.review.verdict }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
