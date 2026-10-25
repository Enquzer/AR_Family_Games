/**
 * MediaPipe pose engine shared by the laptop host and the optional phone tracker.
 *
 * Loads the vendored Tasks-Vision bundle + WASM + pose model, runs VIDEO-mode
 * inference, and feeds detections through the stable multi-person tracker.
 */
import { FilesetResolver, PoseLandmarker } from '/vendor/mediapipe/vision_bundle.mjs';
import { MultiPoseTracker } from '../vision/poseTracker.js';

const WASM_DIR = '/vendor/mediapipe/wasm';
const MODEL_PATH = '/models/pose_landmarker_full.task';

// Silence harmless internal MediaPipe WASM C++ ROI warnings & gl_context logs
const origWarn = console.warn;
const origError = console.error;
const isInternalVisionNoise = (args) => {
  const str = args.map((a) => (typeof a === 'string' ? a : a?.message || '')).join(' ');
  return (
    str.includes('landmark_projection_calculator') ||
    str.includes('NORM_RECT') ||
    str.includes('gl_context.cc') ||
    str.includes('OpenGL error checking') ||
    str.includes('Graph successfully started')
  );
};

console.warn = (...args) => {
  if (isInternalVisionNoise(args)) return;
  origWarn.apply(console, args);
};

console.error = (...args) => {
  if (isInternalVisionNoise(args)) return;
  origError.apply(console, args);
};

export class PoseEngine {
  constructor({ maxPlayers = 4, onStatus = null } = {}) {
    this.maxPlayers = maxPlayers;
    this.onStatus = onStatus;
    this.tracker = new MultiPoseTracker({ maxPlayers });
    this.landmarker = null;
    this.ready = false;
    this.lastTs = 0;
    this.lastDetections = [];
  }

  async load() {
    this.onStatus?.('Loading vision runtime…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    const options = {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: this.maxPlayers,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    } catch (err) {
      console.warn('[pose] GPU delegate failed, falling back to CPU', err);
      this.onStatus?.('GPU unavailable · using CPU…');
      options.baseOptions.delegate = 'CPU';
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    }

    this.ready = true;
    this.onStatus?.('Pose model ready');
    return this;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} ts milliseconds, monotonically increasing
   * @param {number} aspect video aspect ratio
   * @returns {Array} stable tracks
   */
  detect(video, ts, aspect = 16 / 9) {
    if (!this.ready || !this.landmarker) return [];
    if (!video || video.readyState < 2 || !video.videoWidth) return [];
    // MediaPipe requires strictly increasing timestamps.
    const stamp = Math.max(Math.round(ts), this.lastTs + 1);
    this.lastTs = stamp;
    let result = null;
    try {
      result = this.landmarker.detectForVideo(video, stamp);
    } catch (err) {
      console.warn('[pose] detect failed', err);
      return [];
    }
    this.lastDetections = result?.landmarks || [];
    const worldDetections = result?.worldLandmarks || [];
    return this.tracker.update(this.lastDetections, stamp, aspect, worldDetections);
  }

  setMaxPlayers(n) {
    this.maxPlayers = n;
    this.tracker.setMaxPlayers(n);
  }

  reset() {
    this.tracker.reset();
    this.lastDetections = [];
  }

  close() {
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
    this.ready = false;
  }
}
