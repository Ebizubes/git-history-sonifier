// GitHub fetch + parse.
// Owner: Person A (/data + /audio).
// Produces the SHARED DATA CONTRACT documented in mockCommits.js:
//   { sha, timestamp, author, additions, deletions, message }[]
//
// ADDITIVE FIELDS (contract-safe — /audio and /visual can ignore these):
//   • each commit also carries `estimated: boolean` — true when its line counts
//     came from the estimateChurn() fallback instead of the real GitHub stats.
//   • the returned array carries `commits.meta = { estimated, total, rateLimited }`
//     — how many of `total` commits were estimated, and whether we hit a 403.
// Nothing in the required six-key shape changed, so existing consumers keep
// working untouched.
//
// WHY line counts need a second request: the list endpoint
// (/repos/{owner}/{repo}/commits) does NOT include additions/deletions. Those
// live only on the per-commit endpoint (/repos/{owner}/{repo}/commits/{sha})
// in its `stats` object. Real counts therefore cost 1 + N requests, and
// unauthenticated GitHub allows only 60/hr — so we cap N at MAX_COMMITS,
// fetch with a small concurrency pool, and cache every result by SHA.

const API = 'https://api.github.com';

/** Hard cap on commits sonified. A 30-60s piece doesn't need more notes, and
 *  it keeps the request budget at 1 + 25 = 26 of the 60/hr anonymous limit. */
export const MAX_COMMITS = 25;

/** Parallel detail requests in flight. Enough to be fast, gentle enough that
 *  GitHub doesn't see a 25-request burst. */
const CONCURRENCY = 5;

/** localStorage key prefix for cached per-commit stats. */
const CACHE_PREFIX = 'ghs:stats:';

/** Module-level cache: full SHA -> { additions, deletions }.
 *  Survives re-runs within a session; localStorage survives reloads. */
const statsCache = new Map();

/**
 * Accepts either "owner/repo" or a full GitHub URL and returns { owner, repo }.
 */
export function parseRepoInput(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Full URL form: https://github.com/owner/repo(.git)(/...)
  const urlMatch = trimmed.match(
    /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // Shorthand "owner/repo"
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

/**
 * FALLBACK ONLY. Used when a commit's real stats can't be fetched (network
 * error, 403 rate limit, or a response with no `stats` object). Any commit
 * scored this way is flagged `estimated: true` so the UI can say so out loud —
 * we never present a guess as a real measurement.
 */
function estimateChurn(message, index) {
  const msg = (message || '').toLowerCase();
  let base = 40 + ((index * 37) % 80); // pseudo-varied baseline
  if (/init|scaffold|add|feat|feature|implement/.test(msg)) base += 120;
  if (/refactor|rewrite|migrat/.test(msg)) base += 60;
  if (/fix|typo|bug|patch/.test(msg)) base = Math.max(6, base - 60);
  if (/revert|remove|delete|drop/.test(msg)) {
    return { additions: 5, deletions: base };
  }
  return { additions: base, deletions: Math.round(base * 0.15) };
}

/** Request headers; adds a bearer token when one is supplied (60/hr -> 5000/hr). */
function ghHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Read cached stats for a full SHA: memory first, then localStorage.
 * Every localStorage touch is guarded — it throws in private mode, in SSR,
 * and in plain Node (where the global doesn't exist at all).
 */
function readCachedStats(sha) {
  if (statsCache.has(sha)) return statsCache.get(sha);
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + sha);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.additions === 'number' &&
        typeof parsed.deletions === 'number'
      ) {
        statsCache.set(sha, parsed); // promote into memory for next time
        return parsed;
      }
    }
  } catch {
    /* no localStorage, quota, or bad JSON — fall through to a network fetch */
  }
  return null;
}

/** Write stats for a full SHA into both caches. */
function writeCachedStats(sha, stats) {
  statsCache.set(sha, stats);
  try {
    localStorage.setItem(CACHE_PREFIX + sha, JSON.stringify(stats));
  } catch {
    /* quota exceeded or no localStorage — the in-memory Map still holds it */
  }
}

