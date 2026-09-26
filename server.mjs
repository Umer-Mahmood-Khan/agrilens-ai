import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { analyze, generatePlan, AppError } from './lib/pipeline.mjs';
import { knowledge } from './lib/knowledge.mjs';
import { aiConfig, requireKey } from './lib/ai.mjs';
try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const publicFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/soil.mjs', ['soil.mjs', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/refinement.css', ['refinement.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
const MAX_BODY = 23 * 1024 * 1024;
const TTL = 30 * 60 * 1000;
const list = value => (value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
// Deployment settings. Defaults keep the original local-only behavior; a public
// host must be listed in ALLOWED_HOSTS (Render's hostname is added automatically).
export function serverConfig(options = {}, env = process.env) {
  return {
    allowedHosts: new Set(options.allowedHosts ?? ['localhost', '127.0.0.1', ...list(env.ALLOWED_HOSTS), ...list(env.RENDER_EXTERNAL_HOSTNAME)]),
    liveEnabled: options.liveEnabled ?? !/^(0|false|off|no|disabled)$/i.test((env.LIVE_ANALYSIS || '').trim()),
    maxActive: options.maxActive ?? (Number(env.MAX_CONCURRENT) || 3)
  };
}
export function createServer(options = {}) {
  const { allowedHosts, liveEnabled, maxActive } = serverConfig(options);
  const sessions = new Map();
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, 'http://localhost');
    let streaming = false, acquired = false, currentStage = null, sessionInUse = null, heartbeat;
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const emit = event => {
      if (abort.signal.aborted || res.destroyed) return;
      if (event.type === 'stage' && event.status === 'running') currentStage = event.stage;
      if (!streaming) { res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' }); streaming = true; }
      res.write(JSON.stringify(event) + '\n');
    };
    try {
      // Platform health checks may use an internal hostname, so answer before the Host check.
      if (req.method === 'GET' && url.pathname === '/healthz') return json(200, { ok: true });
      const host = (req.headers.host || '').split(':')[0].toLowerCase();
      if (!allowedHosts.has(host)) throw new AppError('Invalid host.', 403);
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const config = aiConfig(options);
        return json(200, { liveEnabled, liveAvailable: liveEnabled && Boolean(config.key), provider: config.provider, providerLabel: config.label, keyEnv: config.keyEnv, model: config.model, sources: knowledge.length });
      }
      if (req.method === 'GET' && url.pathname === '/api/knowledge') return json(200, knowledge);
      if (req.method === 'GET' && publicFiles.has(url.pathname)) {
        const [file, mime] = publicFiles.get(url.pathname);
        const data = await readFile(new URL(`public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); return res.end(data);
      }
      if (req.method !== 'POST' || !['/api/analyze', '/api/plan'].includes(url.pathname)) return json(404, { error: 'Not found.' });
      // Behind an HTTPS proxy the browser origin is https:// while the server sees plain HTTP.
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw new AppError('Only same-origin requests are accepted.', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Send application/json.', 415);
      if (Number(req.headers['content-length']) > MAX_BODY) throw new AppError('Files are too large. Maximum 8 MB per file.', 413);
      if (active >= maxActive) throw new AppError('The app is busy. Please wait for the current analysis.', 429);
      active++; acquired = true;
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new AppError('Files are too large.', 413); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('The request could not be read.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Invalid request.');
      for (const [id, session] of sessions) if (!session.running && session.expires < Date.now()) sessions.delete(id);
      const runOptions = { ...options, signal: abort.signal };
      heartbeat = setInterval(() => { if (streaming) emit({ type: 'heartbeat' }); }, 10000);
      heartbeat.unref();
      if (url.pathname === '/api/analyze') {
        if (body.mode === 'live') {
          if (!liveEnabled) throw new AppError('Live analysis is turned off on this public demo. Try the sample walkthrough, or run AgriLens locally with your own API key.', 403);
          requireKey(options);
        }
        const fingerprint = createHash('sha256').update(JSON.stringify({ mode: body.mode, context: body.context, photo: body.photo, report: body.report })).digest('hex');
        const id = body.id || randomUUID();
        let session = sessions.get(id);
        if (body.id && !session) throw new AppError('This analysis expired. Start a new analysis.', 410);
        if (session && session.fingerprint !== fingerprint) throw new AppError('The inputs changed. Start a new analysis.', 409);
        if (session?.running) throw new AppError('This analysis is still finishing. Wait a moment before retrying.', 429);
        if (!session) {
          if (sessions.size >= 100) {
            const old = [...sessions].find(([, s]) => !s.running);
            if (old) sessions.delete(old[0]);
          }
          session = { fingerprint, cache: new Map(), expires: Date.now() + TTL };
          sessions.set(id, session);
        }
        session.running = true; sessionInUse = session;
        emit({ type: 'session', id });
        const result = await analyze(body, emit, { ...runOptions, cache: session.cache });
        session.analysis = result;
        emit({ type: 'analysis', id, ...result });
      } else {
        const session = sessions.get(body.id);
        if (!session) throw new AppError('This analysis expired. Start a new analysis.', 410);
        if (!session.analysis) throw new AppError('Finish the photo and soil analysis before creating a plan.');
        if (session.running) throw new AppError('This analysis is still finishing. Wait a moment before retrying.', 429);
        session.running = true; sessionInUse = session;
        const result = await generatePlan(session.analysis, body.readings, emit, { ...runOptions, cache: session.cache });
        emit({ type: 'result', ...result });
      }
      res.end();
    } catch (e) {
      if (res.destroyed) return;
      const message = e instanceof AppError ? e.message : 'Something went wrong. Please retry the analysis.';
      if (streaming) { emit({ type: 'error', stage: currentStage, status: e.status || 500, error: message }); res.end(); }
      else json(e.status || 500, { error: message });
    } finally {
      clearInterval(heartbeat);
      if (sessionInUse) { sessionInUse.running = false; sessionInUse.expires = Date.now() + TTL; }
      if (acquired) active--;
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  const port = Number(process.env.PORT || 3001);
  const bind = process.env.HOST || '127.0.0.1';
  const config = aiConfig();
  const { liveEnabled } = serverConfig();
  const server = createServer();
  const shown = ['0.0.0.0', '::'].includes(bind) ? '127.0.0.1' : bind;
  server.listen(port, bind, () => console.log(`AgriLens AI is running at http://${shown}:${port}${shown !== bind ? ` (listening on ${bind})` : ''}\nLive AI: ${!liveEnabled ? 'disabled by LIVE_ANALYSIS; sample mode only' : `${config.label} (${config.model}) — ${config.key ? 'key configured; API access is checked on analysis' : `add ${config.keyEnv} to .env; sample mode is ready`}`}`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT in .env to another port.` : 'Could not start the local server.'); process.exitCode = 1; });
  // Container platforms send SIGTERM on redeploy; finish open responses, then exit.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
