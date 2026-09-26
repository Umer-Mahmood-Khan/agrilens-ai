const MAX_KEYS = 10000;

// Sliding-window counter held in memory. A limit of 0 means unlimited.
export function createLimiter(limit, windowMs, now = Date.now) {
  const hits = new Map();
  const recent = key => (hits.get(key) || []).filter(t => t > now() - windowMs);
  return {
    // Milliseconds until another request is allowed, or 0 when one is allowed now.
    wait(key) {
      if (!limit) return 0;
      const list = recent(key);
      return list.length >= limit ? list[0] + windowMs - now() : 0;
    },
    record(key) {
      if (!limit) return;
      const list = recent(key);
      list.push(now());
      hits.delete(key); hits.set(key, list);
      if (hits.size > MAX_KEYS) {
        for (const [k] of hits) { if (!recent(k).length) hits.delete(k); }
        // Still full: drop the least recently used keys.
        for (const [k] of hits) { if (hits.size <= MAX_KEYS) break; hits.delete(k); }
      }
    }
  };
}

// With trustProxy = N, the client address is the Nth X-Forwarded-For entry from
// the right: each trusted proxy appends one entry, and earlier entries can be forged.
export function clientIp(req, trustProxy = 0) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  if (trustProxy > 0 && forwarded.length) return forwarded[Math.max(0, forwarded.length - trustProxy)];
  return req.socket.remoteAddress || 'unknown';
}

export function minutes(ms) {
  const m = Math.ceil(ms / 60000);
  return m <= 1 ? 'about a minute' : m < 90 ? `${m} minutes` : `${Math.ceil(m / 60)} hours`;
}
