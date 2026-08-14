// Audio engine + the data-to-music mapping.
// Owner: Person A (/data + /audio).
//
// PRODUCES the second SHARED CONTRACT: the "playback schedule" — an array
// of events that BOTH /audio (to play) and /visual + /ui (to animate/label)
// consume. A schedule entry is:
//   {
//     index:      number   position in the history
//     time:       number   seconds from playback start when it fires
//     note:       string   e.g. "C4" (the pitch played)
//     duration:   string   Tone.js note length, e.g. "8n"
//     velocity:   number   0..1 loudness
//     author:     string
//     instrument: string   which synth voice
//     additions:  number
//     deletions:  number
//     message:    string
//     sha:        string
//     cue:        string|null  "fix" | "revert" | null (stretch sound cue)
//   }
// Plus the schedule carries a `.totalDuration` (seconds) property.

import * as Tone from 'tone';

// ---- Tunables ---------------------------------------------------------------
const TARGET_MIN = 30; // piece length floor (seconds)
const TARGET_MAX = 60; // piece length ceiling (seconds)
const MAX_GAP = 3.0; // longest silence we allow between notes (seconds)
const MIN_GAP = 0.12; // rapid-fire commits collapse to this spacing

// Pentatonic-ish scale (sounds pleasant regardless of order).
const SCALE = ['C', 'D', 'E', 'G', 'A'];
const OCTAVES = [2, 3, 4, 5];

// Instrument recipes keyed by voice name. Each author is assigned one.
const VOICES = ['triangle', 'sine', 'square', 'sawtooth', 'fmsine'];

// ---- Mapping ----------------------------------------------------------------

function churn(c) {
  return (c.additions || 0) + (c.deletions || 0);
}

/**
 * Map a churn value to a pitch. Bigger commits -> higher notes.
 * Uses log scaling so a 400-line commit isn't 50x higher than an 8-line one.
 */
function churnToNote(value, maxChurn) {
  const norm = Math.log10(1 + value) / Math.log10(1 + maxChurn || 1); // 0..1
  const steps = Math.round(norm * (SCALE.length * OCTAVES.length - 1));
  const octave = OCTAVES[Math.floor(steps / SCALE.length)] ?? OCTAVES[0];
  const degree = SCALE[steps % SCALE.length];
  return `${degree}${octave}`;
}

function churnToVelocity(value, maxChurn) {
  const norm = Math.log10(1 + value) / Math.log10(1 + maxChurn || 1);
  return 0.25 + norm * 0.65; // 0.25 .. 0.9
}

function churnToDuration(value, maxChurn) {
  const norm = value / (maxChurn || 1);
  if (norm < 0.08) return '16n'; // tiny fix = short blip
  if (norm < 0.3) return '8n';
  if (norm < 0.6) return '4n';
  return '2n'; // big commit = long note
}

function messageCue(message) {
  const m = (message || '').toLowerCase();
  if (/revert|rollback/.test(m)) return 'revert';
  if (/\bfix|bug|patch|hotfix/.test(m)) return 'fix';
  return null;
}

/**
 * Assign each distinct author a stable instrument voice.
 */
export function assignVoices(commits) {
  const map = new Map();
  let next = 0;
  for (const c of commits) {
    if (!map.has(c.author)) {
      map.set(c.author, VOICES[next % VOICES.length]);
      next += 1;
    }
  }
  return map;
}

/**
 * Turn parsed commits into a playback schedule.
 * Real inter-commit gaps are preserved proportionally, then the whole thing
 * is scaled to land inside [TARGET_MIN, TARGET_MAX] seconds.
 */
