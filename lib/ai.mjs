import { AppError } from './errors.mjs';
import { validate } from './schemas.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export function aiConfig(options = {}, env = process.env) {
  const provider = (options.provider ?? env.AI_PROVIDER ?? 'openai').trim().toLowerCase();
  if (!['gemini', 'openai'].includes(provider)) throw new AppError('Set AI_PROVIDER to gemini or openai in .env.', 503);
  const gemini = provider === 'gemini';
  const keyEnv = gemini ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
  const key = (options.key ?? env[keyEnv] ?? '').trim();
  const model = (options.model ?? env[gemini ? 'GEMINI_MODEL' : 'OPENAI_MODEL'] ?? (gemini ? 'gemini-3.8-flash' : 'gpt-5.4-mini')).trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new AppError('Use a valid model ID in .env, without a URL or models/ prefix.', 503);
  const label = gemini ? 'Google Gemini' : 'OpenAI';
  return { provider, label, keyEnv, key, model };
}

export function requireKey(options = {}) {
  const config = aiConfig(options);
  if (!config.key) throw new AppError(`Add ${config.keyEnv} to your local .env file and restart for live analysis, or try the sample walkthrough.`, 503);
  return config;
}

function geminiPart(part) {
  if (part.type === 'input_text') return { text: part.text };
  const data = part.type === 'input_image' ? part.image_url : part.file_data;
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data || '');
  if (!match) throw new AppError('The image or report could not be prepared for Gemini. Choose the file again.');
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

async function apiError(response, config) {
  // Do not expose raw upstream error messages, which can contain request data.
  const error = await response.json().catch(() => ({}));
  const reasons = (error.error?.details || []).map(d => d.reason);
  if (response.status === 401 || reasons.includes('API_KEY_INVALID') || reasons.includes('API_KEY_EXPIRED')) {
    return new AppError(`The API key was rejected. Check ${config.keyEnv} in .env and restart the server.`, 502);
  }
  if (response.status === 403) return new AppError(`${config.label} denied access. Check the key's project permissions, API restrictions and model availability.`, 502);
  if (response.status === 429) {
    const failure = new AppError(config.provider === 'gemini'
      ? 'Gemini reached a rate limit or quota. Check your project limits in Google AI Studio and retry when quota is available. No other provider was used.'
      : 'The AI service hit a usage or rate limit. Check your API billing and try again later.', 502);
    const details = error.error?.details || [];
    const retry = details.find(d => d['@type']?.endsWith('/google.rpc.RetryInfo'))?.retryDelay;
    const seconds = typeof retry === 'string' && /^\d+(\.\d+)?s$/.test(retry) ? Number(retry.slice(0, -1)) : Number(response.headers.get('retry-after'));
    const quota = details.flatMap(d => d.violations || []);
    const dailyOrZero = quota.some(v => /per.?day|daily/i.test(v.quotaId || '')) || /limit:\s*0(?:\D|$)/i.test(error.error?.message || '');
    // Retry only a bounded delay explicitly supplied by the provider. Never
    // guess a reset time for a daily quota, zero allowance or unknown 429.
    if (!dailyOrZero && seconds > 0 && seconds <= 30) {
      failure.retryable = true;
      failure.waitMs = Math.ceil(seconds * 1000) + 500;
    }
    return failure;
  }
  if (response.status === 404) return new AppError(`${config.label} could not find the configured model. Check ${config.provider === 'gemini' ? 'GEMINI_MODEL' : 'OPENAI_MODEL'} and your account access.`, 502);
  if (response.status === 400 && config.provider === 'gemini' && /generation[_]?config|generationConfig/i.test(error.error?.message || '')) {
    return new AppError('Gemini rejected the app\'s generation settings. Restart the server after updating the app. If this persists, run npm run check:ai in your terminal for a connection diagnostic.', 502);
  }
  if (response.status === 400) return new AppError(`${config.label} rejected the request. Check your API key, model access, and use a clear image or short PDF.`, 502);
  if (response.status === 503 && config.provider === 'gemini') return new AppError('Gemini is temporarily unavailable or busy with high demand (503). Wait a little, then retry. Your API key does not need changing for this error.', 502);
  return new AppError(`${config.label} is temporarily unavailable. Please try again.`, 502);
}

export async function requestModel(name, schema, instructions, content, options = {}) {
  const config = requireKey(options);
  const gemini = config.provider === 'gemini';
  const url = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent` : 'https://api.openai.com/v1/responses';
  const payload = gemini ? {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: [{ role: 'user', parts: content.map(geminiPart) }],
    // Use the established REST JSON-schema fields. responseFormat.text.mimeType
    // expects an enum, not the MIME string accepted by responseMimeType.
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 8192 }
  } : {
    model: config.model, store: false, instructions, input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name, strict: true, schema } }, max_output_tokens: 4000
  };
  let body;
  const retries = Math.min(2, Math.max(0, options.maxRetries ?? 2));
  for (let attempt = 0; attempt <= retries; attempt++) {
    let failure;
    try {
      if (options.signal?.aborted) throw new AppError('Analysis cancelled.', 499);
      const response = await (options.fetchImpl || fetch)(url, {
      method: 'POST', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': config.key } : { Authorization: `Bearer ${config.key}` }) },
      body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const error = await apiError(response, config);
        error.retryable = error.retryable === true || [500, 502, 503, 504].includes(response.status);
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.waitMs = Math.max(error.waitMs || 0, retryAfter * 1000);
        throw error;
      }
      body = await response.json();
      break;
    } catch (e) {
      if (options.signal?.aborted || e.status === 499) throw new AppError('Analysis cancelled.', 499);
      if (e instanceof SyntaxError) throw new AppError('The AI service returned an invalid response. Please retry.', 502);
      failure = e instanceof AppError ? e : Object.assign(new AppError('The AI service could not be reached or timed out. Check your connection and try again.', 502), { retryable: true });
      // Invalid keys/inputs, refusals and long/unknown quota waits are final.
      if (!failure.retryable || attempt === retries || failure.waitMs > 30500) throw failure;
    }
    const waitMs = Math.max(failure.waitMs || 0, [2000, 5000][attempt]);
    options.onRetry?.({ attempt: attempt + 2, maxAttempts: retries + 1, waitMs });
    try { await (options.sleep || ((ms, signal) => delay(ms, undefined, { signal })))(waitMs, options.signal); }
    catch { throw new AppError('Analysis cancelled.', 499); }
  }
  let output;
  if (gemini) {
    const candidate = body.candidates?.[0];
    if (body.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) throw new AppError('Gemini could not analyze this input. Try a clearer crop photo or report.', 422);
    if (candidate?.finishReason === 'MAX_TOKENS') throw new AppError('The model did not finish its response. Try again with a shorter report.', 502);
    if (!candidate || candidate.finishReason !== 'STOP') throw new AppError('Gemini returned no completed result. Please retry.', 502);
    output = (candidate.content?.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
  } else {
    if (body.status && body.status !== 'completed') throw new AppError('The model did not finish its response. Try again with a shorter report.', 502);
    const parts = (body.output || []).flatMap(x => x.content || []);
    if (parts.some(x => x.type === 'refusal')) throw new AppError('The model could not analyze this input. Try a clearer crop photo or report.', 422);
    output = parts.filter(x => x.type === 'output_text').map(x => x.text).join('');
  }
  try { return validate(schema, JSON.parse(output)); }
  catch { throw new AppError('The model returned an incomplete or invalid result. Please retry.', 502); }
}