/**
 * Run `worker` over `items` with at most `limit` promises in flight.
 * Results keep input order. A pool of long-lived runners pulling from a shared
 * cursor, rather than fixed batches, so one slow request can't stall the rest.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }

  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, runner));
  return results;
}

/**
 * Fetch commits for a public repo and parse into the shared shape, using REAL
 * per-commit line counts by default.
 *
 * Request budget: 1 (list) + up to MAX_COMMITS (details, minus cache hits).
 *
 * @param {string} input  "owner/repo" or a github.com URL
 * @param {object} opts   { token?: string }  token bumps the limit to 5000/hr
 * @returns {Promise<Array>} parsed commits, oldest-first, each with `estimated`,
 *                           and `.meta = { estimated, total, rateLimited }`
 */
export async function fetchCommits(input, opts = {}) {
  const { token } = opts;
  const parsed = parseRepoInput(input);
  if (!parsed) {
    throw new Error(`Could not parse repo from "${input}". Use owner/repo.`);
  }
  const { owner, repo } = parsed;

  // --- 1 request: the commit list (no line counts here) ---------------------
  const url = `${API}/repos/${owner}/${repo}/commits?per_page=${MAX_COMMITS}`;
  const res = await fetch(url, { headers: ghHeaders(token) });

  if (res.status === 404) {
    throw new Error(`Repo "${owner}/${repo}" not found (is it public?).`);
  }
  if (res.status === 403) {
    throw new Error('GitHub rate limit hit. Wait a bit and try again.');
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('No commits found for this repo.');
  }

  // API returns newest-first. Take the most recent MAX_COMMITS, then reverse
  // to chronological order so the piece plays forward through history.
  const chronological = raw.slice(0, MAX_COMMITS).reverse();

  // Parse everything except line counts first — these need no network.
  const base = chronological.map((c, i) => ({
    fullSha: c.sha,
    index: i,
    sha: c.sha.slice(0, 7),
    timestamp: new Date(
      c.commit?.author?.date || c.commit?.committer?.date || Date.now()
    ).getTime(),
    author: c.author?.login || c.commit?.author?.name || 'unknown',
    message: (c.commit?.message || '').split('\n')[0],
  }));

  // --- N requests: per-commit stats, capped at CONCURRENCY in flight --------
  // Once GitHub says 403 we stop asking. Burning the rest of the budget on
  // requests we know will fail helps nobody and delays recovery.
  let rateLimited = false;

  const stats = await mapWithConcurrency(base, CONCURRENCY, async (c) => {
    const cached = readCachedStats(c.fullSha);
    if (cached) return { ...cached, estimated: false };

    if (rateLimited) {
      return { ...estimateChurn(c.message, c.index), estimated: true };
    }

    try {
      const detail = await fetch(`${API}/repos/${owner}/${repo}/commits/${c.fullSha}`, {
        headers: ghHeaders(token),
      });

      if (detail.status === 403) {
        rateLimited = true;
        return { ...estimateChurn(c.message, c.index), estimated: true };
      }
      if (!detail.ok) throw new Error(`detail ${detail.status}`);

      const body = await detail.json();
      const additions = body.stats?.additions;
      const deletions = body.stats?.deletions;

      // GitHub omits `stats` on some very large commits — treat as a miss.
      if (typeof additions !== 'number' || typeof deletions !== 'number') {
        throw new Error('no stats in response');
      }

      writeCachedStats(c.fullSha, { additions, deletions });
      return { additions, deletions, estimated: false };
    } catch {
      return { ...estimateChurn(c.message, c.index), estimated: true };
    }
  });

  const commits = base.map((c, i) => ({
    sha: c.sha,
    timestamp: c.timestamp,
    author: c.author,
    additions: stats[i].additions,
    deletions: stats[i].deletions,
    message: c.message,
    estimated: stats[i].estimated,
  }));

  commits.meta = {
    estimated: commits.filter((c) => c.estimated).length,
    total: commits.length,
    rateLimited,
  };

  return commits;
}

export default fetchCommits;
