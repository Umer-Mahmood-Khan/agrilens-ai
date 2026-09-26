import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { analyze, generatePlan, callModel, validateFile, groundPlan } from '../lib/pipeline.mjs';
import { visionSchema, validate } from '../lib/schemas.mjs';
import { knowledge, retrieve } from '../lib/knowledge.mjs';
import { sampleVision, sampleSoil, samplePlan } from '../lib/sample.mjs';

const photo = { name: 'leaf.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG6kAAAAASUVORK5CYII=' };
const pdf = { name: 'soil.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nfixture content').toString('base64')}` };
const context = { crop: 'Wheat', stage: 'Tillering', location: 'Punjab', notes: '' };
const modelResponse = object => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(object) }] }] }), { status: 200 });

test('sample analysis pauses for corrected soil and generates a sourced report', async () => {
  const events = [];
  const analysis = await analyze({ mode: 'sample' }, e => events.push(e));
  assert.equal(analysis.mode, 'sample');
  assert.deepEqual(events.filter(e => e.status === 'complete').map(e => e.stage), ['vision', 'soil']);
  const edited = structuredClone(analysis.soil.readings); edited[0].value = '6.8';
  const report = await generatePlan(analysis, edited, e => events.push(e));
  assert.equal(report.confirmedSoil[0].value, '6.8');
  assert.equal(report.soil.readings[0].value, '7.6');
  assert.ok(report.plan.actions.length >= 2);
  assert.ok(report.plan.actions.every(a => a.sourceIds.every(id => report.sources.some(s => s.id === id))));
  assert.match(report.plan.limitations.join(' '), /no AI inference/i);
  assert.equal(events.at(-1).stage, 'review');
});

test('retrieval prioritizes relevant symptoms and does not invent matches', () => {
  assert.equal(retrieve('orange yellow stripe rust stripes')[0].id, 'WHEAT-02');
  assert.equal(retrieve('')[0], undefined);
  assert.deepEqual(retrieve('xyzzyflorb'), []);
});

test('invalid file type, forged signature and oversized files are rejected', () => {
  assert.equal(validateFile(photo, 'photo').mime, 'image/png');
  assert.equal(validateFile(pdf, 'report').mime, 'application/pdf');
  assert.throws(() => validateFile(pdf, 'photo'), /PNG/);
  assert.throws(() => validateFile({ name: 'bad.png', data: `data:image/png;base64,${Buffer.from('not a real image at all').toString('base64')}` }, 'photo'), /contents/);
  assert.throws(() => validateFile({ name: 'large.png', data: `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')}` }, 'photo'), /8 MB/);
});

test('live analysis never silently falls back to sample', async () => {
  await assert.rejects(analyze({ mode: 'live', context, photo }, () => {}, { provider: 'openai', key: '' }), /OPENAI_API_KEY/);
  await assert.rejects(analyze({ mode: 'oops' }, () => {}), /mode/);
});

test('mocked live photo-only path skips report extraction without inventing soil', async () => {
  const requests = []; const events = [];
  const result = await analyze({ mode: 'live', context, photo }, e => events.push(e), { provider: 'openai', key: 'test-only', fetchImpl: async (url, req) => { requests.push(JSON.parse(req.body)); return modelResponse(sampleVision); } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].text.format.strict, true);
  assert.equal(requests[0].input[0].content[1].type, 'input_image');
  assert.deepEqual(result.soil.readings, []);
  assert.equal(events.at(-1).status, 'skipped');
  assert.equal(result.files.photo, 'leaf.png');
  assert.equal(JSON.stringify(result).includes('base64'), false);
});

test('mocked live PDF extraction preserves units and reports unreadable input', async () => {
  const requests = [];
  const unreadable = { readable: false, summary: 'This report is not readable.', readings: [], warnings: ['Please upload a clearer scan.'] };
  const result = await analyze({ mode: 'live', context, photo, report: pdf }, () => {}, { provider: 'openai', key: 'test-only', fetchImpl: async (url, req) => { requests.push(JSON.parse(req.body)); return modelResponse(requests.length === 1 ? sampleVision : unreadable); } });
  assert.equal(requests[1].input[0].content[1].type, 'input_file');
  assert.match(requests[1].input[0].content[1].file_data, /^data:application\/pdf;base64,/);
  assert.equal(result.soil.readable, false);
  assert.deepEqual(result.soil.readings, []);
});

test('model refusal, API errors and malformed or incomplete results surface as errors', async () => {
  const cases = [
    [() => new Response('{}', { status: 401 }), /key was rejected/],
    [() => new Response('{}', { status: 429 }), /rate limit/],
    [() => new Response(JSON.stringify({ status: 'incomplete' })), /did not finish/],
    [() => new Response(JSON.stringify({ output: [{ content: [{ type: 'refusal' }] }] })), /could not analyze/],
    [() => modelResponse({ invented: 'bad schema' }), /invalid result/]
  ];
  for (const [fetchImpl, message] of cases) await assert.rejects(callModel('test', visionSchema, '', [], { provider: 'openai', key: 'test', fetchImpl }), message);
});

test('recommendations are deterministic and require no generation calls; invalid references are withheld', async () => {
  const analysis = { mode: 'live', context, vision: sampleVision, soil: sampleSoil, files: {} };
  const options = { fetchImpl: async () => { throw new Error('Planning must not call an AI provider'); } };
  const first = await generatePlan(analysis, [], () => {}, options);
  const second = await generatePlan(analysis, [], () => {}, options);
  assert.deepEqual(first.plan, second.plan);
  assert.equal(first.plan.actions.length, 3);
  assert.equal(first.recommendationMethod, 'wheat-evidence-v1');
  assert.equal(first.plan.actions[1].title, 'Get a soil test');
  const invalid = { ...first.plan, actions: [{ ...first.plan.actions[0], sourceIds: ['INVENTED-ID'] }] };
  assert.equal(groundPlan(invalid, knowledge).actions.length, 0);
  assert.match(groundPlan(invalid, knowledge).limitations.join(' '), /withheld/);
});

test('soil correction validates rows and preserves blank optional fields', async () => {
  const a = await analyze({ mode: 'sample' }, () => {});
  await assert.rejects(generatePlan(a, [{ parameter: 'N', value: '1' }], () => {}), /invalid/);
  await assert.rejects(generatePlan(a, [{ parameter: '', value: '', unit: '', reference: '', interpretation: '' }], () => {}), /parameter/);
  assert.throws(() => validate(visionSchema, { ...sampleVision, confidence: 87 }), /unexpected/);
});

test('HTTP sample workflow, asset serving and request boundaries', async t => {
  const server = createServer({ provider: 'gemini', key: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.liveAvailable, false);
  assert.equal(config.provider, 'gemini');
  assert.equal(config.keyEnv, 'GEMINI_API_KEY');
  assert.equal('key' in config, false);
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /AgriLens/);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await post('/api/analyze', {}, { Origin: 'https://evil.example' })).status, 403);
  const first = await post('/api/analyze', { mode: 'sample' });
  const events = (await first.text()).trim().split('\n').map(JSON.parse);
  const analysis = events.at(-1); assert.equal(analysis.type, 'analysis');
  const second = await post('/api/plan', { id: analysis.id, readings: analysis.soil.readings });
  const result = (await second.text()).trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(result.type, 'result'); assert.equal(result.mode, 'sample');
  assert.equal((await post('/api/plan', { id: 'unknown', readings: [] })).status, 410);
  assert.equal((await post('/api/analyze', { mode: 'live', context, photo })).status, 503);
});
