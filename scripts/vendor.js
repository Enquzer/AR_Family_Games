/**
 * Copies the runtime pieces we need out of node_modules into public/vendor so the
 * game server is fully self-contained (no CDN, works on a LAN with no internet).
 *
 * Also downloads the MediaPipe pose model once. If the download fails the app
 * still works and the browser falls back to the CDN URL.
 */
import { existsSync, mkdirSync, copyFileSync, statSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');
const models = join(root, 'public', 'models');

const copies = [
  ['node_modules/three/build/three.module.js', 'vendor/three/three.module.js'],
  ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'vendor/mediapipe/vision_bundle.mjs'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.js'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'],
];

for (const [from, to] of copies) {
  const src = join(root, from);
  const dst = join(root, 'public', to);
  if (!existsSync(src)) {
    console.warn(`[vendor] missing ${from} (run npm install)`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[vendor] ${to}`);
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MODEL_PATH = join(models, 'pose_landmarker_full.task');

async function download(url, dest) {
  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        file.close();
        reject(err);
      });
  });
}

if (!existsSync(MODEL_PATH) || statSync(MODEL_PATH).size < 1_000_000) {
  mkdirSync(models, { recursive: true });
  console.log('[vendor] downloading pose model (~9 MB, one time)...');
  try {
    await download(MODEL_URL, MODEL_PATH);
    console.log('[vendor] pose model ready');
  } catch (err) {
    console.warn(`[vendor] model download failed (${err.message}).`);
    console.warn('[vendor] The app will try the CDN at runtime. Copy pose_landmarker_full.task into public/models to run offline.');
  }
} else {
  console.log('[vendor] pose model already present');
}
