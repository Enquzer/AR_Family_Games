/** Tiny WebAudio synth: every sound is generated, no audio files. */
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.6;
  }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx.state === 'running';
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  tone({ freq = 440, to = null, dur = 0.2, type = 'sine', gain = 0.3, delay = 0, attack = 0.005, pan = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = _clamp(pan, -1, 1);
      osc.connect(g).connect(panner).connect(this.master);
    } else {
      osc.connect(g).connect(this.master);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0, sweep = null, pan = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t0 + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = _clamp(pan, -1, 1);
      src.connect(filter).connect(g).connect(panner).connect(this.master);
    } else {
      src.connect(filter).connect(g).connect(this.master);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 900, to: 600, dur: 0.06, type: 'square', gain: 0.12 });
        break;
      case 'select':
        this.tone({ freq: 520, to: 780, dur: 0.09, type: 'triangle', gain: 0.16 });
        break;
      case 'count':
        this.tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.25 });
        break;
      case 'go':
        this.tone({ freq: 990, dur: 0.3, type: 'triangle', gain: 0.3 });
        this.tone({ freq: 1480, dur: 0.25, type: 'sine', gain: 0.12, delay: 0.03 });
        break;
      case 'punch': {
        const p = opts.hand === 'L' ? -0.65 : opts.hand === 'R' ? 0.65 : 0;
        this.noise({ dur: 0.09, gain: 0.35, freq: 420, q: 0.8, type: 'lowpass', sweep: 120, pan: p });
        this.tone({ freq: 120, to: 55, dur: 0.18, type: 'sine', gain: 0.4, pan: p });
        break;
      }
      case 'impact': {
        // Layered hit: leather slap + body thump + optional sharp "snap" for
        // clean punches. Power, quality and momentum change the sound so a
        // glancing jab and a heavy counter never sound the same.
        const p = opts.hand === 'L' ? -0.65 : opts.hand === 'R' ? 0.65 : 0;
        const power = _clamp(Number(opts.power) || 0.7, 0.2, 1.35);
        const quality = _clamp(Number(opts.quality) || 0.5, 0, 1);
        const momentum = _clamp(Number(opts.momentum) || quality, 0, 1.35);
        this.noise({
          dur: 0.06 + power * 0.05,
          gain: 0.2 + power * 0.26,
          freq: 500 + power * 260,
          q: 0.9,
          type: 'bandpass',
          sweep: 130,
          pan: p,
        });
        this.tone({
          freq: 150 + power * 55,
          to: 42,
          dur: 0.16 + momentum * 0.08,
          type: 'sine',
          gain: 0.3 + power * 0.18,
          pan: p,
        });
        if (quality > 0.62) {
          this.noise({ dur: 0.045, gain: 0.08 + quality * 0.1, freq: 2600, q: 1.4, type: 'bandpass', pan: p });
        }
        if ((opts.combo || 0) >= 3) {
          this.tone({ freq: 520 + opts.combo * 90, dur: 0.07, type: 'square', gain: 0.055, delay: 0.02, pan: p });
        }
        break;
      }
      case 'combo': {
        const n = _clamp(Number(opts.combo) || 3, 2, 8);
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 520 + n * 55 + i * 180, dur: 0.09, type: 'triangle', gain: 0.08, delay: i * 0.055 });
        }
        break;
      }
      case 'miss':
      case 'whiff':
        this.noise({ dur: 0.2, gain: 0.11, freq: 380, q: 0.7, sweep: 1800 });
        break;
      case 'cue':
        this.noise({ dur: 0.14, gain: 0.16, freq: 700, q: 0.8, type: 'bandpass', sweep: 2600 });
        this.tone({ freq: 190, to: 95, dur: 0.12, type: 'sine', gain: 0.16 });
        break;
      case 'ballHit': {
        const p = _clamp(Number(opts.power) || 0.6, 0.2, 1.35);
        this.noise({ dur: 0.045, gain: 0.12 + p * 0.12, freq: 2200 + p * 900, q: 1.2, type: 'bandpass' });
        this.tone({ freq: 680 + p * 220, to: 240, dur: 0.07, type: 'triangle', gain: 0.07 + p * 0.06 });
        break;
      }
      case 'pocket':
        this.tone({ freq: 110, to: 48, dur: 0.28, type: 'sine', gain: 0.3 });
        this.noise({ dur: 0.18, gain: 0.1, freq: 500, q: 0.6, type: 'lowpass', sweep: 120 });
        break;
      case 'step':
        this.noise({ dur: 0.055, gain: 0.055, freq: 240, q: 0.7, type: 'lowpass', sweep: 90 });
        this.tone({ freq: 90, to: 55, dur: 0.07, type: 'sine', gain: 0.08 });
        break;
      case 'beat': {
        const accent = opts.accent === true;
        this.tone({ freq: accent ? 92 : 78, to: 42, dur: 0.15, type: 'sine', gain: accent ? 0.32 : 0.2 });
        this.noise({ dur: 0.035, gain: accent ? 0.09 : 0.05, freq: 7000, q: 1.4, type: 'highpass' });
        if (accent) this.noise({ dur: 0.12, gain: 0.1, freq: 1300, q: 0.5, sweep: 500 });
        break;
      }
      case 'clap':
        this.noise({ dur: 0.12, gain: 0.16, freq: 1900, q: 0.9, type: 'bandpass' });
        this.noise({ dur: 0.09, gain: 0.1, freq: 3200, q: 1.1, type: 'highpass', delay: 0.025 });
        break;
      case 'bass':
        this.tone({ freq: 65, to: 48, dur: 0.32, type: 'sawtooth', gain: 0.09 });
        break;
      case 'perfect':
        this.tone({ freq: 1046, dur: 0.18, type: 'triangle', gain: 0.18 });
        this.tone({ freq: 1568, dur: 0.24, type: 'sine', gain: 0.1, delay: 0.05 });
        this.tone({ freq: 2093, dur: 0.2, type: 'sine', gain: 0.06, delay: 0.1 });
        break;
      case 'great':
        this.tone({ freq: 784, dur: 0.14, type: 'triangle', gain: 0.14 });
        this.tone({ freq: 1175, dur: 0.16, type: 'sine', gain: 0.08, delay: 0.04 });
        break;
      case 'good':
        this.tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.12 });
        break;
      case 'bad':
        this.tone({ freq: 220, to: 160, dur: 0.16, type: 'square', gain: 0.07 });
        break;
      case 'danceStart':
        for (let i = 0; i < 4; i++) {
          this.tone({ freq: 392 * Math.pow(1.26, i), dur: 0.18, type: 'triangle', gain: 0.11, delay: i * 0.1 });
        }
        break;
      case 'danceEnd':
        this.play('cheer');
        this.tone({ freq: 523, dur: 0.3, type: 'triangle', gain: 0.14 });
        this.tone({ freq: 659, dur: 0.35, type: 'triangle', gain: 0.1, delay: 0.08 });
        this.tone({ freq: 784, dur: 0.5, type: 'triangle', gain: 0.09, delay: 0.16 });
        break;
      case 'kick': {
        const p = opts.side === 'L' ? -0.5 : opts.side === 'R' ? 0.5 : 0;
        this.noise({ dur: 0.12, gain: 0.4, freq: 200, q: 0.6, type: 'lowpass', sweep: 60, pan: p });
        this.tone({ freq: 80, to: 35, dur: 0.22, type: 'sine', gain: 0.45, pan: p });
        break;
      }
      case 'block':
        this.noise({ dur: 0.07, gain: 0.25, freq: 1800, q: 2 });
        this.tone({ freq: 220, to: 140, dur: 0.1, type: 'square', gain: 0.12 });
        break;
      case 'bell':
        this.tone({ freq: 880, dur: 1.1, type: 'sine', gain: 0.22 });
        this.tone({ freq: 1320, dur: 0.9, type: 'sine', gain: 0.1 });
        this.tone({ freq: 1760, dur: 0.6, type: 'sine', gain: 0.06 });
        break;
      case 'bounce':
        this.tone({ freq: 420, to: 180, dur: 0.12, type: 'triangle', gain: 0.18 });
        break;
      case 'tennisHit': {
        const p = _clamp(Number(opts?.power) || 0.8, 0.3, 1.4);
        this.tone({ freq: 820 * p, to: 340, dur: 0.11, type: 'triangle', gain: 0.32 * p });
        this.noise({ dur: 0.06, gain: 0.28 * p, freq: 1600, q: 2.2, type: 'bandpass' });
        this.tone({ freq: 240, to: 110, dur: 0.16, type: 'sine', gain: 0.22 * p });
        break;
      }
      case 'tennisBounce': {
        this.tone({ freq: 280, to: 130, dur: 0.09, type: 'triangle', gain: 0.22 });
        this.noise({ dur: 0.05, gain: 0.16, freq: 450, q: 1.2, type: 'lowpass' });
        break;
      }
      case 'toss': {
        this.noise({ dur: 0.25, gain: 0.14, freq: 800, q: 0.8, sweep: 1800 });
        break;
      }
      case 'hit':
        this.tone({ freq: 620, to: 240, dur: 0.14, type: 'triangle', gain: 0.28 });
        this.noise({ dur: 0.05, gain: 0.15, freq: 2400, q: 1.2 });
        break;
      case 'whoosh':
        this.noise({ dur: 0.22, gain: 0.16, freq: 500, q: 0.7, sweep: 2600 });
        break;
      case 'whistle':
        this.tone({ freq: 2100, to: 1900, dur: 0.35, type: 'sine', gain: 0.16 });
        break;
      case 'splash':
        this.noise({ dur: 0.35, gain: 0.25, freq: 900, q: 0.5, sweep: 300 });
        break;
      case 'coin':
        this.tone({ freq: 1250, dur: 0.08, type: 'square', gain: 0.13 });
        this.tone({ freq: 1850, dur: 0.14, type: 'square', gain: 0.1, delay: 0.06 });
        break;
      case 'cheer':
        this.noise({ dur: 1.4, gain: 0.16, freq: 1200, q: 0.4, sweep: 600 });
        this.noise({ dur: 1.1, gain: 0.1, freq: 2600, q: 0.8, delay: 0.1 });
        break;
      case 'ko':
        this.tone({ freq: 160, to: 40, dur: 0.7, type: 'sine', gain: 0.4 });
        this.noise({ dur: 0.5, gain: 0.2, freq: 500, q: 0.6, sweep: 100 });
        this.play('cheer');
        break;
      case 'boost':
        this.tone({ freq: 300, to: 900, dur: 0.4, type: 'sawtooth', gain: 0.12 });
        break;
      case 'tick':
        this.tone({ freq: 1200, dur: 0.04, type: 'square', gain: 0.07 });
        break;
      case 'stumble':
        this.noise({ dur: 0.25, gain: 0.22, freq: 700, q: 0.8, sweep: 150 });
        this.tone({ freq: 180, to: 90, dur: 0.3, type: 'triangle', gain: 0.16 });
        break;
      case 'pinHit': {
        const p = _clamp(Number(opts?.power) || 0.6, 0.2, 1.4);
        this.noise({ dur: 0.08, gain: 0.22 * p, freq: 2800, q: 2.2, type: 'bandpass' });
        this.tone({ freq: 880 * p, to: 280, dur: 0.12, type: 'triangle', gain: 0.2 * p });
        this.tone({ freq: 440 * p, to: 160, dur: 0.16, type: 'sine', gain: 0.15 * p });
        break;
      }
      case 'strike': {
        this.noise({ dur: 0.35, gain: 0.38, freq: 2200, q: 0.8, type: 'bandpass', sweep: 800 });
        this.noise({ dur: 0.45, gain: 0.25, freq: 800, q: 0.5, type: 'lowpass', delay: 0.03 });
        this.tone({ freq: 720, to: 180, dur: 0.25, type: 'triangle', gain: 0.3 });
        this.tone({ freq: 110, to: 45, dur: 0.4, type: 'sine', gain: 0.45, delay: 0.05 });
        this.play('cheer');
        break;
      }
      case 'gutter': {
        this.noise({ dur: 0.22, gain: 0.28, freq: 320, q: 0.8, type: 'lowpass', sweep: 80 });
        this.tone({ freq: 120, to: 40, dur: 0.28, type: 'sine', gain: 0.35 });
        break;
      }
      case 'ballRoll': {
        this.noise({ dur: 0.15, gain: 0.06, freq: 160, q: 1.5, type: 'lowpass' });
        break;
      }
      case 'bowDraw': {
        const tension = _clamp(Number(opts?.tension) || 0.5, 0.1, 1.0);
        this.tone({ freq: 80 + tension * 120, to: 120 + tension * 160, dur: 0.12, type: 'sawtooth', gain: 0.04 * tension });
        this.noise({ dur: 0.08, gain: 0.03 * tension, freq: 800 + tension * 600, q: 1.8, type: 'bandpass' });
        break;
      }
      case 'bowRelease': {
        this.tone({ freq: 440, to: 180, dur: 0.14, type: 'triangle', gain: 0.28 });
        this.noise({ dur: 0.18, gain: 0.22, freq: 1400, q: 0.9, sweep: 3400 });
        break;
      }
      case 'arrowHit': {
        const p = _clamp(Number(opts?.power) || 0.8, 0.3, 1.2);
        this.noise({ dur: 0.07, gain: 0.25 * p, freq: 1800, q: 1.6, type: 'bandpass' });
        this.tone({ freq: 280, to: 75, dur: 0.15, type: 'sine', gain: 0.35 * p });
        break;
      }
      case 'bullseye': {
        this.tone({ freq: 1046.5, dur: 0.18, type: 'triangle', gain: 0.22 });
        this.tone({ freq: 1318.5, dur: 0.22, type: 'triangle', gain: 0.25, delay: 0.06 });
        this.tone({ freq: 1567.98, dur: 0.35, type: 'sine', gain: 0.28, delay: 0.12 });
        this.tone({ freq: 2093.0, dur: 0.45, type: 'sine', gain: 0.22, delay: 0.18 });
        this.play('cheer');
        break;
      }
      case 'pounding': {
        const p = _clamp(Number(opts?.power) || 1.0, 0.4, 1.6);
        this.noise({ dur: 0.12, gain: 0.42 * p, freq: 380, q: 0.9, type: 'lowpass', sweep: 80 });
        this.tone({ freq: 110 * p, to: 32, dur: 0.28, type: 'sine', gain: 0.55 * p });
        this.tone({ freq: 220, to: 65, dur: 0.15, type: 'triangle', gain: 0.35 * p });
        this.noise({ dur: 0.05, gain: 0.22, freq: 3200, q: 2.0, type: 'bandpass' });
        break;
      }
      case 'telegraph': {
        this.tone({ freq: 880, to: 440, dur: 0.12, type: 'sawtooth', gain: 0.12 });
        break;
      }
      case 'dizzy': {
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 1200 + i * 200, to: 1000 + i * 150, dur: 0.1, type: 'sine', gain: 0.08, delay: i * 0.08 });
        }
        break;
      }
      default:
        break;
    }
  }

  /** Pulse a low heartbeat - call repeatedly at the desired BPM. */
  heartbeat(bpm = 70) {
    if (!this.ctx || this.muted) return;
    const interval = 60 / bpm;
    this.tone({ freq: 55, to: 40, dur: 0.08, type: 'sine', gain: 0.18 });
    this.tone({ freq: 45, to: 38, dur: 0.07, type: 'sine', gain: 0.12, delay: interval * 0.35 });
  }
}
