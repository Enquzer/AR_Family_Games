/**
 * Automatic TV detection for calibration.
 *
 * The display window flashes pure white. The host camera looks for the largest
 * bright, low-saturation, roughly rectangular blob, fits the maximum-area
 * quadrilateral to its convex hull, and returns its four corners.
 * Falls back to manual corner picking in the UI when confidence is low.
 */
import {
  convexHull,
  maxAreaQuad,
  normalizeQuad,
  quadArea,
  rectangularity,
  quadRect,
  orderQuad,
} from '../shared/homography.js';
import { clamp } from '../shared/math.js';

const WORK_W = 200;
const MIN_AREA_FRAC = 0.004;

export class ScreenDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * @param {HTMLVideoElement} video
   * @returns {null|{quad:Array,score:number,areaFrac:number,rect:number,aspect:number}}
   */
  detect(video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const w = WORK_W;
    const h = Math.max(48, Math.round((WORK_W * vh) / vw));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    let data;
    try {
      data = this.ctx.getImageData(0, 0, w, h).data;
    } catch {
      return null;
    }

    const n = w * h;
    const lum = new Float32Array(n);
    const sat = new Uint8Array(n);
    let maxL = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = l;
      sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
      if (l > maxL) maxL = l;
    }
    if (maxL < 150) return null; // room is dark / TV not flashing

    const threshold = Math.max(185, maxL * 0.8);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (lum[i] >= threshold && sat[i] < 85) mask[i] = 1;
    }

    const visited = new Uint8Array(n);
    const components = [];
    const stack = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (!mask[start] || visited[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      const pixels = [];
      while (sp > 0) {
        const idx = stack[--sp];
        pixels.push(idx);
        const x = idx % w;
        const y = (idx / w) | 0;
        if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
          visited[idx - 1] = 1;
          stack[sp++] = idx - 1;
        }
        if (x < w - 1 && mask[idx + 1] && !visited[idx + 1]) {
          visited[idx + 1] = 1;
          stack[sp++] = idx + 1;
        }
        if (y > 0 && mask[idx - w] && !visited[idx - w]) {
          visited[idx - w] = 1;
          stack[sp++] = idx - w;
        }
        if (y < h - 1 && mask[idx + w] && !visited[idx + w]) {
          visited[idx + w] = 1;
          stack[sp++] = idx + w;
        }
      }
      if (pixels.length > n * MIN_AREA_FRAC) components.push(pixels);
    }
    if (!components.length) return null;
    components.sort((a, b) => b.length - a.length);

    let best = null;
    for (const pixels of components.slice(0, 6)) {
      // sample large components to keep the hull cheap
      const step = Math.max(1, Math.floor(pixels.length / 4000));
      const pts = [];
      for (let i = 0; i < pixels.length; i += step) {
        const idx = pixels[i];
        pts.push({ x: idx % w, y: (idx / w) | 0 });
      }
      const hull = convexHull(pts);
      if (hull.length < 4) continue;
      const quad = maxAreaQuad(hull);
      if (!quad) continue;
      const ordered = orderQuad(quad);
      const area = quadArea(ordered);
      const areaFrac = area / n;
      if (areaFrac < MIN_AREA_FRAC) continue;
      const rect = rectangularity(ordered);
      if (rect < 0.5) continue;
      const r = quadRect(ordered);
      const aspect = r.w / Math.max(r.h, 1e-4);
      if (aspect < 0.45 || aspect > 4.2) continue;
      // fill: how much of the fitted quad's bounding box is blob
      const score = areaFrac * Math.pow(rect, 1.5) * clamp(1.2 - Math.abs(aspect - 1.78) / 4, 0.5, 1);
      if (!best || score > best.score) {
        best = {
          quad: normalizeQuad(ordered, w, h),
          score,
          areaFrac,
          rect,
          aspect,
        };
      }
    }
    return best;
  }

  /**
   * Sample the camera while the TV flashes and keep the best detection.
   * @param {HTMLVideoElement} video
   * @param {{duration?:number,onSample?:Function}} opts
   */
  async capture(video, { duration = 1500, onSample } = {}) {
    const start = performance.now();
    let best = null;
    while (performance.now() - start < duration) {
      const d = this.detect(video);
      if (d && (!best || d.score > best.score)) best = d;
      onSample?.(d, performance.now() - start);
      await new Promise((r) => setTimeout(r, 110));
    }
    if (best) best.confidence = clamp(best.score * 6, 0, 1);
    return best;
  }
}
