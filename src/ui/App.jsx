// App shell — repo input, transport controls, and the wiring that connects
// data -> audio -> visual.
// Owner: Person B (/visual + /ui).

import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { fetchCommits } from '../data/github.js';
import { mockCommits } from '../data/mockCommits.js';
import { buildSchedule, SonifierPlayer } from '../audio/sonifier.js';
import { TimelineRenderer, colorForIndex } from '../visual/timeline.js';
import './styles.css';

export default function App() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const playerRef = useRef(null);

  const [repo, setRepo] = useState('facebook/react');
  const [commits, setCommits] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | playing | paused
  const [error, setError] = useState('');
  const [nowPlaying, setNowPlaying] = useState(null);

  // Set up renderer + player once.
  useEffect(() => {
    const renderer = new TimelineRenderer(canvasRef.current);
    rendererRef.current = renderer;

    const player = new SonifierPlayer();
    playerRef.current = player;

    // Renderer reads the Transport clock and reports crossings, keeping the
    // "now playing" label and pulses frame-tight with the audio.
    renderer.bindPlayhead(() => player.seconds);
    renderer.onCross = (entry) => setNowPlaying(entry);
    renderer.onEnd = () => {
      player.stop();
      renderer.stop();
      renderer.reset();
      setStatus('ready');
      setNowPlaying(null);
    };

    return () => {
      renderer.dispose();
      player.dispose();
    };
  }, []);

  // Load a schedule into both the renderer and local state.
  function loadCommits(list) {
    const sched = buildSchedule(list);
    setCommits(list);
    setSchedule(sched);
    rendererRef.current.setSchedule(sched);
    setStatus('ready');
    setNowPlaying(null);
  }

  function handleMock() {
    setError('');
    loadCommits(mockCommits);
  }

  async function handleFetch() {
    setError('');
    setStatus('loading');
    try {
      const list = await fetchCommits(repo, { perPage: 60 });
      loadCommits(list);
    } catch (e) {
      setError(e.message || String(e));
      setStatus('idle');
    }
  }

  async function handlePlay() {
    if (!schedule) return;
    const player = playerRef.current;
    const renderer = rendererRef.current;

    if (status === 'paused') {
      player.resume();
      renderer.start();
      setStatus('playing');
      return;
    }

    renderer.reset();
    renderer.start();
    await player.start(schedule);
    setStatus('playing');
  }

  function handlePause() {
    playerRef.current.pause();
    rendererRef.current.stop();
    setStatus('paused');
  }

  function handleStop() {
    playerRef.current.stop();
    rendererRef.current.stop();
    rendererRef.current.reset();
    setStatus('ready');
    setNowPlaying(null);
  }

  // Distinct authors for the legend.
  const authors = [];
  if (schedule) {
    const seen = new Set();
    for (const e of schedule) {
      if (!seen.has(e.author)) {
        seen.add(e.author);
        authors.push({ name: e.author, color: colorForIndex(authors.length) });
      }
    }
  }

  const canPlay = !!schedule && (status === 'ready' || status === 'paused');

  return (
    <div className="app">
      <header className="app__header">
        <h1>
          <span className="app__logo">♪</span> Git History Sonifier
        </h1>
        <p className="app__tagline">
          Turn a repo's commit history into generative music.
        </p>
      </header>

      <section className="controls">
        <input
          className="controls__input"
          type="text"
          value={repo}
          placeholder="owner/repo  (e.g. facebook/react)"
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
        />
        <button className="btn" onClick={handleFetch} disabled={status === 'loading'}>
          {status === 'loading' ? 'Fetching…' : 'Fetch'}
        </button>
        <button className="btn btn--ghost" onClick={handleMock}>
          Load mock data
        </button>
      </section>

      {error && <div className="error">⚠ {error}</div>}

      <section className="transport">
        <button
          className="btn btn--primary"
          onClick={status === 'playing' ? handlePause : handlePlay}
          disabled={!canPlay && status !== 'playing'}
        >
          {status === 'playing' ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn btn--ghost" onClick={handleStop} disabled={!schedule}>
          ■ Stop
        </button>
        <span className="transport__status">
          {schedule
            ? `${commits.length} commits · ${schedule.totalDuration.toFixed(0)}s piece`
            : 'No data loaded'}
        </span>
      </section>

      <section className="stage">
        <canvas ref={canvasRef} className="stage__canvas" />
      </section>

      <section className="meta">
        <div className="legend">
          {authors.map((a) => (
            <span className="legend__item" key={a.name}>
              <span className="legend__dot" style={{ background: a.color }} />
              {a.name}
            </span>
          ))}
        </div>
        <div className="nowplaying">
          {nowPlaying ? (
            <>
              <code>{nowPlaying.sha}</code>{' '}
              <strong>{nowPlaying.author}</strong> · {nowPlaying.note} ·
              <span className="nowplaying__churn">
                {' '}+{nowPlaying.additions}/-{nowPlaying.deletions}
              </span>{' '}
              — {nowPlaying.message}
              {nowPlaying.cue && (
                <span className={`cue cue--${nowPlaying.cue}`}> [{nowPlaying.cue}]</span>
              )}
            </>
          ) : (
            <span className="nowplaying__idle">
              Press play to hear the history.
            </span>
          )}
        </div>
      </section>

      <footer className="app__footer">
        Lines changed → pitch &amp; volume · time gaps → rhythm · author →
        instrument · fix/revert → sound cue
      </footer>
    </div>
  );
}
