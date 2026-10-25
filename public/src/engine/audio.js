/** Tiny WebAudio synth: every sound is generated, no audio files. */
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.6;

    // Custom Audio Music Track State
    this.musicTrack = null;
    this.musicSource = null;
    this.musicGain = null;
    this.danceMusicMuted = false;
    this.lastDanceStep = -1;
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

  /* ------------------------------------------------------------------ */
  /* Custom MP3 / Audio Track Loading & Playback                        */
  /* ------------------------------------------------------------------ */

  async loadMusicTrack(fileOrUrl) {
    await this.unlock();
    if (!this.ctx) return false;

    try {
      let arrayBuffer;
      if (typeof fileOrUrl === 'string') {
        const res = await fetch(fileOrUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        arrayBuffer = await res.arrayBuffer();
      } else if (fileOrUrl instanceof Blob || fileOrUrl instanceof File) {
        arrayBuffer = await fileOrUrl.arrayBuffer();
      } else {
        throw new Error('Unsupported music source');
      }

      this.musicTrack = await this.ctx.decodeAudioData(arrayBuffer);
      return true;
    } catch (err) {
      console.warn('[AudioKit] Failed to decode music track:', err);
      return false;
    }
  }

  playMusicTrack({ loop = true, volume = 0.7, startTime = 0 } = {}) {
    if (!this.ctx || !this.musicTrack) return false;
    this.stopMusicTrack();

    const src = this.ctx.createBufferSource();
    src.buffer = this.musicTrack;
    src.loop = loop;

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(this.muted ? 0 : volume * this.volume, this.ctx.currentTime);

    src.connect(gainNode).connect(this.master);
    src.start(0, Math.max(0, startTime));

    this.musicSource = src;
    this.musicGain = gainNode;
    return true;
  }

  stopMusicTrack() {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
        this.musicSource.disconnect();
      } catch {}
      this.musicSource = null;
    }
  }

  isMusicTrackLoaded() {
    return !!this.musicTrack;
  }

  /* ------------------------------------------------------------------ */
  /* Procedural Genre-Specific Dance Music Engine                       */
  /* ------------------------------------------------------------------ */

  playDrumKick({ punch = 1.0, sub = true, dur = 0.22, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 110 * punch, to: 38, dur: dur * 0.8, type: 'sine', gain: 0.45 * punch, delay });
    if (sub) {
      this.tone({ freq: 65 * punch, to: 28, dur: dur * 1.1, type: 'sine', gain: 0.35 * punch, delay });
    }
    this.noise({ dur: 0.04, gain: 0.25 * punch, freq: 1200, q: 2.0, type: 'bandpass', delay });
  }

  playDrumSnare({ snappy = true, gain = 0.28, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    this.noise({ dur: 0.16, gain: gain * 1.1, freq: 2400, q: 1.0, type: 'highpass', delay });
    this.tone({ freq: 210, to: 120, dur: 0.12, type: 'triangle', gain: gain * 0.9, delay });
  }

  playHiHat({ open = false, gain = 0.12, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const dur = open ? 0.24 : 0.05;
    this.noise({ dur, gain, freq: 8500, q: 2.5, type: 'highpass', delay });
  }

  playAgogo({ high = false, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const freq = high ? 880 : 587.33; // A5 vs D5
    this.tone({ freq, to: freq * 0.97, dur: 0.18, type: 'sine', gain: 0.22, delay });
    this.tone({ freq: freq * 2.02, to: freq * 1.95, dur: 0.09, type: 'triangle', gain: 0.08, delay });
  }

  playShaker({ accent = false, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const gain = accent ? 0.10 : 0.05;
    this.noise({ dur: 0.04, gain, freq: 6500, q: 1.8, type: 'bandpass', delay });
  }

  playBassNote({ freq = 65.41, dur = 0.25, type = 'sawtooth', gain = 0.28, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    this.tone({ freq, to: freq * 0.98, dur, type, gain: gain * 0.85, delay });
    this.tone({ freq: freq * 0.5, to: freq * 0.5, dur, type: 'sine', gain: gain * 0.9, delay });
  }

  playChordStab({ freqs = [], dur = 0.22, gain = 0.12, type = 'triangle', delay = 0 } = {}) {
    if (!this.ctx || this.muted || !freqs.length) return;
    const noteGain = gain / Math.sqrt(freqs.length);
    for (const f of freqs) {
      this.tone({ freq: f, dur, type, gain: noteGain, delay });
    }
  }

  /**
   * Evaluates the active 16th-note step for the requested dance style
   * and triggers the corresponding rhythmic and harmonic instruments.
   */
  stepDanceMusic({ style = 'samba', bpm = 112, step = 0 } = {}) {
    if (!this.ctx || this.muted || this.danceMusicMuted) return;
    if (this.musicSource) return; // Custom audio file track is currently active

    const s = ((step % 16) + 16) % 16;
    const measure = Math.floor(step / 16);

    switch (style) {
      case 'samba': {
        // --- SAMBA / LATIN HEAT ---
        this.playShaker({ accent: s % 2 === 1 });

        // Surdo Bass Drum: syncopated Latin groove
        if (s === 0) this.playDrumKick({ punch: 0.8, sub: true });
        if (s === 4) this.playDrumKick({ punch: 1.2, sub: true });
        if (s === 10) this.playDrumKick({ punch: 0.9, sub: true });
        if (s === 12) this.playDrumKick({ punch: 1.3, sub: true });

        // Agogô Bells: syncopated batucada bell pattern
        if (s === 0 || s === 6 || s === 10) this.playAgogo({ high: false });
        if (s === 3 || s === 8 || s === 12 || s === 14) this.playAgogo({ high: true });

        // Latin Tumbao Bassline
        const roots = [55.0, 73.42, 65.41, 48.99]; // A1, D2, C2, G1
        const root = roots[measure % roots.length];
        if (s === 6) this.playBassNote({ freq: root * 1.5, dur: 0.22, gain: 0.25 });
        if (s === 12) this.playBassNote({ freq: root, dur: 0.28, gain: 0.30 });
        if (s === 14) this.playBassNote({ freq: root * 1.25, dur: 0.16, gain: 0.22 });

        // Latin Montuno Chord Stabs: Dm7 / G9 / Cmaj7 / A7
        const montunoChords = [
          [293.66, 349.23, 440.0, 523.25], // Dm7
          [392.00, 493.88, 587.33, 698.46], // G9
          [261.63, 329.63, 392.00, 493.88], // Cmaj7
          [220.00, 277.18, 329.63, 392.00], // A7
        ];
        const chord = montunoChords[measure % montunoChords.length];
        if (s === 2 || s === 5 || s === 8 || s === 11 || s === 14) {
          this.playChordStab({ freqs: chord, dur: 0.14, gain: 0.11, type: 'triangle' });
        }
        break;
      }

      case 'disco': {
        // --- DISCO INFERNO (126 BPM) ---
        // Four-on-the-Floor Kick on every quarter note
        if (s % 4 === 0) {
          this.playDrumKick({ punch: 1.15, sub: true });
        }

        // Snare on beats 2 & 4
        if (s === 4 || s === 12) {
          this.playDrumSnare({ snappy: true, gain: 0.32 });
        }

        // Open Hi-Hat on offbeat eighth notes ("and" = 2, 6, 10, 14)
        if (s % 4 === 2) {
          this.playHiHat({ open: true, gain: 0.14 });
        } else if (s % 2 === 0) {
          this.playHiHat({ open: false, gain: 0.08 });
        }

        // Funky Slap Bass: Octave jump bounce
        const discoBass = [
          82.41, 164.81, 82.41, 196.00, // E2, E3, E2, G3
          98.00, 196.00, 110.00, 220.00, // G2, G3, A2, A3
        ];
        const note = discoBass[Math.floor(s / 2) % discoBass.length];
        if (s % 2 === 0) {
          this.playBassNote({ freq: note, dur: 0.16, type: 'sawtooth', gain: 0.28 });
        }

        // Disco Brass / String Chords
        const discoChords = [
          [329.63, 392.00, 493.88, 587.33], // Em7
          [349.23, 440.00, 523.25, 659.25], // Fmaj7
          [392.00, 493.88, 587.33, 698.46], // G7
          [440.00, 554.37, 659.25, 783.99], // A7
        ];
        const dChord = discoChords[measure % discoChords.length];
        if (s === 0 || s === 6 || s === 10) {
          this.playChordStab({ freqs: dChord, dur: 0.18, gain: 0.13, type: 'sawtooth' });
        }
        break;
      }

      case 'robot': {
        // --- POPPING / ROBOT ELECTRO (136 BPM) ---
        if (s === 0 || s === 6 || s === 10) {
          this.playDrumKick({ punch: 1.3, sub: true, dur: 0.35 });
        }
        if (s === 4 || s === 12) {
          this.playDrumSnare({ snappy: true, gain: 0.35 });
        }
        this.playHiHat({ open: s === 14, gain: 0.07 });

        // Robotic Sawtooth Arpeggio Bass
        const robotNotes = [65.41, 77.78, 87.31, 98.00, 116.54, 130.81, 116.54, 87.31];
        const rNote = robotNotes[s % robotNotes.length];
        this.playBassNote({ freq: rNote, dur: 0.09, type: 'sawtooth', gain: 0.22 });

        if (s === 15) {
          this.tone({ freq: 1200, to: 280, dur: 0.11, type: 'sine', gain: 0.16 });
        }
        break;
      }

      case 'climax': {
        // --- GRAND CLIMAX / FESTIVAL EDM (142 BPM) ---
        if (s % 4 === 0) {
          this.playDrumKick({ punch: 1.4, sub: true, dur: 0.3 });
        }
        if (s % 2 === 1) {
          this.playHiHat({ open: true, gain: 0.15 });
        }
        if (s === 4 || s === 12) {
          this.playDrumSnare({ snappy: true, gain: 0.4 });
        }

        const climaxNotes = [130.81, 164.81, 196.00, 261.63];
        const cNote = climaxNotes[s % climaxNotes.length];
        this.playBassNote({ freq: cNote * 0.5, dur: 0.12, type: 'sawtooth', gain: 0.32 });
        this.tone({ freq: cNote * 2, dur: 0.08, type: 'sawtooth', gain: 0.14 });
        break;
      }

      case 'groove':
      default: {
        // --- WARM-UP GROOVE / LO-FI R&B (96 BPM) ---
        if (s === 0 || s === 10) {
          this.playDrumKick({ punch: 0.9, sub: true, dur: 0.25 });
        }
        if (s === 4 || s === 12) {
          this.playDrumSnare({ snappy: false, gain: 0.24 });
        }
        if (s % 2 === 0) {
          this.playHiHat({ open: false, gain: 0.06 });
        }

        const grooveBass = [65.41, 65.41, 87.31, 77.78];
        const gNote = grooveBass[Math.floor(s / 4) % grooveBass.length];
        if (s % 4 === 0) {
          this.playBassNote({ freq: gNote, dur: 0.35, type: 'sine', gain: 0.32 });
        }

        const rhodesChords = [
          [261.63, 311.13, 392.00, 466.16],
          [220.00, 261.63, 329.63, 392.00],
          [174.61, 220.00, 261.63, 329.63],
          [196.00, 246.94, 293.66, 349.23],
        ];
        const rChord = rhodesChords[measure % rhodesChords.length];
        if (s === 0 || s === 8) {
          this.playChordStab({ freqs: rChord, dur: 0.45, gain: 0.10, type: 'sine' });
        }
        break;
      }
    }
  }
}
