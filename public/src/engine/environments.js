/** Procedural game worlds. Everything is generated at runtime. */
export { buildBowlingAlley } from './bowlingEnv.js';
export { buildArcheryRange } from './archeryEnv.js';
export { canvasTexture, addSky, addLights, disposeObject };
import * as THREE from '/vendor/three/three.module.js';
import { canvasTexture, addSky, addLights, makeCrowd, makeStands, bar, labelTexture, disposeObject, setShadow } from './envkit.js';
import { mulberry32 } from '../shared/math.js';

/* ------------------------------------------------------------------ */
/* Boxing arena                                                        */
/* ------------------------------------------------------------------ */
export function buildArena() {
  const scene = new THREE.Scene();
  addSky(scene, 0x05060f, 0x0d1428);
  addLights(scene, { key: 0xffe9c4, ambient: 0x2a3a66, keyIntensity: 3.2, ambientIntensity: 0.6 });

  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(6.9, 7.3, 0.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.85, metalness: 0.2 })
  );
  apron.position.y = -0.25;
  apron.receiveShadow = true;
  scene.add(apron);

  const matTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#1b2a4a');
    g.addColorStop(0.7, '#101a30');
    g.addColorStop(1, '#070b16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(34,211,238,0.55)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244,114,182,0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(248,250,252,0.9)';
    ctx.font = 'bold 86px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AR FAMILY', w / 2, h / 2 - 12);
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(34,211,238,0.9)';
    ctx.fillText('FIGHT NIGHT', w / 2, h / 2 + 62);
  });
  const mat = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 64),
    new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.72, metalness: 0.15 })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.012;
  mat.receiveShadow = true;
  scene.add(mat);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.8 });
  const ropeMats = [
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 0.9, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x64748b, emissiveIntensity: 0.4, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: 0.9, roughness: 0.3 }),
  ];
  const corners = [
    new THREE.Vector3(-4.8, 0, -4.8),
    new THREE.Vector3(4.8, 0, -4.8),
    new THREE.Vector3(4.8, 0, 4.8),
    new THREE.Vector3(-4.8, 0, 4.8),
  ];
  for (const c of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.7, 12), postMat);
    post.position.set(c.x, 0.85, c.z);
    post.castShadow = true;
    scene.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), ropeMats[0]);
    cap.position.set(c.x, 1.72, c.z);
    scene.add(cap);
  }
  for (let level = 0; level < 3; level++) {
    const y = 0.55 + level * 0.42;
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      scene.add(bar(new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(b.x, y, b.z), 0.045, ropeMats[level]));
    }
  }

  const truss = new THREE.Mesh(
    new THREE.TorusGeometry(8.5, 0.14, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.9 })
  );
  truss.rotation.x = -Math.PI / 2;
  truss.position.y = 8.4;
  scene.add(truss);
  for (const [x, z] of [[-8.5, 0], [8.5, 0], [0, -8.5], [0, 8.5]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8.4, 8), truss.material);
    tower.position.set(x, 4.2, z);
    scene.add(tower);
  }

  const spotGroup = new THREE.Group();
  const spotMat = new THREE.MeshBasicMaterial({
    color: 0x9fe8ff,
    transparent: true,
    opacity: 0.055,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 4; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 8, 20, 1, true), spotMat);
    const a = (i / 4) * Math.PI * 2 + 0.4;
    cone.position.set(Math.cos(a) * 4.2, 4.2, Math.sin(a) * 4.2);
    cone.rotation.z = Math.cos(a) * 0.25;
    cone.rotation.x = -Math.sin(a) * 0.25;
    spotGroup.add(cone);
    const lamp = new THREE.PointLight(i % 2 ? 0xf472b6 : 0x22d3ee, 30, 18, 2);
    lamp.position.set(Math.cos(a) * 5.2, 7.6, Math.sin(a) * 5.2);
    scene.add(lamp);
  }
  scene.add(spotGroup);

  scene.add(makeCrowd({ count: 380, x: [-18, 18], z: [-16, 16], y: [1.0, 5.2], exclude: 9 }));
  const backGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 9),
    new THREE.MeshBasicMaterial({ color: 0x0a1630, transparent: true, opacity: 0.85 })
  );
  backGlow.position.set(0, 5, -17);
  scene.add(backGlow);

  return {
    scene,
    camera: { pos: [0, 2.5, 8.6], look: [0, 1.15, 0] },
    update(dt, t) {
      spotGroup.rotation.y = Math.sin(t * 0.12) * 0.25;
    },
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tennis court                                                        */
/* ------------------------------------------------------------------ */
export function buildCourt() {
  const scene = new THREE.Scene();
  addSky(scene, 0x081428, 0x2c6c9e);
  addLights(scene, { key: 0xfff4e0, ambient: 0x335577, keyIntensity: 2.8 });

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 24),
    new THREE.MeshStandardMaterial({ color: 0x123a33, roughness: 0.95 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.02;
  surround.receiveShadow = true;
  scene.add(surround);

  const courtTex = canvasTexture(1200, 560, (ctx, w, h) => {
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 8;
    // outer doubles court
    ctx.strokeRect(60, 50, w - 120, h - 100);
    // singles
    ctx.strokeRect(60, 96, w - 120, h - 192);
    // net line
    ctx.beginPath();
    ctx.moveTo(w / 2, 40);
    ctx.lineTo(w / 2, h - 40);
    ctx.stroke();
    // service lines + centre
    for (const x of [w * 0.27, w * 0.73]) {
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x, h - 96);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h / 2);
    ctx.lineTo(w * 0.73, h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(248,250,252,0.65)';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AR FAMILY OPEN', w / 2, 40);
  });
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 13),
    new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.85 })
  );
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.01;
  court.receiveShadow = true;
  scene.add(court);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.8 });
  for (const z of [-6.5, 6.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.35, 10), postMat);
    post.position.set(0, 0.67, z);
    post.castShadow = true;
    scene.add(post);
  }
  const netTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(226,232,240,0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 16) * w, 0);
      ctx.lineTo((i / 16) * w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i / 16) * h);
      ctx.lineTo(w, (i / 16) * h);
      ctx.stroke();
    }
  });
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 1.05),
    new THREE.MeshStandardMaterial({ map: netTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.8 })
  );
  net.rotation.y = Math.PI / 2;
  net.position.set(0, 0.55, 0);
  scene.add(net);

  const standsL = makeStands({ length: 30, z: 11, side: 1, rows: 4 });
  standsL.rotation.y = Math.PI / 2;
  standsL.position.x = 3;
  const standsR = standsL.clone();
  standsR.rotation.y = -Math.PI / 2;
  standsR.position.x = -3;
  // A stand behind the far baseline anchors the back-row spectators.
  const farStand = makeStands({ length: 34, z: -18, side: 1, rows: 4 });
  scene.add(standsL, standsR, farStand);
  // Keep spectators beside and beyond the court, never floating over the
  // playing surface (the camera looks across the court from the near sideline).
  scene.add(makeCrowd({ count: 160, x: [14, 22], z: [-16, 16], y: [1.2, 4.8] }));
  scene.add(makeCrowd({ count: 160, x: [-22, -14], z: [-16, 16], y: [1.2, 4.8] }));
  scene.add(makeCrowd({ count: 110, x: [-16, 16], z: [-21, -14.6], y: [1.2, 4.8] }));

  return {
    scene,
    camera: { pos: [0, 6.4, 15.5], look: [0, 0.6, 0] },
    update() {},
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Running track / hurdles                                             */
/* ------------------------------------------------------------------ */
export function buildTrack({ finish = 60, hurdles = null, laneCount = 4 } = {}) {
  const scene = new THREE.Scene();
  addSky(scene, 0x08142c, 0x2f6b9e);
  addLights(scene, { key: 0xfff1d6, ambient: 0x335577, keyIntensity: 2.7 });

  const trackLen = Math.max(160, finish + 50);
  const trackCenterX = (finish + 10) / 2;

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(trackLen + 80, 80),
    new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.95 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(trackCenterX, -0.03, -18);
  grass.receiveShadow = true;
  scene.add(grass);

  const trackTex = canvasTexture(2048, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#b91c1c');
    g.addColorStop(0.5, '#dc2626');
    g.addColorStop(1, '#991b1b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(42);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.09})`;
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 4, 1 + rand() * 2);
    }
    ctx.strokeStyle = 'rgba(248,250,252,0.92)';
    ctx.lineWidth = 5;
    for (let i = 0; i <= laneCount; i++) {
      const y = (i / laneCount) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // start / finish blocks
    ctx.fillStyle = 'rgba(248,250,252,0.9)';
    ctx.fillRect(w * 0.02, 0, 8, h);
    ctx.fillRect(w - 10, 0, 8, h);
    ctx.fillStyle = 'rgba(248,250,252,0.18)';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(w * 0.02 + i * 8, 0, 4, h);
    }
    ctx.fillStyle = 'rgba(248,250,252,0.14)';
    for (let i = 0; i < 8; i++) ctx.fillRect(w - 10 + i * 1.2, 0, 0.6, h);
  });
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(trackLen, 12),
    new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.9 })
  );
  track.rotation.x = -Math.PI / 2;
  track.position.set(trackCenterX, 0.005, 0);
  track.receiveShadow = true;
  scene.add(track);

  // finish banner
  const bannerTex = canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 74px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', w / 2, h / 2 + 3);
  });
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 1.9),
    new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0x0b2a3a, emissiveIntensity: 0.6, side: THREE.DoubleSide })
  );
  banner.position.set(finish + 1.5, 4.6, 0);
  scene.add(banner);
  for (const z of [-6.2, 6.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 }));
    pole.position.set(finish + 1.5, 2.3, z);
    scene.add(pole);
  }

  const hurdleGroup = new THREE.Group();
  if (hurdles && hurdles.length) {
    const hMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.4 });
    for (const hx of hurdles) {
      for (let lane = 0; lane < laneCount; lane++) {
        const z = (lane - (laneCount - 1) / 2) * 2.1;
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 1.7), hMat);
        top.position.set(hx, 0.95, z);
        top.castShadow = true;
        hurdleGroup.add(top);
        for (const dz of [-0.75, 0.75]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), legMat);
          leg.position.set(hx, 0.5, z + dz);
          hurdleGroup.add(leg);
        }
      }
    }
  }
  scene.add(hurdleGroup);

  const boardTex = labelTexture('AR FAMILY GAMES', { border: '#22d3ee', w: 1024, h: 192, font: 'bold 84px system-ui' });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 4.1),
    new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0x0a2233, emissiveIntensity: 0.7 })
  );
  board.position.set(finish * 0.55, 8.5, -21);
  scene.add(board);
  for (const x of [finish * 0.55 - 8, finish * 0.55 + 8]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8.5, 8), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 }));
    leg.position.set(x, 4.25, -21.2);
    scene.add(leg);
  }

  // Keep the near side of the track clear: the chase camera lives around
  // z = +12, so a second crowd there would fill the lens with giant spheres.
  scene.add(makeStands({ length: trackLen + 40, z: -14, side: 1, rows: 5 }));
  scene.add(makeCrowd({ count: 360, x: [-20, finish + 40], z: [-24, -13], y: [1.0, 5.2], exclude: 0 }));

  return {
    scene,
    finish,
    hurdleGroup,
    camera: { pos: [8, 3.4, 12], look: [10, 1.0, 0] },
    update() {},
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lake / rowing                                                       */
/* ------------------------------------------------------------------ */
export function buildLake() {
  const scene = new THREE.Scene();
  addSky(scene, 0x241a4a, 0xff9a6b, 340);
  scene.fog = new THREE.FogExp2(0xd98a6a, 0.006);
  addLights(scene, { key: 0xffd9b0, ambient: 0x4a3a6a, keyIntensity: 2.2, ambientIntensity: 0.7 });

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(14, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd8a8 })
  );
  sun.position.set(-90, 34, -190);
  scene.add(sun);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(28, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xff9a6b, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.position.copy(sun.position);
  scene.add(glow);

  const waterGeo = new THREE.PlaneGeometry(330, 120, 120, 48);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0e7490,
    roughness: 0.34,
    metalness: 0.38,
    transparent: true,
    opacity: 0.96,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(60, -0.05, 0);
  water.receiveShadow = true;
  scene.add(water);
  const base = Float32Array.from(waterGeo.attributes.position.array);

  const islandMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.95 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
  const rand = mulberry32(7);
  for (let i = 0; i < 9; i++) {
    const x = -80 + rand() * 300;
    const z = -90 - rand() * 90;
    const r = 6 + rand() * 14;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.7, 7), rockMat);
    rock.position.set(x, r * 0.2, z);
    scene.add(rock);
    const top = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 8, 6), islandMat);
    top.position.set(x, r * 0.5, z);
    top.scale.y = 0.35;
    scene.add(top);
  }

  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x2b2440, roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const x = -140 + i * 24 + rand() * 12;
    const h = 26 + rand() * 34;
    const m = new THREE.Mesh(new THREE.ConeGeometry(22 + rand() * 16, h, 5), mountainMat);
    m.position.set(x, h / 2 - 2, -210 - rand() * 40);
    scene.add(m);
  }

  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffd6c0, transparent: true, opacity: 0.55, roughness: 1 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 8, 10, 6), cloudMat);
    c.position.set(-150 + rand() * 320, 34 + rand() * 22, -120 - rand() * 90);
    c.scale.y = 0.32;
    clouds.add(c);
  }
  scene.add(clouds);

  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x92400e, emissiveIntensity: 0.4, roughness: 0.5 });
  // Keep the lane markers inside the water plane and all the way to the finish.
  for (let lane = 0; lane < 5; lane++) {
    for (let i = 0; i < 11; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 8), buoyMat);
      b.position.set(-8 + i * 20, 0.2, (lane - 2) * 5.5);
      scene.add(b);
    }
  }

  const dockMat = new THREE.MeshStandardMaterial({ color: 0x5b3a29, roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 7.5), dockMat);
    plank.position.set(-14 + i * 1.1, 0.35, 0);
    scene.add(plank);
  }

  return {
    scene,
    water,
    camera: { pos: [10, 4.4, 17], look: [12, 0.8, 0] },
    update(dt, t) {
      const pos = waterGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        pos.array[i * 3 + 2] =
          Math.sin(x * 0.12 + t * 1.4) * 0.22 +
          Math.cos(y * 0.18 + t * 1.1) * 0.18 +
          Math.sin((x + y) * 0.07 + t * 0.7) * 0.12;
      }
      pos.needsUpdate = true;
      waterGeo.computeVertexNormals();
      clouds.position.x = Math.sin(t * 0.01) * 6;
    },
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Roller coaster world                                                */
/* ------------------------------------------------------------------ */
export function buildCoasterWorld() {
  const scene = new THREE.Scene();
  addSky(scene, 0x1a1035, 0xff7a59, 420);
  scene.fog = new THREE.FogExp2(0x3a2a55, 0.0045);
  addLights(scene, { key: 0xffd0a0, ambient: 0x4a3a7a, keyIntensity: 2.4, ambientIntensity: 0.65 });

  const terrainGeo = new THREE.PlaneGeometry(420, 420, 90, 90);
  const pos = terrainGeo.attributes.position;
  const colors = [];
  const cLow = new THREE.Color(0x1a4528);
  const cMid = new THREE.Color(0x2d5a32);
  const cHigh = new THREE.Color(0x6e624c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Valley terrain safely below coaster track (max height -0.5m)
    const h =
      Math.sin(x * 0.015) * Math.cos(y * 0.012) * 1.6 +
      Math.sin(x * 0.035 + 1.3) * Math.cos(y * 0.028) * 0.8 - 2.8;
    pos.setZ(i, h);
    const c = cLow.clone().lerp(cMid, Math.min(1, (h + 4.5) / 3)).lerp(cHigh, Math.max(0, (h + 1.5) / 2.5));
    colors.push(c.r, c.g, c.b);
  }
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = 0;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Thrilling Theme-Park Roller Coaster Track:
  // Starts with slow chain-lift climb, grand summit drop, high-G banked hairpin turns,
  // camelback airtime bunny hill, 360 helix spiral, obstacle gauntlet, and chicane S-curves.
  // All points stay safely elevated between 7.2m and 34.0m (never clips the ground).
  const points = [
    // 1. Station & Slow Chain-Lift Climb (u = 0.00 to 0.22)
    [0, 8.0, 16],          // Station departure
    [12, 10.5, 6],         // Turn out of station
    [22, 15.0, -10],       // Chain lift climb
    [32, 23.0, -28],       // Steep ascent
    [40, 34.0, -50],       // Summit crest (Peak!)

    // 2. The Mega First Drop & Right Banked Hairpin (u = 0.23 to 0.42)
    [36, 18.0, -78],       // Plunging down 60-degree first drop!
    [24, 7.5, -95],        // Bottom of the drop (Maximum speed & G-force!)
    [2, 9.0, -105],        // Sweeping right turn
    [-22, 14.0, -96],      // High banked hairpin turn (swivel right!)

    // 3. Camelback Airtime Hill & Left Banked Drop (u = 0.43 to 0.62)
    [-38, 22.5, -74],      // Crest of Camelback Hill (Floating airtime!)
    [-46, 8.0, -48],       // Steep dive to the left
    [-52, 9.5, -20],       // Sweeping high-speed left curve (swivel left!)
    [-42, 13.0, 10],       // Banking left turn

    // 4. Helix Spiral & Obstacle Trench (u = 0.63 to 0.82)
    [-24, 18.0, 32],       // Rising curve
    [-2, 12.0, 42],        // Helix descent (obstacles: DUCK & JUMP!)
    [18, 7.2, 38],         // Lake trestle bridge

    // 5. Chicane S-Curves & Station Approach (u = 0.83 to 1.00)
    [28, 9.0, 24],         // Quick right flip
    [16, 8.0, 20],         // Brake run entry
  ].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  const samples = curve.getSpacedPoints(380);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const railA = [];
  const railB = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const t = curve.getTangentAt(i / samples.length).normalize();
    right.crossVectors(t, up).normalize().multiplyScalar(0.52);
    railA.push(p.clone().add(right));
    railB.push(p.clone().sub(right));
  }
  const railCurveA = new THREE.CatmullRomCurve3(railA, true, 'catmullrom', 0.5);
  const railCurveB = new THREE.CatmullRomCurve3(railB, true, 'catmullrom', 0.5);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8, roughness: 0.35, emissive: 0x3a1d00, emissiveIntensity: 0.4 });
  const railGeoA = new THREE.TubeGeometry(railCurveA, 420, 0.11, 8, true);
  const railGeoB = new THREE.TubeGeometry(railCurveB, 420, 0.11, 8, true);
  scene.add(new THREE.Mesh(railGeoA, railMat), new THREE.Mesh(railGeoB, railMat));

  const tieMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 });
  const tieGeo = new THREE.BoxGeometry(1.25, 0.09, 0.24);
  const ties = new THREE.InstancedMesh(tieGeo, tieMat, Math.ceil(samples.length / 3));
  const dummy = new THREE.Object3D();
  let tieIdx = 0;
  for (let i = 0; i < samples.length; i += 3) {
    const p = samples[i];
    const t = curve.getTangentAt(i / samples.length).normalize();
    dummy.position.copy(p);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
    dummy.updateMatrix();
    ties.setMatrixAt(tieIdx++, dummy.matrix);
  }
  ties.count = tieIdx;
  ties.instanceMatrix.needsUpdate = true;
  scene.add(ties);

  const supportMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.5 });
  for (let i = 0; i < samples.length; i += 12) {
    const p = samples[i];
    const pillarH = p.y + 1.0;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, pillarH, 8), supportMat);
    leg.position.set(p.x, (p.y - 1.0) / 2, p.z);
    scene.add(leg);
  }

  const treeTrunk = new THREE.MeshStandardMaterial({ color: 0x4b2e1a, roughness: 1 });
  const treeLeaf = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.9 });
  const rand = mulberry32(99);
  const trees = new THREE.Group();
  for (let i = 0; i < 120; i++) {
    const x = (rand() - 0.5) * 260;
    const z = (rand() - 0.5) * 260;
    if (Math.hypot(x, z) < 30) continue;
    const h = 3 + rand() * 4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, h * 0.5, 6), treeTrunk);
    trunk.position.set(x, h * 0.25, z);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(h * 0.34, h, 7), treeLeaf);
    leaf.position.set(x, h * 0.8, z);
    trees.add(trunk, leaf);
  }
  scene.add(trees);

  const station = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x5b3a29, roughness: 0.9 }));
  platform.position.set(0, 7.3, 16);
  station.add(platform);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.7 }));
  roof.position.set(0, 11.5, 16);
  station.add(roof);
  for (const x of [-5, 5]) {
    for (const z of [12, 20]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 6), supportMat);
      post.position.set(x, 9.4, z);
      station.add(post);
    }
  }
  scene.add(station);

  return {
    scene,
    curve,
    camera: { pos: [0, 5, 12], look: [0, 2, 0] },
    update(dt, t) {
      trees.rotation.y = 0;
    },
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Balling / pool hall                                                 */
/* ------------------------------------------------------------------ */
export function buildBallingHall() {
  const scene = new THREE.Scene();
  addSky(scene, 0x03060c, 0x0b1422);
  addLights(scene, { key: 0xfff0d0, ambient: 0x1b2a44, keyIntensity: 2.8, ambientIntensity: 0.55 });

  const TABLE_Y = 0.92;
  const W = 6.4;
  const L = 10.4;

  const carpet = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(34,211,238,${0.015 + Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.strokeStyle = 'rgba(34,211,238,0.08)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 40 + i * 28, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46),
    new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);

  // Felt bed.
  const feltTex = canvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0d6b4c');
    g.addColorStop(0.5, '#0b5a41');
    g.addColorStop(1, '#084433');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(W, 0.16, L),
    new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.88, metalness: 0.02 })
  );
  felt.position.y = TABLE_Y - 0.08;
  felt.receiveShadow = true;
  scene.add(felt);

  const wood = new THREE.MeshStandardMaterial({ color: 0x3a1e12, roughness: 0.45, metalness: 0.18 });
  const railH = 0.2;
  const railW = 0.34;
  const rails = [
    { geo: [W + railW * 2, railH, railW], pos: [0, TABLE_Y + 0.02, -L / 2 - railW / 2] },
    { geo: [W + railW * 2, railH, railW], pos: [0, TABLE_Y + 0.02, L / 2 + railW / 2] },
    { geo: [railW, railH, L + railW * 2], pos: [-W / 2 - railW / 2, TABLE_Y + 0.02, 0] },
    { geo: [railW, railH, L + railW * 2], pos: [W / 2 + railW / 2, TABLE_Y + 0.02, 0] },
  ];
  for (const r of rails) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...r.geo), wood);
    mesh.position.set(...r.pos);
    mesh.castShadow = true;
    scene.add(mesh);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, TABLE_Y - 0.1, 0.3), wood);
      leg.position.set(sx * (W / 2 - 0.55), (TABLE_Y - 0.1) / 2, sz * (L / 2 - 0.75));
      leg.castShadow = true;
      scene.add(leg);
    }
  }

  // Pockets: corner + middle.
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x01040a, roughness: 0.5, metalness: 0.2 });
  const pocketRim = new THREE.MeshStandardMaterial({ color: 0xd4a35f, roughness: 0.35, metalness: 0.7 });
  const pockets = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 24), pocketMat);
      p.position.set(sx * (W / 2 - 0.06), TABLE_Y + 0.02, sz * (L / 2 - 0.06));
      scene.add(p);
      pockets.push({ x: p.position.x, z: p.position.z });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 28), pocketRim);
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(p.position.x, TABLE_Y + 0.05, p.position.z);
      scene.add(rim);
    }
  }
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 24), pocketMat);
    p.position.set(sx * (W / 2 - 0.04), TABLE_Y + 0.02, 0);
    scene.add(p);
    pockets.push({ x: p.position.x, z: p.position.z });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.024, 8, 28), pocketRim);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.position.x, TABLE_Y + 0.05, p.position.z);
    scene.add(rim);
  }

  // Table markings: head string + centre spot.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd9f99d, transparent: true, opacity: 0.32 });
  const headLine = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.008, 0.035), lineMat);
  headLine.position.set(0, TABLE_Y + 0.006, 2.6);
  scene.add(headLine);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 18), lineMat);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, TABLE_Y + 0.006, -2.0);
  scene.add(spot);

  // Overhead light bar.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xfff0c8,
    emissiveIntensity: 1.6,
    roughness: 0.35,
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 2.0), lampMat);
  lamp.position.set(0, 5.3, -0.3);
  scene.add(lamp);
  const lampCordMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
  for (const x of [-1.8, 1.8]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.8, 6), lampCordMat);
    cord.position.set(x, 6.7, -0.3);
    scene.add(cord);
  }
  const keyLight = new THREE.PointLight(0xffe7bd, 45, 22, 2);
  keyLight.position.set(0, 4.6, 0);
  scene.add(keyLight);
  const fill = new THREE.PointLight(0x22d3ee, 18, 18, 2);
  fill.position.set(-5, 3.2, 4);
  scene.add(fill);
  const fill2 = new THREE.PointLight(0xf472b6, 16, 18, 2);
  fill2.position.set(5, 3.0, 3);
  scene.add(fill2);

  // Neon back wall.
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 12),
    new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 0.95, metalness: 0.05 })
  );
  wall.position.set(0, 5.2, -11);
  scene.add(wall);
  const signTex = labelTexture('BALLING', { border: '#34d399', w: 1024, h: 256, font: 'bold 120px system-ui' });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 1.7),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
  );
  sign.position.set(0, 4.6, -10.85);
  scene.add(sign);
  const neonMat = new THREE.MeshStandardMaterial({
    color: 0x34d399,
    emissive: 0x34d399,
    emissiveIntensity: 1.8,
    roughness: 0.3,
  });
  for (const x of [-4.8, 4.8]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5.5, 0.08), neonMat);
    strip.position.set(x, 2.9, -10.7);
    scene.add(strip);
  }

  scene.add(makeCrowd({ count: 90, x: [-11, 11], z: [-10.5, -8.4], y: [0.9, 3.4], exclude: 8 }));

  return {
    scene,
    camera: { pos: [0, 9.6, 15.2], look: [0, 0.9, -0.5], fov: 42 },
    table: { y: TABLE_Y, width: W, length: L, pockets },
    update(dt, t) {
      const pulse = 0.5 + Math.sin(t * 2.2) * 0.5;
      neonMat.emissiveIntensity = 1.2 + pulse * 1.5;
      lampMat.emissiveIntensity = 1.25 + Math.sin(t * 13.7) * 0.03;
      keyLight.intensity = 42 + Math.sin(t * 7.3) * 3;
    },
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Dance club                                                          */
/* ------------------------------------------------------------------ */
export function buildDanceClub() {
  const scene = new THREE.Scene();
  addSky(scene, 0x05020c, 0x120a24);
  addLights(scene, { key: 0xffd7f7, ambient: 0x2a1644, keyIntensity: 2.4, ambientIntensity: 0.65 });

  const floorTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.52);
    g.addColorStop(0, '#2a1250');
    g.addColorStop(0.55, '#160b2d');
    g.addColorStop(1, '#07030f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(34,211,238,0.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 16; i++) {
      const p = (i / 16) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(244,114,182,0.55)' : 'rgba(34,211,238,0.55)';
      ctx.lineWidth = 7 - i;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 100 + i * 82, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(248,250,252,0.85)';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DANCE FLOOR', w / 2, h / 2 - 8);
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,114,182,0.9)';
    ctx.fillText('FOLLOW THE COACH', w / 2, h / 2 + 52);
  });
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.8, 72),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.28,
      metalness: 0.55,
      emissive: 0x1a0b35,
      emissiveIntensity: 0.42,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.8,
    roughness: 0.3,
    metalness: 0.7,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.7, 0.045, 8, 96), rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.06;
  scene.add(rim);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 2.9, 0.82, 48),
    new THREE.MeshStandardMaterial({ color: 0x0c0718, roughness: 0.35, metalness: 0.75 })
  );
  stage.position.set(0, 0.41, -2.4);
  scene.add(stage);
  const stageRim = new THREE.Mesh(
    new THREE.TorusGeometry(2.72, 0.035, 8, 72),
    new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xf472b6, emissiveIntensity: 2.2, roughness: 0.3 })
  );
  stageRim.rotation.x = -Math.PI / 2;
  stageRim.position.set(0, 0.83, -2.4);
  scene.add(stageRim);

  // Back wall + LED columns.
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 9),
    new THREE.MeshStandardMaterial({ color: 0x090512, roughness: 0.9, metalness: 0.1 })
  );
  wall.position.set(0, 4.4, -10.5);
  scene.add(wall);
  const ledColors = [0x22d3ee, 0xf472b6, 0xa78bfa, 0xfbbf24, 0x22d3ee];
  const leds = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: ledColors[i],
      emissive: ledColors[i],
      emissiveIntensity: 1.2,
      roughness: 0.4,
    });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.42, 5.2, 0.18), mat);
    led.position.set(-6 + i * 3, 3.4, -10.2);
    scene.add(led);
    leds.push(mat);
  }

  // Speakers.
  const speakerMat = new THREE.MeshStandardMaterial({ color: 0x08060e, roughness: 0.55, metalness: 0.45 });
  const speakerGlow = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.4, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.9), speakerMat);
    box.position.set(side * 6.1, 1.2, -3.2);
    box.rotation.y = -side * 0.22;
    scene.add(box);
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.27 - i * 0.045, 0.27 - i * 0.045, 0.05, 20), speakerGlow);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(side * 6.1, 1.75 - i * 0.5, -2.72);
      scene.add(cone);
    }
  }

  // Mirror ball + moving beams.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xdfe9ff, metalness: 1, roughness: 0.08, emissive: 0x334155, emissiveIntensity: 0.3 })
  );
  ball.position.set(0, 6.6, -2.2);
  scene.add(ball);
  const beamGroup = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x9fe8ff,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamLights = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 7.5, 18, 1, true), beamMat);
    cone.position.set(Math.cos(a) * 3.2, 4.1, Math.sin(a) * 3.2 - 1.5);
    cone.rotation.z = Math.cos(a) * 0.32;
    cone.rotation.x = -Math.sin(a) * 0.32;
    beamGroup.add(cone);
    const light = new THREE.PointLight(i % 2 ? 0xf472b6 : 0x22d3ee, 24, 15, 2);
    light.position.set(Math.cos(a) * 5.4, 6.8, Math.sin(a) * 4.2 - 2);
    scene.add(light);
    beamLights.push(light);
  }
  scene.add(beamGroup);

  scene.add(makeCrowd({ count: 220, x: [-10, 10], z: [-8, 2], y: [1.1, 4.4], exclude: 6.5 }));

  return {
    scene,
    camera: { pos: [0, 2.35, 8.4], look: [0, 1.15, -0.7], fov: 48 },
    update(dt, t) {
      beamGroup.rotation.y = t * 0.35;
      ball.rotation.y += dt * 0.4;
      const pulse = 0.85 + Math.sin(t * 4.8) * 0.35;
      rimMat.emissiveIntensity = 1.2 + pulse * 0.9;
      stageRim.material.emissiveIntensity = 1.4 + pulse * 1.2;
      for (let i = 0; i < leds.length; i++) {
        leds[i].emissiveIntensity = 0.7 + (Math.sin(t * 3.2 + i * 1.1) * 0.5 + 0.5) * 1.4;
      }
      for (let i = 0; i < beamLights.length; i++) {
        beamLights[i].intensity = 16 + (Math.sin(t * 4.8 + i) * 0.5 + 0.5) * 22;
      }
    },
    dispose() {
      disposeObject(scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Attract / menu world                                                */
/* ------------------------------------------------------------------ */
export function buildMenuWorld() {
  const scene = new THREE.Scene();
  addSky(scene, 0x04060f, 0x0a1226);
  addLights(scene, { key: 0x99ddff, ambient: 0x223355, keyIntensity: 1.4, ambientIntensity: 0.4 });

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1800 * 3);
  const rand = mulberry32(3);
  for (let i = 0; i < 1800; i++) {
    const r = 40 + rand() * 160;
    const a = rand() * Math.PI * 2;
    const y = (rand() - 0.35) * 80;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = y;
    starPos[i * 3 + 2] = Math.sin(a) * r - 30;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.35, transparent: true, opacity: 0.75, depthWrite: false })
  );
  scene.add(stars);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.4, metalness: 0.7 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);
  const grid = new THREE.GridHelper(28, 28, 0x1e4a66, 0x102a3a);
  grid.position.y = 0.01;
  scene.add(grid);

  return {
    scene,
    camera: { pos: [0, 3.2, 10], look: [0, 2.2, 0] },
    update(dt, t) {
      // Clean, static, distraction-free environment for avatars & menu UI
    },
    dispose() {
      disposeObject(scene);
    },
  };
}
