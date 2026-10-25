/**
 * Batch Dance Move Baker
 *
 * Automatically scans public/models/dance/*.fbx,
 * extracts 33 MediaPipe landmarks across time at 30 FPS,
 * and saves them as ready-to-play move definitions in public/assets/dance/moves/*.json.
 */
import fs from 'fs';
import path from 'path';

globalThis.window = globalThis;
globalThis.document = {
  createElement: () => ({ getContext: () => null }),
};

const DANCE_DIR = path.resolve('public/models/dance');
const OUT_DIR = path.resolve('public/assets/dance/moves');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function run() {
  const THREE = await import('../public/vendor/three/three.module.js');
  const { FBXLoader } = await import('../public/vendor/three/FBXLoader.js');
  const mc = await import('../public/src/shared/mocapConverter.js');

  const files = fs.readdirSync(DANCE_DIR).filter((f) => f.toLowerCase().endsWith('.fbx'));
  console.log(`Found ${files.length} FBX files in ${DANCE_DIR}`);

  const styleMap = [
    { match: /samba/i, style: 'samba', bpm: 116, tip: 'Roll your hips to the Latin groove!' },
    { match: /rumba/i, style: 'samba', bpm: 110, tip: 'Smooth Cuban motion and hip sways!' },
    { match: /can can/i, style: 'groove', bpm: 124, tip: 'High kicks and energetic rhythm!' },
    { match: /jazz/i, style: 'disco', bpm: 122, tip: 'Crisp body lines and fluid turns!' },
    { match: /bboy|breakdance|uprock/i, style: 'robot', bpm: 132, tip: 'Sharp breakdance locks and attitude!' },
    { match: /running man|shuffle|shuffling/i, style: 'disco', bpm: 128, tip: 'Slide and pump your feet to the beat!' },
    { match: /thriller/i, style: 'groove', bpm: 118, tip: 'Zombie bounce and zombie arms!' },
    { match: /tut/i, style: 'robot', bpm: 130, tip: 'Geometric 90-degree arm angles!' },
    { match: /snake/i, style: 'groove', bpm: 125, tip: 'Body wave from head to hips!' },
    { match: /hip hop/i, style: 'groove', bpm: 120, tip: 'Bounce deep into the pocket!' },
    { match: /step/i, style: 'disco', bpm: 124, tip: 'Step and groove with the coach!' },
  ];

  for (const file of files) {
    try {
      const filePath = path.join(DANCE_DIR, file);
      const buf = fs.readFileSync(filePath);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

      const loader = new FBXLoader();
      const fbx = loader.parse(ab, '');
      const clip = fbx.animations?.[0];

      if (!clip || clip.duration <= 0) {
        console.warn(`Skipping ${file}: No valid animation clip.`);
        continue;
      }

      const baseName = path.basename(file, '.fbx');
      const cleanId = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const titleName = baseName.toUpperCase();

      let styleInfo = styleMap.find((s) => s.match.test(baseName)) || {
        style: 'groove',
        bpm: 120,
        tip: 'Follow the coach center stage!',
      };

      const bpm = styleInfo.bpm;
      const beats = 4;
      const beatSec = 60 / bpm;
      const durationSec = beats * beatSec;
      const sampleFps = 30;
      const totalFrames = Math.round(durationSec * sampleFps);

      const mixer = new THREE.AnimationMixer(fbx);
      const action = mixer.clipAction(clip);
      action.play();

      const frames = [];
      for (let i = 0; i < totalFrames; i++) {
        const t = (i / sampleFps);
        const animTime = t % clip.duration;
        mixer.setTime(animTime);
        fbx.updateMatrixWorld(true);

        const lm = mc.convertSkeletonToLandmarks(fbx, {
          targetShoulderWidth: 0.18,
          centerX: 0.5,
          centerY: 0.55,
          mirror: true,
        });

        const features = mc.extractDanceFeatures(lm);
        frames.push({
          t: Number(t.toFixed(4)),
          landmarks: lm,
          features,
        });
      }

      const moveData = {
        id: `mocap_${cleanId}`,
        name: titleName,
        style: styleInfo.style,
        bpm,
        beats,
        tip: styleInfo.tip,
        useBakedFrames: true,
        sourceFbx: file,
        frames,
      };

      const outPath = path.join(OUT_DIR, `${cleanId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(moveData));
      console.log(`✓ Baked [${titleName}] -> ${cleanId}.json (${frames.length} frames, ${styleInfo.style}, ${bpm} BPM)`);
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }

  console.log('All dance moves baked successfully!');
}

run().catch(console.error);