export function buildSchedule(commits) {
  if (!commits || commits.length === 0) {
    const empty = [];
    empty.totalDuration = 0;
    empty.voices = new Map();
    return empty;
  }

  const maxChurn = Math.max(...commits.map(churn), 1);
  const voices = assignVoices(commits);

  // 1. Compute raw gaps (seconds of real time), clamped so huge gaps don't
  //    create minutes of dead air but still read as "a pause".
  const rawGaps = [0];
  for (let i = 1; i < commits.length; i += 1) {
    const dtMs = commits[i].timestamp - commits[i - 1].timestamp;
    const dtSec = Math.max(0, dtMs) / 1000;
    // Log-compress real seconds into a musical gap.
    const gap = Math.min(MAX_GAP, MIN_GAP + Math.log10(1 + dtSec) * 0.35);
    rawGaps.push(gap);
  }

  // 2. Lay out cumulative times.
  let times = [];
  let acc = 0;
  for (let i = 0; i < commits.length; i += 1) {
    acc += rawGaps[i];
    times.push(acc);
  }

  // 3. Scale to target window.
  const span = times[times.length - 1] || 1;
  const target = Math.min(TARGET_MAX, Math.max(TARGET_MIN, span));
  const scale = target / span;
  times = times.map((t) => t * scale);

  const schedule = commits.map((c, i) => {
    const value = churn(c);
    return {
      index: i,
      time: times[i],
      note: churnToNote(value, maxChurn),
      duration: churnToDuration(value, maxChurn),
      velocity: churnToVelocity(value, maxChurn),
      author: c.author,
      instrument: voices.get(c.author),
      additions: c.additions,
      deletions: c.deletions,
      message: c.message,
      sha: c.sha,
      cue: messageCue(c.message),
    };
  });

  // totalDuration includes the tail of the last note.
  schedule.totalDuration = (times[times.length - 1] || 0) + 1.5;
  schedule.voices = voices;
  return schedule;
}

// ---- Playback ---------------------------------------------------------------

/**
 * SonifierPlayer wraps Tone.js. It owns one PolySynth per voice, plus a
 * shared reverb, and schedules a playback schedule on the Transport.
 *
 * Callbacks let the UI/visual react in sync:
 *   onEvent(entry)  fired (via Tone.Draw) exactly when each note sounds
 *   onEnd()         fired when the piece finishes
 */
export class SonifierPlayer {
  constructor() {
    this.synths = new Map(); // voice name -> PolySynth
    this.reverb = null;
    this.metalCue = null; // for "revert" cue
    this.noiseCue = null; // for "fix" cue
    this._built = false;
    this._eventIds = [];
    this.onEvent = null;
    this.onEnd = null;
  }

  _build() {
    if (this._built) return;
    this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.25 }).toDestination();

    for (const voice of VOICES) {
      let synth;
      if (voice === 'fmsine') {
        synth = new Tone.PolySynth(Tone.FMSynth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.8 },
        });
      } else {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: voice },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.25, release: 0.9 },
        });
      }
      synth.connect(this.reverb);
      synth.volume.value = -8;
      this.synths.set(voice, synth);
    }

    // Cue instruments.
    this.metalCue = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.2 },
      harmonicity: 5.1,
      resonance: 800,
      volume: -18,
    }).connect(this.reverb);

    this.noiseCue = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
      volume: -22,
    }).connect(this.reverb);

    this._built = true;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(schedule) {
    await Tone.start();
    this._build();
    this.stop(); // clear any prior run

    const transport = Tone.getTransport();

    for (const entry of schedule) {
      const id = transport.schedule((time) => {
        const synth = this.synths.get(entry.instrument) || this.synths.get('sine');
        synth.triggerAttackRelease(entry.note, entry.duration, time, entry.velocity);

        if (entry.cue === 'revert') {
          this.metalCue.triggerAttackRelease('16n', time);
        } else if (entry.cue === 'fix') {
          this.noiseCue.triggerAttackRelease('16n', time);
        }

        // Fire the visual/UI callback exactly in sync with the audio.
        if (this.onEvent) {
          Tone.getDraw().schedule(() => this.onEvent(entry), time);
        }
      }, entry.time);
      this._eventIds.push(id);
    }

    // Schedule the end.
    const endId = transport.schedule((time) => {
      if (this.onEnd) Tone.getDraw().schedule(() => this.onEnd(), time);
    }, schedule.totalDuration);
    this._eventIds.push(endId);

    transport.start();
  }

  pause() {
    Tone.getTransport().pause();
  }

  resume() {
    Tone.getTransport().start();
  }

  /** Stop and reset the transport to the beginning. */
  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    for (const id of this._eventIds) transport.clear(id);
    this._eventIds = [];
    transport.position = 0;
  }

  /** Current playhead position in seconds. */
  get seconds() {
    return Tone.getTransport().seconds;
  }

  dispose() {
    this.stop();
    for (const s of this.synths.values()) s.dispose();
    this.metalCue?.dispose();
    this.noiseCue?.dispose();
    this.reverb?.dispose();
    this.synths.clear();
    this._built = false;
  }
}

export default SonifierPlayer;
