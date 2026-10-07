// Cache only successful object-existence checks, never authorization or signed playback URLs.
// Short TTL bounds stale results after a file is removed; failures are always retried.
export function mediaHeadCache(head, { ttl = 30_000, max = 256, now = Date.now } = {}) {
  const entries = new Map();
  return (key) => {
    const cached = entries.get(key);
    if (cached && cached.until > now()) return cached.promise;
    if (cached) entries.delete(key);
    if (entries.size >= max) entries.delete(entries.keys().next().value);
    const entry = { until: now() + ttl, promise: null };
    entry.promise = Promise.resolve().then(() => head(key)).then((result) => {
      if (result.status === 200) entry.until = now() + ttl;
      else if (entries.get(key) === entry) entries.delete(key);
      return result;
    }, (error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.promise;
  };
}
