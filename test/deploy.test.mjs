import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, serverConfig } from '../server.mjs';

// Sends a request with an arbitrary Host header, which fetch() does not allow.
function request(port, { method = 'GET', path = '/', host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers: { Host: host, ...headers } }, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('deployment config reads hosts and live toggle from env', () => {
  const config = serverConfig({}, { ALLOWED_HOSTS: 'A.example.com, b.example.com', RENDER_EXTERNAL_HOSTNAME: 'app.onrender.com', LIVE_ANALYSIS: 'off' });
  assert.deepEqual([...config.allowedHosts], ['localhost', '127.0.0.1', 'a.example.com', 'b.example.com', 'app.onrender.com']);
  assert.equal(config.liveEnabled, false);
  assert.equal(serverConfig({}, {}).liveEnabled, true);
  assert.equal(serverConfig({}, {}).maxActive, 3);
});

test('public host, HTTPS origin, health check and sample-only mode', async t => {
  const server = createServer({ provider: 'openai', key: 'private-test-key', allowedHosts: ['demo.example.com'], liveEnabled: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
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
  assert.equal((await post('/api/analyze', { mode: 'sample' }, { Origin: `https://other.example` })).status, 403);

  const sample = await post('/api/analyze', { mode: 'sample' }, { Origin: `https://${host}` });
  assert.equal(sample.status, 200);
  assert.equal(sample.body.trim().split('\n').map(JSON.parse).at(-1).type, 'analysis');
});
