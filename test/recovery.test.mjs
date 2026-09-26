import test from 'node:test';
import assert from 'node:assert/strict';
import { requestModel } from '../lib/ai.mjs';
import { createServer } from '../server.mjs';
import { sampleVision, sampleSoil, samplePlan } from '../lib/sample.mjs';
import { knowledge } from '../lib/knowledge.mjs';
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const response = data => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }] }));
const failed = status => new Response('{}', { status });
const baseOptions = { provider: 'gemini', key: 'test', sleep: async () => {} };
const call = options => requestModel('test', schema, '', [], { ...baseOptions, ...options });

test('temporary 503/502 failures recover with bounded backoff and progress', async () => {
  let calls = 0; const waits = [], progress = [];
  const result = await call({ fetchImpl: async () => ++calls <= 2 ? failed(calls === 1 ? 503 : 502) : response({ ok: true }),
    sleep: async ms => waits.push(ms), onRetry: event => progress.push(event) });
  assert.equal(result.ok, true); assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 5000]);
  assert.deepEqual(progress.map(e => e.attempt), [2, 3]);
});

test('retries stop after three attempts and never retry quota or invalid requests', async () => {
  let calls = 0;
  await assert.rejects(call({ fetchImpl: async () => { calls++; return failed(503); } }), /503/);
  assert.equal(calls, 3);
  for (const status of [400, 401, 403, 404, 429]) {
    calls = 0;
    await assert.rejects(call({ fetchImpl: async () => { calls++; return failed(status); } }));
    assert.equal(calls, 1);
  }
});

test('transient connection failure retries; cancellation during backoff stops calls', async () => {
  let calls = 0;
  await call({ fetchImpl: async () => { if (++calls === 1) throw new TypeError('fetch failed'); return response({ ok: true }); } });
  assert.equal(calls, 2);
  calls = 0;
  const abort = new AbortController();
  await assert.rejects(call({ signal: abort.signal, fetchImpl: async () => { calls++; return failed(503); }, onRetry: () => abort.abort(), sleep: undefined }), /cancelled/);
  assert.equal(calls, 1);
});

test('a long Retry-After does not trigger an early retry', async () => {
  let calls = 0;
  await assert.rejects(call({ fetchImpl: async () => { calls++; return new Response('{}', { status: 503, headers: { 'Retry-After': '60' } }); } }), /503/);
  assert.equal(calls, 1);
});

test('short explicit rate-limit waits are honored; daily and zero quota never retry', async () => {
  const quotaResponse = (quotaId = 'RequestsPerMinute', message = 'limit: 5') => new Response(JSON.stringify({ error: { message, details: [
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2.364s' },
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] }
  ] } }), { status: 429 });
  let calls = 0; const waits = [];
  const result = await call({ fetchImpl: async () => ++calls === 1 ? quotaResponse() : response({ ok: true }), sleep: async ms => waits.push(ms) });
  assert.equal(result.ok, true); assert.deepEqual(waits, [2864]); assert.equal(calls, 2);
  for (const [id, message] of [['RequestsPerDay', 'limit: 20'], ['RequestsPerMinute', 'limit: 0']]) {
    calls = 0;
    await assert.rejects(call({ fetchImpl: async () => { calls++; return quotaResponse(id, message); } }), /quota/);
    assert.equal(calls, 1);
  }
});

test('HTTP resume preserves vision, rejects changed inputs, and updates recommendations for edited soil', async t => {
  const counts = { vision: 0, soil: 0, plan: 0, review: 0 };
  let soilFails = true, reviewFails = true;
  const draft = samplePlan(sampleSoil.readings, knowledge);
  const server = createServer({ ...baseOptions, maxRetries: 0, fetchImpl: async (url, init) => {
    const fields = JSON.parse(init.body).generationConfig.responseJsonSchema.properties;
    if (fields.observations) { counts.vision++; return response(sampleVision); }
    if (fields.readings) { counts.soil++; return soilFails ? failed(503) : response(sampleSoil); }
    if (fields.verdict) { counts.review++; return reviewFails ? failed(503) : response({ verdict: 'Reviewed with limitations', notes: [], plan: draft }); }
    counts.plan++; return response(draft);
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, input) => {
    const r = await fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const events = (await r.text()).trim().split('\n').map(JSON.parse);
    return { status: r.status, events, last: events.at(-1) };
  };
  const photo = { name: 'leaf.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG6kAAAAASUVORK5CYII=' };
  const input = { mode: 'live', context: { crop: 'Wheat', stage: 'Unknown', location: '', notes: '' }, photo, report: photo };
  const first = await post('/api/analyze', input);
  const id = first.events.find(e => e.type === 'session').id;
  assert.equal(first.last.type, 'error'); assert.equal(first.last.stage, 'soil');
  assert.ok(first.events.some(e => e.type === 'finding' && e.stage === 'vision'));
  assert.deepEqual(counts, { vision: 1, soil: 1, plan: 0, review: 0 });
  soilFails = false;
  const resumed = await post('/api/analyze', { ...input, id });
  assert.equal(resumed.last.type, 'analysis'); assert.equal(counts.vision, 1); assert.equal(counts.soil, 2);
  const changed = await post('/api/analyze', { ...input, id, context: { ...input.context, notes: 'changed' } });
  assert.equal(changed.status, 409);
  const planInput = { id, readings: sampleSoil.readings };
  const planFirst = await post('/api/plan', planInput);
  assert.equal(planFirst.last.type, 'result');
  assert.equal(counts.plan, 0); assert.equal(counts.review, 0);
  assert.match(planFirst.last.plan.actions[1].detail, /Nitrogen/);
  const edited = structuredClone(sampleSoil.readings); edited[0].value = '6.8'; edited[1].interpretation = 'Adequate';
  const updated = await post('/api/plan', { id, readings: edited });
  assert.equal(updated.last.type, 'result'); assert.equal(updated.last.confirmedSoil[0].value, '6.8');
  assert.equal(updated.last.plan.actions[1].title, 'Confirm the lab interpretation');
  assert.equal(counts.plan, 0); assert.equal(counts.review, 0);
});
