import test from 'node:test';
import assert from 'node:assert/strict';
import { aiConfig } from '../lib/ai.mjs';
import { analyze, generatePlan, callModel } from '../lib/pipeline.mjs';
import { visionSchema } from '../lib/schemas.mjs';
import { sampleVision, sampleSoil, samplePlan } from '../lib/sample.mjs';
import { knowledge } from '../lib/knowledge.mjs';
import { createServer } from '../server.mjs';

const photo = { name: 'leaf.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG6kAAAAASUVORK5CYII=' };
const pdf = { name: 'report.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nfixture content').toString('base64')}` };
const context = { crop: 'Wheat', stage: 'Tillering', location: 'Punjab', notes: '' };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const modelResponse = data => response({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'ignored thinking text' }, { text: JSON.stringify(data) }] } }] });

test('provider selection defaults to OpenAI and isolates the keys', () => {
  const env = { GEMINI_API_KEY: 'google-test-key', OPENAI_API_KEY: 'openai-test-key' };
  const config = aiConfig({}, env);
  assert.equal(config.provider, 'openai');
  assert.equal(config.key, 'openai-test-key');
  assert.equal(config.model, 'gpt-5.4-mini');
  assert.equal(aiConfig({ provider: 'gemini' }, env).key, 'google-test-key');
  assert.equal(aiConfig({}, { GEMINI_API_KEY: 'google-test-key' }).key, '');
  assert.equal(aiConfig({ key: '' }, env).key, '');
  assert.throws(() => aiConfig({ provider: 'unknown' }, env), /AI_PROVIDER/);
  assert.throws(() => aiConfig({ model: '../bad?key=value' }, env), /valid model ID/);
});

test('Gemini handles photo and PDF extraction, planning and review end to end', async () => {
  const requests = []; const events = [];
  const draft = samplePlan(sampleSoil.readings, knowledge);
  const outputs = [sampleVision, sampleSoil, draft, { verdict: 'Reviewed with limitations', notes: ['Mocked Gemini review'], plan: draft }];
  const options = { provider: 'gemini', model: 'gemini-3.8-flash', key: 'google-test-key', fetchImpl: async (url, req) => {
    requests.push({ url, headers: req.headers, body: JSON.parse(req.body) });
    return modelResponse(outputs[requests.length - 1]);
  } };
  const analysis = await analyze({ mode: 'live', context, photo, report: pdf }, e => events.push(e), options);
  const edited = structuredClone(analysis.soil.readings); edited[0].value = '6.8';
  const result = await generatePlan(analysis, edited, e => events.push(e), options);
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'google-test-key');
    assert.equal(req.headers.Authorization, undefined);
    assert.equal(req.url.includes('google-test-key'), false);
    assert.equal(JSON.stringify(req.body).includes('google-test-key'), false);
    assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(req.body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.equal('responseFormat' in req.body.generationConfig, false);
    assert.match(req.body.systemInstruction.parts[0].text, /untrusted data/);
  }
  assert.equal(requests[0].body.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(requests[0].body.contents[0].parts[1].inlineData.data, photo.data.split(',')[1]);
  assert.equal(requests[1].body.contents[0].parts[1].inlineData.mimeType, 'application/pdf');
  assert.equal(requests[1].body.contents[0].parts[1].inlineData.data, pdf.data.split(',')[1]);
  assert.equal(result.confirmedSoil[0].value, '6.8');
  assert.equal(result.soil.readings[0].value, '7.6');
  assert.equal(result.recommendationMethod, 'wheat-evidence-v1');
  assert.equal(events.at(-1).stage, 'review');
});

test('Gemini photo-only flow skips report and missing key never uses a fallback', async () => {
  let count = 0;
  const options = { provider: 'gemini', key: 'test', fetchImpl: async () => { count++; return modelResponse(sampleVision); } };
  const result = await analyze({ mode: 'live', context, photo }, () => {}, options);
  assert.equal(count, 1);
  assert.deepEqual(result.soil.readings, []);
  await assert.rejects(analyze({ mode: 'live', context, photo }, () => {}, { ...options, key: '' }), /GEMINI_API_KEY/);
  assert.equal(count, 1);
});

test('Gemini quota, key, access, refusal, truncated and malformed responses fail clearly', async () => {
  const cases = [
    [() => new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at generation_config.response_format.text.mime_type: application/json' } }), { status: 400 }), /generation settings/],
    [() => new Response(JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }), /key was rejected.*GEMINI_API_KEY/],
    [() => new Response('{}', { status: 403 }), /denied access/],
    [() => new Response('{}', { status: 429 }), /Google AI Studio/],
    [() => new Response('{}', { status: 503 }), /high demand \(503\)/],
    [() => new Response('{}', { status: 404 }), /GEMINI_MODEL/],
    [() => response({ promptFeedback: { blockReason: 'SAFETY' } }), /could not analyze/],
    [() => response({ candidates: [{ finishReason: 'SAFETY' }] }), /could not analyze/],
    [() => response({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), /did not finish/],
    [() => response({ candidates: [] }), /no completed result/],
    [() => modelResponse({ ...sampleVision, confidence: 90 }), /invalid result/],
    [() => new Response('not json'), /invalid response/]
  ];
  for (const [fetchImpl, message] of cases) await assert.rejects(callModel('test', visionSchema, '', [], { provider: 'gemini', key: 'test', maxRetries: 0, fetchImpl }), message);
});

test('Gemini abort and network failure do not leak secrets', async () => {
  const controller = new AbortController(); controller.abort();
  const options = { provider: 'gemini', key: 'secret-test-key', maxRetries: 0, fetchImpl: async () => { throw new Error('Internal: secret-test-key'); } };
  await assert.rejects(callModel('test', visionSchema, '', [], { ...options, signal: controller.signal }), /cancelled/);
  await assert.rejects(callModel('test', visionSchema, '', [], options), e => /could not be reached/.test(e.message) && !e.message.includes('secret-test-key'));
});

test('Gemini configuration and setup pages expose no API key', async t => {
  const server = createServer({ provider: 'gemini', key: 'private-test-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const configResponse = await fetch(`${base}/api/config`);
  const text = await configResponse.text(); const config = JSON.parse(text);
  assert.equal(config.liveAvailable, true);
  assert.equal(config.provider, 'gemini');
  assert.equal(text.includes('private-test-key'), false);
  assert.equal('key' in config, false);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.match(await (await fetch(base)).text(), /OPENAI_API_KEY/);
});
