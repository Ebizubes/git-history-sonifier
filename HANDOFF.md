# Handoff — Git History Sonifier (for Partner B)

Welcome! The project is scaffolded, working end-to-end, and pushed to GitHub.
This doc gets you productive in ~5 minutes. For the full design, mapping table,
and data contracts, see [PROJECT_MASTER.md](PROJECT_MASTER.md).

---

## 1. Get it running

```bash
git clone https://github.com/Ebizubes/git-history-sonifier.git
cd git-history-sonifier
npm install
npm run dev
```

Open the printed local URL. Click **Load mock data → Play** to hear/see it with
no network, or type a repo (e.g. `facebook/react`) and click **Fetch**.

> Node 18+ recommended (built/tested on Node 25). If port 5173 is taken, Vite
> picks another automatically, or run `npm run dev -- --port 5200`.

---

## 2. Who owns what

| Person | Owns | Branch |
| ------ | ---- | ------ |
| **A** (done) | `src/data/*`, `src/audio/*` | `person-a/data-audio` |
| **B** (you)  | `src/visual/*`, `src/ui/*`  | `person-b/visual-ui` |

Start on your branch:

```bash
git checkout person-b/visual-ui
```

Both branches currently point at the same working `main`. Do your work here,
push, and open a PR into `main` when your slice is ready.

**Your files:**
- [`src/visual/timeline.js`](src/visual/timeline.js) — the canvas renderer
  (nodes, playhead, pulses, crossing detection).
- [`src/ui/App.jsx`](src/ui/App.jsx) — repo input, transport controls, and the
  wiring that connects data → audio → visual.
- [`src/ui/styles.css`](src/ui/styles.css) — all styling.

---

## 3. The one thing we must not break: the shared contracts

You and Partner A only talk through **two data shapes**. Change either one and
you must tell the other person. Both are documented at the top of the source
files that produce them.

**Contract 1 — parsed commit** (A's `data/` produces, A's `audio/` consumes):

```js
{ sha: string, timestamp: number /*unix ms*/, author: string,
  additions: number, deletions: number, message: string }
```

**Contract 2 — playback schedule** (A's `audio/` produces, YOUR `visual/` +
`ui/` consume). It's an array of entries, plus `.totalDuration` (seconds) and
`.voices` (Map):

```js
{ index, time /*sec from start*/, note /*"C4"*/, duration /*"8n"*/,
  velocity /*0..1*/, author, instrument, additions, deletions, message, sha,
  cue /*"fix" | "revert" | null*/ }
```

Your renderer reads `entry.time`, `entry.author`, `entry.additions/deletions`
(node size), and `entry.cue` (marker dots). That's the whole surface.

---

## 4. How your two files plug in (already wired for you)

`App.jsx` sets this up on mount — you can extend it, just keep the shape:

```js
const renderer = new TimelineRenderer(canvasEl);
renderer.setSchedule(schedule);        // from buildSchedule(commits)
renderer.bindPlayhead(() => player.seconds);  // reads the Tone Transport clock
renderer.onCross = (entry) => setNowPlaying(entry); // fires as each note is reached
renderer.onEnd  = () => { /* reset UI */ };
renderer.start();  // begins the requestAnimationFrame loop
```

### Important gotcha (already solved — don't reintroduce it)

We do **not** use `Tone.Draw` to sync visuals. Its callbacks weren't firing in
this setup, so the "now playing" label and pulses stayed dead. Instead, the
renderer's animation-frame loop reads the same Transport clock (`player.seconds`)
and detects note crossings itself (see `_loop()` in `timeline.js`). This keeps
visuals frame-tight with audio. If you add visual events, hang them off that
crossing loop, not off `Tone.Draw`.

---

## 5. Good first tasks for you (pick any)

These are the remaining/polish items — none block Partner A:

- [ ] **Crowding at scale.** 60 commits pack tightly on the timeline. Consider
      wrapping to multiple rows, horizontal scroll, or a zoom/scrub control.
- [ ] **Hover/scrub interaction.** Let the user hover a node to see its commit,
      or click-to-seek the playhead.
- [ ] **Legend overflow.** With many authors the legend gets long — collapse to
      "top N + others" or make it scrollable.
- [ ] **Mobile/responsive.** Canvas height + control layout on small screens.
- [ ] **Empty/error states.** Nicer visuals when a repo has 1 commit, or the
      fetch fails.
- [ ] **Demo recording.** Last checklist item in PROJECT_MASTER — capture a clip.

Update the **Status** checklist in `PROJECT_MASTER.md` as you go so we both see
progress at a glance.

---

## 6. Handy commands

```bash
npm run dev       # dev server with hot reload
npm run build     # production build (must stay green before merging)
npm run preview   # serve the production build locally
```

To test your half in isolation without hitting GitHub, always use the
**Load mock data** button — it feeds `src/data/mockCommits.js` (8 fake commits
covering big commits, tiny fixes, long gaps, and fix/revert cues) through the
exact same pipeline as real data.

---

## 7. Merging when ready

```bash
git checkout person-b/visual-ui
git add -A && git commit -m "..."
git push -u origin person-b/visual-ui
# then open a PR into main on GitHub
```

Keep `npm run build` green and don't change the two contracts in §3 without a
heads-up. That's it — have fun. 🎛️
