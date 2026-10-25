/** Procedural environment helpers: textures, sky, lights, crowds, props. */
import * as THREE from '/vendor/three/three.module.js';
import { mulberry32 } from '../shared/math.js';

export function canvasTexture(w, h, draw, { repeatX = 1, repeatY = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

export function addSky(scene, top = 0x0b1026, bottom = 0x1e3a5f, radius = 320) {
  scene.background = new THREE.Color(bottom);
  scene.fog = new THREE.FogExp2(bottom, 0.012);
  const geo = new THREE.SphereGeometry(radius, 32, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      bottom: { value: new THREE.Color(bottom) },
      exponent: { value: 0.75 },
    },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float exponent; varying vec3 vWorld;
      void main(){ float h = normalize(vWorld + vec3(0.0, 40.0, 0.0)).y; float t = pow(max(h, 0.0), exponent); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function addLights(scene, { key = 0xfff4e6, ambient = 0x334466, keyIntensity = 2.6, ambientIntensity = 0.55 } = {}) {
  const hemi = new THREE.HemisphereLight(ambient, 0x080810, ambientIntensity);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(key, keyIntensity);
  dir.position.set(8, 18, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -22;
  dir.shadow.camera.right = 22;
  dir.shadow.camera.top = 22;
  dir.shadow.camera.bottom = -22;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 60;
  dir.shadow.bias = -0.0005;
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0x4488ff, 1.1);
  rim.position.set(-10, 8, -14);
  scene.add(rim);
  return { hemi, dir, rim };
}

export function makeCrowd({ count = 260, x = [-18, 18], z = [-14, 14], y = [1.2, 4.2], exclude = 0 } = {}) {
  const rand = mulberry32(1337);
  const geo = new THREE.SphereGeometry(0.22, 6, 5);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const colors = [0xf87171, 0xfbbf24, 0x60a5fa, 0x34d399, 0xf472b6, 0xe5e7eb, 0xa78bfa];
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 20) {
    const px = x[0] + rand() * (x[1] - x[0]);
    const pz = z[0] + rand() * (z[1] - z[0]);
    if (Math.hypot(px, pz) < exclude) continue;
    const py = y[0] + rand() * (y[1] - y[0]);
    dummy.position.set(px, py, pz);
    const s = 0.8 + rand() * 0.5;
    dummy.scale.set(s, s * 1.25, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    c.setHex(colors[Math.floor(rand() * colors.length)]);
    mesh.setColorAt(placed, c);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  return mesh;
}

export function makeStands({ length = 120, z = 13, side = 1, rows = 4 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b2438, roughness: 0.9 });
  for (let r = 0; r < rows; r++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, 1.2), mat);
    box.position.set(0, 0.3 + r * 0.55, z * side + r * 1.2 * side);
    box.receiveShadow = true;
    g.add(box);
  }
  return g;
}

export function bar(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.001);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.scale.set(radius, len, radius);
  return mesh;
}

export function labelTexture(text, { bg = 'rgba(8,12,24,0.85)', color = '#f8fafc', border = '#22d3ee', w = 512, h = 128, font = 'bold 52px system-ui' } = {}) {
  return canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, 22);
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        if (m.emissiveMap) m.emissiveMap.dispose();
        if (m.alphaMap) m.alphaMap.dispose();
        m.dispose();
      }
    }
  });
  obj.removeFromParent();
}

export function setShadow(obj, cast = true, receive = false) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
}
