import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, serverConfig } from '../server.mjs';
import { createLimiter, clientIp } from '../lib/limits.mjs';

// Sends a request with an arbitrary Host header, which fetch() does not allow.
function request(port, { method = 'GET', path = '/', host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers: { Host: host, ...headers } }, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.end(body);
  });
}
async function listen(t, options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}
const events = body => body.trim().split('\n').map(JSON.parse);
const photo = name => ({ name, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG6kAAAAASUVORK5CYII=' });
const context = { crop: 'Wheat', stage: 'Tillering', location: '', notes: '' };
const visitorKey = 'sk-visitor-0123456789';

test('deployment config reads hosts, live mode and limits from env', () => {
  const config = serverConfig({}, { ALLOWED_HOSTS: 'A.example.com, b.example.com', RENDER_EXTERNAL_HOSTNAME: 'app.onrender.com', LIVE_ANALYSIS: 'off', LIVE_LIMIT_PER_HOUR: '5', TRUST_PROXY: '1' });
  assert.deepEqual([...config.allowedHosts], ['localhost', '127.0.0.1', 'a.example.com', 'b.example.com', 'app.onrender.com']);
  assert.equal(config.liveMode, 'off');
  assert.equal(config.livePerHour, 5); assert.equal(config.trustProxy, 1);
  assert.equal(serverConfig({}, {}).liveMode, 'server');
  assert.equal(serverConfig({}, { LIVE_ANALYSIS: ' Visitor ' }).liveMode, 'visitor');
  assert.equal(serverConfig({}, {}).maxActive, 3);
  const space = serverConfig({}, { SPACE_ID: 'umer/agrilens-ai', SPACE_HOST: 'umer-agrilens-ai.hf.space' });
  assert.equal(space.liveMode, 'visitor');
  assert.equal(space.allowedHosts.has('umer-agrilens-ai.hf.space'), true);
  assert.equal(space.frameAncestors, 'https://huggingface.co');
  assert.equal(serverConfig({}, { SPACE_ID: 'x', LIVE_ANALYSIS: 'off' }).liveMode, 'off');
  assert.equal(serverConfig({}, {}).frameAncestors, "'none'");
});

test('limiter and client address helpers', () => {
  let now = 0;
  const limit = createLimiter(2, 1000, () => now);
  assert.equal(limit.wait('a'), 0); limit.record('a'); limit.record('a');
  assert.equal(limit.wait('a'), 1000);
  assert.equal(limit.wait('b'), 0);
  now = 1001; assert.equal(limit.wait('a'), 0);
  assert.equal(createLimiter(0, 1000).wait('a'), 0);
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, 0), '10.0.0.1');
  assert.equal(clientIp(req, 1), '1.2.3.4');
  assert.equal(clientIp(req, 5), '6.6.6.6');
});

test('public host, HTTPS origin, health check and sample-only mode', async t => {
  const port = await listen(t, { provider: 'openai', key: 'private-test-key', allowedHosts: ['demo.example.com'], liveMode: 'off' });
  const host = 'demo.example.com';
  const post = (path, data, headers = {}) => request(port, { method: 'POST', path, host, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });

  assert.equal((await request(port, { path: '/healthz', host: '10.0.0.5:3001' })).status, 200);
  assert.equal((await request(port, { host: 'evil.example' })).status, 403);
  assert.equal((await request(port, { host })).status, 200);

  const config = JSON.parse((await request(port, { path: '/api/config', host })).body);
  assert.equal(config.liveEnabled, false);
  assert.equal(config.liveAvailable, false);
  assert.equal('key' in config, false);

  const live = await post('/api/analyze', { mode: 'live' }, { Origin: `https://${host}` });
  assert.equal(live.status, 403);
  assert.match(JSON.parse(live.body).error, /turned off/);
  assert.equal((await post('/api/analyze', { mode: 'sample' }, { Origin: 'https://other.example' })).status, 403);

  const sample = await post('/api/analyze', { mode: 'sample' }, { Origin: `https://${host}` });
  assert.equal(sample.status, 200);
  assert.equal(events(sample.body).at(-1).type, 'analysis');
});

test('visitor mode uses only the key the visitor enters, never the server key', async t => {
  const seen = [];
  const port = await listen(t, { provider: 'openai', key: 'owner-secret-key', liveMode: 'visitor', maxRetries: 0,
    fetchImpl: async (url, init) => { seen.push({ url: String(url), headers: init.headers }); return new Response('{}', { status: 401 }); } });
  const post = (data, headers = {}) => request(port, { method: 'POST', path: '/api/analyze', host: 'localhost', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ mode: 'live', context, photo: photo('a.png'), ...data }) });

  const config = JSON.parse((await request(port, { path: '/api/config', host: 'localhost' })).body);
  assert.equal(config.visitorKey, true);
  assert.equal(config.liveAvailable, true);
  assert.deepEqual(Object.keys(config.models), ['openai', 'gemini']);

  const missing = await post({});
  assert.equal(missing.status, 401);
  assert.match(JSON.parse(missing.body).error, /Enter your OpenAI API key/);
  assert.equal((await post({}, { 'X-API-Key': 'short' })).status, 401);
  assert.equal((await post({}, { 'X-API-Key': visitorKey, 'X-AI-Provider': 'other' })).status, 400);
  assert.equal((await post({ mode: 'sample' })).status, 200, 'sample mode needs no key');
  assert.equal(seen.length, 0, 'the server key is never used as a fallback');

  const rejected = await post({}, { 'X-API-Key': visitorKey });
  const failure = events(rejected.body).at(-1);
  assert.equal(failure.type, 'error');
  assert.match(failure.error, /rejected the API key you entered/);
  assert.equal(failure.error.includes(visitorKey), false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.Authorization, `Bearer ${visitorKey}`);
  assert.equal(JSON.stringify(seen).includes('owner-secret-key'), false);

  await post({ photo: photo('b.png') }, { 'X-API-Key': 'AIza-visitor-gemini-key', 'X-AI-Provider': 'gemini' });
  assert.match(seen[1].url, /generativelanguage\.googleapis\.com/);
  assert.equal(seen[1].headers['x-goog-api-key'], 'AIza-visitor-gemini-key');
});

test('visitor limit counts new live analyses per IP, not resumes', async t => {
  let calls = 0;
  const port = await listen(t, { provider: 'openai', key: '', liveMode: 'visitor', maxRetries: 0, livePerHour: 1, trustProxy: 1,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 500 }); } });
  const post = (data, ip) => request(port, { method: 'POST', path: '/api/analyze', host: 'localhost', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'X-API-Key': visitorKey }, body: JSON.stringify({ mode: 'live', context, ...data }) });

  const first = await post({ photo: photo('a.png') }, '1.1.1.1');
  assert.equal(first.status, 200); assert.equal(calls, 1);
  const id = events(first.body)[0].id;
  assert.equal((await post({ id, photo: photo('a.png') }, '1.1.1.1')).status, 200, 'resume does not count');
  const limited = await post({ photo: photo('c.png') }, '1.1.1.1');
  assert.equal(limited.status, 429); assert.match(JSON.parse(limited.body).error, /limit/);
  assert.equal((await post({ photo: photo('d.png') }, '2.2.2.2')).status, 200, 'other visitors are unaffected');
});
