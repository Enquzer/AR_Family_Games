import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioKit } from '../public/src/engine/audio.js';

test('AudioKit initializes with clean music track state', () => {
  const kit = new AudioKit();
  assert.equal(kit.isMusicTrackLoaded(), false);
  assert.equal(kit.muted, false);
  assert.equal(kit.danceMusicMuted, false);
});

test('Procedural dance music engine executes 16th-note rhythm steps for all 5 styles without error', () => {
  const kit = new AudioKit();

  // Mock tone and noise methods to intercept scheduled instruments
  const scheduledTones = [];
  const scheduledNoise = [];

  kit.tone = (opts) => { scheduledTones.push(opts); };
  kit.noise = (opts) => { scheduledNoise.push(opts); };
  kit.ctx = { currentTime: 0 }; // Mock active context

  const styles = ['samba', 'disco', 'robot', 'climax', 'groove'];

  for (const style of styles) {
    scheduledTones.length = 0;
    scheduledNoise.length = 0;

    // Step through an entire 16-step (4-beat) measure
    for (let step = 0; step < 16; step++) {
      kit.stepDanceMusic({ style, bpm: 112, step });
    }

    assert.ok(scheduledTones.length > 0, `Style ${style} must trigger tonal melodic/percussive instruments`);
    assert.ok(scheduledNoise.length > 0, `Style ${style} must trigger noise-based rhythm instruments (drums/shakers)`);
  }
});

test('Samba style generates signature Surdo kicks, Agogô bells, and Latin montuno chords', () => {
  const kit = new AudioKit();
  const tones = [];
  kit.tone = (opts) => { tones.push(opts); };
  kit.noise = () => {};
  kit.ctx = { currentTime: 0 };

  // Step 0: Surdo kick + Agogo low bell
  tones.length = 0;
  kit.stepDanceMusic({ style: 'samba', bpm: 112, step: 0 });
  const hasAgogoLow = tones.some(t => Math.abs(t.freq - 587.33) < 1.0);
  assert.ok(hasAgogoLow, 'Samba step 0 must include Agogô low bell (~587 Hz)');

  // Step 3: Agogo high bell
  tones.length = 0;
  kit.stepDanceMusic({ style: 'samba', bpm: 112, step: 3 });
  const hasAgogoHigh = tones.some(t => Math.abs(t.freq - 880.0) < 1.0);
  assert.ok(hasAgogoHigh, 'Samba step 3 must include Agogô high bell (~880 Hz)');

  // Step 6: Tumbao Bass note
  tones.length = 0;
  kit.stepDanceMusic({ style: 'samba', bpm: 112, step: 6 });
  const hasBass = tones.some(t => t.freq < 150);
  assert.ok(hasBass, 'Samba step 6 must play syncopated Tumbao bass note');
});

test('Disco style generates Four-on-the-Floor kick and offbeat open hi-hat', () => {
  const kit = new AudioKit();
  const tones = [];
  const noises = [];
  kit.tone = (opts) => { tones.push(opts); };
  kit.noise = (opts) => { noises.push(opts); };
  kit.ctx = { currentTime: 0 };

  // On beats (0, 4, 8, 12): Kick drum should fire
  for (const step of [0, 4, 8, 12]) {
    tones.length = 0;
    kit.stepDanceMusic({ style: 'disco', bpm: 126, step });
    const hasKick = tones.some(t => t.freq <= 120 && t.to <= 40);
    assert.ok(hasKick, `Disco step ${step} must play 4-on-the-floor kick`);
  }

  // Offbeats (2, 6, 10, 14): Open hi-hat sizzle
  for (const step of [2, 6, 10, 14]) {
    noises.length = 0;
    kit.stepDanceMusic({ style: 'disco', bpm: 126, step });
    const hasOpenHat = noises.some(n => n.dur >= 0.20 && n.freq >= 8000);
    assert.ok(hasOpenHat, `Disco step ${step} must play offbeat open hi-hat sizzle`);
  }
});

test('Custom audio track playback control state transitions correctly', () => {
  const kit = new AudioKit();

  // Mock audio buffer
  kit.musicTrack = { duration: 120, numberOfChannels: 2 };
  let started = false;
  let stopped = false;

  kit.ctx = {
    currentTime: 10.0,
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect: () => ({ connect: () => {} }),
      start: () => { started = true; },
      stop: () => { stopped = true; },
      disconnect: () => {},
    }),
    createGain: () => ({
      gain: { setValueAtTime: () => {} },
      connect: () => {},
    }),
  };
  kit.master = {};

  assert.equal(kit.isMusicTrackLoaded(), true);

  const played = kit.playMusicTrack({ loop: true, volume: 0.8 });
  assert.equal(played, true);
  assert.equal(started, true);

  kit.stopMusicTrack();
  assert.equal(stopped, true);
  assert.equal(kit.musicSource, null);
});
