/** Renderer wrapper. */
import * as THREE from '/vendor/three/three.module.js';
import { AudioKit } from './audio.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // off: Iris Xe can't spare it
      powerPreference: 'default', // don't force high-performance on integrated
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0)); // cap at 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false; // shadows off — too heavy on Iris Xe

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.05, 600);
    this.camera.position.set(0, 1.55, 6.5);
    this.camera.lookAt(0, 1, 0);
    this.audio = new AudioKit();
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setScene(scene) {
    this.scene = scene;
  }

  shake(amount = 0.15, time = 0.3) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  render(dt) {
    this.time += dt;
    const cam = this.camera;
    let sx = 0, sy = 0, sz = 0;
    if (this.shakeAmount > 0.001) {
      const a = this.shakeAmount;
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
      sz = (Math.random() - 0.5) * a * 0.4;
      cam.position.x += sx;
      cam.position.y += sy;
      cam.position.z += sz;
      this.shakeAmount *= Math.exp(-9 * dt);
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeAmount = 0;
    }
    this.renderer.render(this.scene, cam);
    if (sx || sy || sz) {
      cam.position.x -= sx;
      cam.position.y -= sy;
      cam.position.z -= sz;
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
