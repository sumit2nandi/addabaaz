// Shared by the website and both native bundles. Never contains credentials.
export function apiOrigin(baseUrl = '') {
  if (!baseUrl) return location.origin;
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('API_BASE_URL must be an HTTP(S) origin without a path or credentials.');
  return url.origin;
}
export async function loadContent({ baseUrl = '', view = 'web', signal, timeoutMs = 15000 } = {}) {
  const origin = apiOrigin(baseUrl);
  const controller = new AbortController();
  let abortReason;
  const abort = () => { abortReason = signal.reason || new Error('Content loading was cancelled.'); controller.abort(abortReason); };
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    abortReason = new Error('The content service took too long to respond.');
    controller.abort(abortReason);
  }, timeoutMs);
  try {
    const response = await fetch(`${origin}/api/v1/content?view=${view}`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Content service unavailable (HTTP ${response.status}). Check your connection and try again.`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || (view === 'home' ? !data.runtime || !data.copy : !data.tables)) throw new Error('The content service returned an unsupported response.');
    // API-owned paths resolve against the API origin, never the native app's
    // capacitor:// origin or a developer's localhost in the user's browser.
    const media = value => typeof value === 'string' && value.startsWith('/media/') ? new URL(value, origin).href : value;
    if (data.tables) {
      for (const rows of Object.values(data.tables)) for (const row of rows) for (const key of ['image', 'thumbnail', 'value']) if (key in row) row[key] = media(row[key]);
    } else {
      for (const show of Object.values(data.runtime.projectDetails)) {
        show.image = media(show.image);
        for (const episode of show.episodes) episode.thumbnail = media(episode.thumbnail);
      }
      for (const row of data.runtime.promoVideos) row.thumbnail = media(row.thumbnail);
      for (const key of ['UPCOMING_FOLDER', 'BTS_FOLDER']) data.runtime[key] = media(data.runtime[key]);
      for (const key of Object.keys(data.copy)) data.copy[key] = media(data.copy[key]);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || abortReason || error;
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
