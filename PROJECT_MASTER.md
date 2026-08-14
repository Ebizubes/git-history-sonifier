# Git History Sonifier — PROJECT_MASTER.md

> Single source of truth for the project. Keep this current as you build.

## Overview

Git History Sonifier turns a public GitHub repo's commit history into a short
piece of generative music (30–60s) with a visual timeline that animates in
sync. Each commit becomes a musical note and a visual pulse: the size of the
commit sets the pitch and loudness, the time between commits sets the rhythm,
and each contributor gets their own instrument. Paste a repo, press play, and
you hear the shape of the project's history — bursts of rapid work, quiet
gaps, big feature drops, and little fix/revert cues.

## Tech stack (and why)

| Piece            | Why |
| ---------------- | --- |
| **React + Vite** | Fast dev server, simple component model for the small UI (input + controls + canvas). Vite gives instant HMR. |
| **Tone.js**      | Wraps the Web Audio API. We use `PolySynth` (one voice per author), `MetalSynth`/`NoiseSynth` for cues, and the `Transport` for sample-accurate scheduling. `Tone.Draw` keeps visuals frame-synced to audio. |
| **Canvas API**   | The timeline is custom (nodes + playhead + pulses); a charting lib would be overkill and less controllable. Raw canvas is lightweight and animates smoothly via `requestAnimationFrame`. |
| **GitHub REST API** | `/repos/{owner}/{repo}/commits` needs no auth for public repos at demo volumes. No SDK required — plain `fetch`. |

## File / folder structure

```
/src
  /data
    mockCommits.js   Shared 8-commit mock dataset (defines the commit contract)
    github.js        Fetch + parse real commits into the same shape
  /audio
    sonifier.js      Tone.js setup, data→music mapping, playback scheduling,
                     and the "playback schedule" contract
  /visual
    timeline.js      Canvas rendering + animation, synced to the schedule
  /ui
    App.jsx          Repo input, play/pause/stop, wires data→audio→visual
    styles.css       App styling
  main.jsx           React entry point
index.html
vite.config.js
PROJECT_MASTER.md
```

## Data flow

```
repo URL
   │  parseRepoInput / fetchCommits  (src/data/github.js)
   ▼
parsed commits  ──────────  the FIRST shared contract
   │  buildSchedule         (src/audio/sonifier.js)
   ▼
playback schedule  ───────  the SECOND shared contract
   │
   ├─► SonifierPlayer.start()   → Tone.Transport plays notes
   │         │ onEvent (via Tone.Draw)
   │         ▼
   └─► TimelineRenderer         → canvas pulses + playhead, in sync
```

## Shared data contracts (DO NOT change without telling the other person)

**1. Parsed commit** (produced by `/data`, consumed by `/audio`):

```js
{ sha: string, timestamp: number /*unix ms*/, author: string,
  additions: number, deletions: number, message: string }
```

*Additive fields (contract-safe — consumers may ignore them):* `github.js`
also attaches `estimated: boolean` to each commit — `true` when its line counts
came from the `estimateChurn()` fallback instead of GitHub's real per-commit
`stats`. The returned array additionally carries
`commits.meta = { estimated: number, total: number, rateLimited: boolean }`
so the UI can honestly flag how many counts are estimates. Real counts are the
default: `fetchCommits` fetches up to `MAX_COMMITS` (25) per-commit details with
a concurrency of 5, caches each `{additions, deletions}` by SHA (in-memory +
`localStorage` key `ghs:stats:<sha>`), and only estimates a commit when its
detail request fails or is rate-limited (HTTP 403). Pass `{ token }` to send
`Authorization: Bearer <token>` and lift the anonymous 60/hr limit to 5000/hr.

**2. Playback schedule** (produced by `/audio`, consumed by `/visual` + `/ui`).
An array of entries plus `.totalDuration` (seconds) and `.voices` (Map):

```js
{ index, time /*sec*/, note /*"C4"*/, duration /*"8n"*/, velocity /*0..1*/,
  author, instrument, additions, deletions, message, sha, cue /*"fix"|"revert"|null*/ }
```

## Mapping table

| Commit data                       | Musical / visual parameter |
| --------------------------------- | -------------------------- |
| additions + deletions (churn)     | **Pitch** (log-scaled; bigger = higher) and **node radius** |
| additions + deletions (churn)     | **Velocity/volume** (bigger = louder) and **note duration** (tiny fix = 16n blip, big commit = 2n) |
| time gap since previous commit    | **Rhythm** — log-compressed into note spacing; long gaps = pauses, rapid commits = fast runs |
| author                            | **Instrument/timbre** (a distinct synth voice per contributor) and **node color** |
| message keywords `fix` / `revert` | **Sound cue** — noise blip (fix) / metallic hit (revert), plus a marker dot on the node |

*Register-by-filetype is a documented stretch; churn→register currently covers pitch.*

## Task ownership

| Person   | Owns                         | Must not break |
| -------- | ---------------------------- | -------------- |
| **A**    | `/src/data/*`, `/src/audio/*` | the two shared contracts above |
| **B**    | `/src/visual/*`, `/src/ui/*`  | the two shared contracts above |

Both build against `mockCommits.js` first, on branches `person-a/data-audio`
and `person-b/visual-ui`, then merge to `main` once each slice works.

## Status

- [x] Project scaffolded
- [x] Mock data working
- [x] Audio mapping working (against mock data)
- [x] Visual timeline working (against mock data)
- [x] GitHub fetch working
- [x] Real data wired in
- [ ] Polish pass done
- [ ] Demo recorded

## How to run this

```bash
npm install
npm run dev
```

Then open the printed local URL. Click **Load mock data** → **Play** to try it
with no network, or type a repo like `facebook/react` and click **Fetch**.

> Note: the GitHub list endpoint doesn't return per-commit line counts, so
> `github.js` fetches each commit's detail for **real** additions/deletions by
> default (1 + up to 25 requests, concurrency-limited and cached by SHA). If a
> detail request is rate-limited (403) or fails, that commit falls back to an
> estimate and is flagged `estimated: true`; the UI shows a badge when any are.
> Pass `{ token }` to `fetchCommits` to raise the 60/hr anonymous limit to
> 5000/hr.
