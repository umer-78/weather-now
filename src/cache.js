/**
 * Recent answers from the weather services, kept in localStorage.
 *
 * A reload, or a second visit within minutes, reuses the forecast instead of
 * asking for it again. When the service is busy or out of reach, the last good
 * answer stays on screen: the forecast says which time it is from, so an older
 * one is never passed off as current.
 */
export const FRESH_FOR = 10 * 60 * 1000;
export const KEEP_FOR = 6 * 60 * 60 * 1000;
const KEY = 'weather:answers:v1';
const LIMIT = 6;

const isEntry = (e) => e && typeof e === 'object' && typeof e.at === 'number' && 'body' in e;

export function createCache(storage, now = Date.now) {
  const read = () => {
    try {
      const all = JSON.parse(storage?.getItem(KEY) || '{}');
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
      return {};
    }
  };
  const write = (all) => {
    let entries = Object.entries(all)
      .filter(([, e]) => isEntry(e) && now() - e.at < KEEP_FOR)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, LIMIT);
    // Storage full: drop the oldest answer and try again, down to none.
    while (entries.length) {
      try {
        storage?.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
        return;
      } catch {
        entries = entries.slice(0, -1);
      }
    }
    try { storage?.removeItem(KEY); } catch { /* private mode */ }
  };

  return {
    /** { body, at, fresh } for an answer younger than KEEP_FOR, else null. */
    get(url) {
      const e = read()[url];
      if (!isEntry(e)) return null;
      const age = now() - e.at;
      if (age < 0 || age >= KEEP_FOR) return null;
      return { body: e.body, at: e.at, fresh: age < FRESH_FOR };
    },
    put(url, body) {
      const all = read();
      all[url] = { at: now(), body };
      write(all);
    },
  };
}

/**
 * How long to wait before asking again after a 429 or 503: the service's
 * Retry-After when it is readable (seconds or a date), otherwise a short
 * backoff. Null when the wait would be longer than `cap`: better to show the
 * saved answer, or a clear message, than to keep the page waiting.
 */
export function retryDelay(retryAfter, attempt, { cap = 4000, now = Date.now() } = {}) {
  let ms = 600 * 2 ** attempt;
  if (retryAfter != null && String(retryAfter).trim() !== '') {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) ms = Math.max(0, secs * 1000);
    else if (Number.isFinite(Date.parse(retryAfter))) ms = Math.max(0, Date.parse(retryAfter) - now);
  }
  return ms > cap ? null : ms;
}
