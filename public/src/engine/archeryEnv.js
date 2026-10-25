/**
 * Olympic Archery Range 3D Environment.
 * 
 * Features:
 * - Manicured grass field with Olympic distance markers (10m, 20m, 30m, 50m)
 * - Wooden target tripod stands with regulation 122cm 10-ring target faces
 * - Backstop safety netting
 * - Wind indicator flags that sway with real-time crosswind
 * - Perimeter stadium banners and natural outdoor lighting
 */
import * as THREE from '/vendor/three/three.module.js';

export function buildArcheryRange() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Bright open sky
  scene.fog = new THREE.FogExp2(0xcce7ff, 0.008);

  // Lighting: crisp outdoor afternoon sun
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3d703d, 0.75);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfffbe8, 1.25);
  sunLight.position.set(18, 30, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 120;
  const d = 35;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  // Field ground (lush green grass)
  const groundGeo = new THREE.PlaneGeometry(80, 160);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -50);
  ground.receiveShadow = true;
  scene.add(ground);

  // Shooting line turf runner
  const runnerGeo = new THREE.PlaneGeometry(8, 6);
  const runnerMat = new THREE.MeshLambertMaterial({ color: 0x1b5e20 });
  const runner = new THREE.Mesh(runnerGeo, runnerMat);
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.01, 1);
  scene.add(runner);

  // White shooting line
  const lineGeo = new THREE.PlaneGeometry(8, 0.12);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const foulLine = new THREE.Mesh(lineGeo, lineMat);
  foulLine.rotation.x = -Math.PI / 2;
  foulLine.position.set(0, 0.02, 0);
  scene.add(foulLine);

  // Distance lines & ground markers (10m, 20m, 30m, 50m)
  const distances = [10, 20, 30, 50];
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.65 });
  for (const dist of distances) {
    const dLine = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.1), markerMat);
    dLine.rotation.x = -Math.PI / 2;
    dLine.position.set(0, 0.02, -dist);
    scene.add(dLine);
  }

  // Safety backstop net behind targets (at z = -35m)
  const netGeo = new THREE.PlaneGeometry(24, 6);
  const netMat = new THREE.MeshLambertMaterial({
    color: 0x1e3a1e,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(0, 3, -35);
  scene.add(net);

  // Target Stand generator
  function makeTarget(pos, scale = 1.0) {
    const group = new THREE.Group();
    group.position.copy(pos);

    // Tripod wooden legs
    const legGeo = new THREE.CylinderGeometry(0.04 * scale, 0.04 * scale, 2.4 * scale, 6);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x8d5b36 });

    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.45 * scale, 1.1 * scale, 0);
    leftLeg.rotation.z = -0.22;
    leftLeg.rotation.x = 0.18;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.45 * scale, 1.1 * scale, 0);
    rightLeg.rotation.z = 0.22;
    rightLeg.rotation.x = 0.18;
    group.add(rightLeg);

    const backLeg = new THREE.Mesh(legGeo, legMat);
    backLeg.position.set(0, 1.1 * scale, -0.6 * scale);
    backLeg.rotation.x = -0.32;
    group.add(backLeg);

    // Target boss (foam backing cylinder)
    const bossRadius = 0.64 * scale;
    const bossGeo = new THREE.CylinderGeometry(bossRadius, bossRadius, 0.18 * scale, 32);
    const bossMat = new THREE.MeshLambertMaterial({ color: 0xd97706 });
    const boss = new THREE.Mesh(bossGeo, bossMat);
    boss.rotation.x = Math.PI / 2 - 0.18;
    boss.position.set(0, 1.35 * scale, -0.05 * scale);
    boss.castShadow = true;
    group.add(boss);

    // Olympic Concentric Target Rings Canvas Texture
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 512;
    const ctx = cv.getContext('2d');
    const cx = 256;
    const cy = 256;
    const r = 240;

    const ringColors = [
      { r: r * 1.0, color: '#f8fafc' }, // 1 (White)
      { r: r * 0.9, color: '#f8fafc', line: '#94a3b8' }, // 2 (White)
      { r: r * 0.8, color: '#0f172a' }, // 3 (Black)
      { r: r * 0.7, color: '#0f172a', line: '#475569' }, // 4 (Black)
      { r: r * 0.6, color: '#0284c7' }, // 5 (Blue)
      { r: r * 0.5, color: '#0284c7', line: '#38bdf8' }, // 6 (Blue)
      { r: r * 0.4, color: '#dc2626' }, // 7 (Red)
      { r: r * 0.3, color: '#dc2626', line: '#f87171' }, // 8 (Red)
      { r: r * 0.2, color: '#f59e0b' }, // 9 (Gold/Yellow)
      { r: r * 0.1, color: '#f59e0b', line: '#d97706' }, // 10 (Gold/Yellow)
      { r: r * 0.05, color: '#f59e0b', line: '#b45309', x: true }, // Inner X
    ];

    for (const ring of ringColors) {
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.fillStyle = ring.color;
      ctx.fill();
      ctx.strokeStyle = ring.line || '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Draw crosshair '+' in center X ring
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    const targetTex = new THREE.CanvasTexture(cv);
    const faceGeo = new THREE.CircleGeometry(bossRadius * 0.96, 32);
    const faceMat = new THREE.MeshBasicMaterial({ map: targetTex });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.rotation.x = -0.18;
    face.position.set(0, 1.35 * scale, 0.05 * scale);
    group.add(face);

    scene.add(group);
    return { group, center: new THREE.Vector3(pos.x, 1.35 * scale, pos.z + 0.05 * scale), radius: bossRadius * 0.96 };
  }

  // Primary Center Target at 30 meters
  const mainTarget = makeTarget(new THREE.Vector3(0, 0, -30), 1.0);

  // Flanking decorative targets
  makeTarget(new THREE.Vector3(-4.5, 0, -30), 0.95);
  makeTarget(new THREE.Vector3(4.5, 0, -30), 0.95);

  // Wind Flag Indicator on pole
  const flagPoleGeo = new THREE.CylinderGeometry(0.03, 0.03, 3.5, 8);
  const flagPoleMat = new THREE.MeshLambertMaterial({ color: 0xd1d5db });
  const flagPole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
  flagPole.position.set(3.2, 1.75, -8);
  scene.add(flagPole);

  const flagGeo = new THREE.PlaneGeometry(0.85, 0.45);
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide });
  const windFlag = new THREE.Mesh(flagGeo, flagMat);
  windFlag.position.set(3.62, 3.25, -8);
  scene.add(windFlag);

  // Outer spectator banners
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
  for (let z = -5; z >= -45; z -= 12) {
    const leftB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 3.5), bannerMat);
    leftB.position.set(-8, 0.45, z);
    scene.add(leftB);

    const rightB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 3.5), bannerMat);
    rightB.position.set(8, 0.45, z);
    scene.add(rightB);
  }

  return {
    scene,
    target: mainTarget,
    windFlag,
    update(dt, windX) {
      if (windFlag) {
        // Flag flutters and points with wind
        const targetRotY = windX > 0 ? 0.35 : -0.35;
        windFlag.rotation.y = THREE.MathUtils.lerp(windFlag.rotation.y, targetRotY, 0.1);
        windFlag.rotation.z = Math.sin(performance.now() * 0.012) * 0.12 * Math.abs(windX || 1);
      }
    },
    dispose() {
      // Traverse and dispose materials/geometries
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    },
  };
}
