/**
 * 3D Ten-Pin Bowling Alley Environment.
 * 
 * Includes:
 * - Hardwood maple bowling lane with plank textures and oil sheen
 * - Foul line, approach area, and target chevron arrows
 * - Concave left and right gutter channels
 * - Rear pit with shock-absorbing cushion
 * - Overhead pinsetter hood with glowing neon banner and downlight spotlight
 */
import * as THREE from '/vendor/three/three.module.js';
import { addSky, addLights, canvasTexture, disposeObject } from './environments.js';

export function buildBowlingAlley() {
  const scene = new THREE.Scene();
  addSky(scene, 0x05040d, 0x0f0c24);
  addLights(scene, { key: 0xffedd5, ambient: 0x1e1b4b, keyIntensity: 3.2, ambientIntensity: 0.7 });

  const LANE_W = 1.08;
  const LANE_L = 19.5;
  const LANE_Y = 0.05;
  const GUTTER_W = 0.24;

  // Hall carpet floor
  const carpetTex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0a0916';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.06)';
    for (let i = 0; i < 400; i++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.08)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.strokeRect(i * 90, i * 90, 80, 80);
    }
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 50),
    new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.01, -8);
  scene.add(floor);

  // Hardwood maple bowling lane
  const laneTex = canvasTexture(512, 2048, (ctx, w, h) => {
    const numPlanks = 39;
    const plankW = w / numPlanks;
    for (let i = 0; i < numPlanks; i++) {
      const shade = 215 + Math.floor(Math.sin(i * 1.7) * 22) + Math.floor((Math.random() - 0.5) * 12);
      ctx.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.88)}, ${Math.floor(shade * 0.72)})`;
      ctx.fillRect(i * plankW, 0, plankW, h);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(i * plankW, 0, 1, h);
    }

    // Foul line (at bottom of canvas = z: 0)
    const foulY = h * 0.88;
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, foulY, w, 8);

    // Target arrows (7 chevron arrows down the lane at z ~ -4.5)
    const arrowY = h * 0.65;
    ctx.fillStyle = '#b45309';
    for (let i = 0; i < 7; i++) {
      const ax = w * (0.15 + i * 0.116);
      ctx.beginPath();
      ctx.moveTo(ax, arrowY - 24);
      ctx.lineTo(ax - 8, arrowY + 12);
      ctx.lineTo(ax, arrowY + 4);
      ctx.lineTo(ax + 8, arrowY + 12);
      ctx.closePath();
      ctx.fill();
    }

    // Pin deck guide spots at head of lane
    const pinY = h * 0.08;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(w / 2, pinY, 10, 0, Math.PI * 2);
    ctx.fill();
  });

  const laneMat = new THREE.MeshStandardMaterial({
    map: laneTex,
    roughness: 0.18,
    metalness: 0.05,
  });
  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_W, 0.1, LANE_L),
    laneMat
  );
  lane.position.set(0, LANE_Y, -LANE_L / 2 + 1.5);
  lane.receiveShadow = true;
  scene.add(lane);

  // Approach area (where bowler stands, z: 0 to 4.5)
  const approachMat = new THREE.MeshStandardMaterial({
    color: 0xdeb887,
    roughness: 0.45,
    metalness: 0.08,
  });
  const approach = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_W + 0.8, 0.1, 4.2),
    approachMat
  );
  approach.position.set(0, LANE_Y, 3.6);
  approach.receiveShadow = true;
  scene.add(approach);

  // Gutters (left and right channels)
  const gutterMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.55,
    metalness: 0.35,
  });
  const leftGutter = new THREE.Mesh(
    new THREE.BoxGeometry(GUTTER_W, 0.05, LANE_L),
    gutterMat
  );
  leftGutter.position.set(-LANE_W / 2 - GUTTER_W / 2, LANE_Y - 0.025, -LANE_L / 2 + 1.5);
  scene.add(leftGutter);

  const rightGutter = leftGutter.clone();
  rightGutter.position.x = LANE_W / 2 + GUTTER_W / 2;
  scene.add(rightGutter);

  // Outer lane division rails / bumpers
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.3, metalness: 0.6 });
  const leftBumper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, LANE_L, 12), bumperMat);
  leftBumper.rotation.x = Math.PI / 2;
  leftBumper.position.set(-LANE_W / 2 - GUTTER_W - 0.04, LANE_Y + 0.04, -LANE_L / 2 + 1.5);
  scene.add(leftBumper);

  const rightBumper = leftBumper.clone();
  rightBumper.position.x = LANE_W / 2 + GUTTER_W + 0.04;
  scene.add(rightBumper);

  // Pin Deck back pit & shock absorbing cushion
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9, metalness: 0.1 });
  const pitCushion = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + 0.6, 1.2, 0.25), pitMat);
  pitCushion.position.set(0, 0.6, -19.5);
  scene.add(pitCushion);

  // Overhead Pinsetter Hood & Neon Scoreboard
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.25, metalness: 0.7 });
  const hood = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + 1.2, 0.8, 1.6), hoodMat);
  hood.position.set(0, 2.1, -18.2);
  scene.add(hood);

  // Neon bowling banner on pinsetter
  const neonMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.05), neonMat);
  sign.position.set(0, 2.1, -17.35);
  scene.add(sign);

  // Pin deck spotlight
  const pinSpot = new THREE.SpotLight(0xfffbeb, 6.0, 12, Math.PI / 5, 0.4);
  pinSpot.position.set(0, 3.8, -16.5);
  pinSpot.target.position.set(0, 0.1, -18.2);
  scene.add(pinSpot);
  scene.add(pinSpot.target);

  return {
    scene,
    camera: { pos: [0, 1.95, 5.2], look: [0, 0.45, -12.0], fov: 45 },
    lane: { y: LANE_Y, width: LANE_W, length: LANE_L, pinDeckZ: -18.2 },
    update(dt, t) {
      const pulse = 0.5 + Math.sin(t * 3.0) * 0.5;
      neonMat.emissiveIntensity = 1.4 + pulse * 1.2;
    },
    dispose() {
      disposeObject(scene);
    },
  };
}
