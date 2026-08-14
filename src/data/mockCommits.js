// Shared mock dataset — 8 fake commits.
// This is the SHARED DATA CONTRACT. Every parsed commit is:
//   {
//     sha:        string   (short id, for keys/labels)
//     timestamp:  number   (unix ms)
//     author:     string   (contributor name)
//     additions:  number   (lines added)
//     deletions:  number   (lines removed)
//     message:    string   (commit subject line)
//   }
// /data/github.js MUST produce this exact shape.
// /audio and /visual + /ui consume ONLY this shape. Do not change it
// without telling the other person.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Anchor to a fixed base so the mock timeline is deterministic.
const base = Date.UTC(2026, 0, 1, 9, 0, 0); // 2026-01-01 09:00 UTC

export const mockCommits = [
  {
    sha: 'a1b2c3d',
    timestamp: base,
    author: 'Ada',
    additions: 120,
    deletions: 4,
    message: 'Initial project scaffold',
  },
  {
    sha: 'b2c3d4e',
    timestamp: base + 20 * 60 * 1000, // +20 min — rapid follow-up
    author: 'Ada',
    additions: 8,
    deletions: 2,
    message: 'fix typo in readme',
  },
  {
    sha: 'c3d4e5f',
    timestamp: base + 2 * HOUR,
    author: 'Grace',
    additions: 240,
    deletions: 15,
    message: 'Add audio engine and Tone.js setup',
  },
  {
    sha: 'd4e5f6a',
    timestamp: base + 2 * HOUR + 35 * 60 * 1000,
    author: 'Grace',
    additions: 60,
    deletions: 90,
    message: 'Refactor mapping function',
  },
  {
    sha: 'e5f6a7b',
    timestamp: base + 1 * DAY, // long gap — a pause in the music
    author: 'Linus',
    additions: 30,
    deletions: 5,
    message: 'Wire up canvas timeline',
  },
  {
    sha: 'f6a7b8c',
    timestamp: base + 1 * DAY + 10 * 60 * 1000,
    author: 'Linus',
    additions: 5,
    deletions: 120,
    message: 'revert broken animation loop',
  },
  {
    sha: 'a7b8c9d',
    timestamp: base + 1 * DAY + 3 * HOUR,
    author: 'Ada',
    additions: 400,
    deletions: 20,
    message: 'Big feature: real GitHub fetch + polish',
  },
  {
    sha: 'b8c9d0e',
    timestamp: base + 2 * DAY,
    author: 'Grace',
    additions: 12,
    deletions: 3,
    message: 'fix edge case in tempo mapping',
  },
];

export default mockCommits;
