// GitHub fetch + parse.
// Owner: Person A (/data + /audio).
// Produces the SHARED DATA CONTRACT documented in mockCommits.js:
//   { sha, timestamp, author, additions, deletions, message }[]

const API = 'https://api.github.com';

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
 * The list endpoint does NOT include per-commit additions/deletions.
 * We estimate size from the message + position so the sonifier still has a
 * meaningful signal without N extra requests. If you want exact line counts,
 * fetch each commit detail (rate-limit heavy) — left as an option below.
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

/**
 * Fetch commits for a public repo and parse into the shared shape.
 * @param {string} input  "owner/repo" or a github.com URL
 * @param {object} opts   { perPage=60, exact=false }
 * @returns {Promise<Array>} parsed commits, oldest-first
 */
export async function fetchCommits(input, opts = {}) {
  const { perPage = 60, exact = false } = opts;
  const parsed = parseRepoInput(input);
  if (!parsed) {
    throw new Error(`Could not parse repo from "${input}". Use owner/repo.`);
  }
  const { owner, repo } = parsed;

  const url = `${API}/repos/${owner}/${repo}/commits?per_page=${perPage}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });

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

  // API returns newest-first; reverse to chronological order.
  const chronological = [...raw].reverse();

  const commits = await Promise.all(
    chronological.map(async (c, i) => {
      const author =
        c.author?.login ||
        c.commit?.author?.name ||
        'unknown';
      const message = (c.commit?.message || '').split('\n')[0];
      const timestamp = new Date(
        c.commit?.author?.date || c.commit?.committer?.date || Date.now()
      ).getTime();

      let additions;
      let deletions;
      if (exact) {
        try {
          const detail = await fetch(`${API}/repos/${owner}/${repo}/commits/${c.sha}`, {
            headers: { Accept: 'application/vnd.github+json' },
          }).then((r) => r.json());
          additions = detail.stats?.additions ?? 0;
          deletions = detail.stats?.deletions ?? 0;
        } catch {
          ({ additions, deletions } = estimateChurn(message, i));
        }
      } else {
        ({ additions, deletions } = estimateChurn(message, i));
      }

      return {
        sha: c.sha.slice(0, 7),
        timestamp,
        author,
        additions,
        deletions,
        message,
      };
    })
  );

  return commits;
}

export default fetchCommits;
