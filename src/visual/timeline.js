// Canvas timeline renderer.
// Owner: Person B (/visual + /ui).
//
// Consumes the SHARED "playback schedule" (see sonifier.js) — never touches
// Tone.js directly. It draws each commit as a node along a horizontal
// timeline, animates a moving playhead, and pulses a node when its commit
// "fires" (the UI calls pulse(index) from the sonifier's onEvent callback).

// Per-author colors, assigned in first-seen order (mirrors voice assignment).
const PALETTE = [
  '#6ee7ff', // cyan
  '#c084fc', // violet
  '#fbbf24', // amber
  '#4ade80', // green
  '#f472b6', // pink
  '#f87171', // red
  '#a3e635', // lime
];

export class TimelineRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.schedule = [];
    this.authorColors = new Map();
    this.pulses = new Map(); // index -> pulse strength 0..1 (decays)
    this.playhead = 0; // seconds
    this.total = 1; // seconds
    this.dpr = window.devicePixelRatio || 1;
    this._raf = null;
    this._running = false;
    this._getPlayhead = null; // function returning current seconds

    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  setSchedule(schedule) {
    this.schedule = schedule || [];
    this.total = schedule?.totalDuration || 1;
    // Assign colors by first-seen author.
    this.authorColors.clear();
    let n = 0;
    for (const e of this.schedule) {
      if (!this.authorColors.has(e.author)) {
        this.authorColors.set(e.author, PALETTE[n % PALETTE.length]);
        n += 1;
      }
    }
    this.pulses.clear();
    this.playhead = 0;
    this.draw();
  }

  /** UI supplies a function that returns the live playhead (Transport.seconds). */
  bindPlayhead(fn) {
    this._getPlayhead = fn;
  }

  /** Called from sonifier onEvent — light up a commit node. */
  pulse(index) {
    this.pulses.set(index, 1);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  reset() {
    this.playhead = 0;
    this.pulses.clear();
    this.draw();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 240;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this.draw();
  }

  _loop() {
    if (!this._running) return;
    if (this._getPlayhead) this.playhead = this._getPlayhead();
    // Decay pulses.
    for (const [i, v] of this.pulses) {
      const nv = v - 0.045;
      if (nv <= 0) this.pulses.delete(i);
      else this.pulses.set(i, nv);
    }
    this.draw();
    this._raf = requestAnimationFrame(this._loop);
  }

  _x(time) {
    const padL = 48;
    const padR = 32;
    const usable = this.cssW - padL - padR;
    return padL + (time / (this.total || 1)) * usable;
  }

  _nodeRadius(e) {
    const churn = (e.additions || 0) + (e.deletions || 0);
    return 4 + Math.min(22, Math.log10(1 + churn) * 6);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    if (!ctx || !w || !h) return;

    // Background.
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0f1a');
    bg.addColorStop(1, '#0a0d14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const axisY = h * 0.62;

    // Baseline.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this._x(0), axisY);
    ctx.lineTo(this._x(this.total), axisY);
    ctx.stroke();

    // Connectors between nodes.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    this.schedule.forEach((e, i) => {
      const x = this._x(e.time);
      if (i === 0) ctx.moveTo(x, axisY);
      else ctx.lineTo(x, axisY);
    });
    ctx.stroke();

    // Nodes.
    for (const e of this.schedule) {
      const x = this._x(e.time);
      const r = this._nodeRadius(e);
      const color = this.authorColors.get(e.author) || '#8892b0';
      const pulse = this.pulses.get(e.index) || 0;
      const passed = this.playhead >= e.time;

      // Glow when pulsing.
      if (pulse > 0) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 30 * pulse;
        ctx.beginPath();
        ctx.arc(x, axisY, r + pulse * 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(x, axisY, r, 0, Math.PI * 2);
      ctx.fillStyle = passed ? color : 'rgba(255,255,255,0.14)';
      ctx.globalAlpha = passed ? 0.95 : 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();

      // Cue marker.
      if (e.cue) {
        ctx.fillStyle = e.cue === 'revert' ? '#f87171' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(x, axisY - r - 8, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playhead.
    const px = this._x(this.playhead);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 12);
    ctx.lineTo(px, h - 12);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(px, 8);
    ctx.lineTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.closePath();
    ctx.fill();

    // Time label.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${this.playhead.toFixed(1)}s / ${this.total.toFixed(1)}s`,
      12,
      h - 10
    );
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }
}

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length];
}

export default TimelineRenderer;
