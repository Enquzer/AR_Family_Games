/**
 * Rigged 3D Character Model Service
 *
 * Supports Mixamo FBX and GLTF/GLB skinned humanoid models.
 * Enables deep skeletal cloning (via SkeletonUtils) so multiple competitors,
 * bots, and athletes can use the same 3D rigged character concurrently
 * with independent animations, custom jersey/accent colors, and correct facing orientations.
 *
 * Coordinate Convention:
 * - Default model front: +Z (rotation.y = 0)
 * - Right profile (running right along +X): rotation.y = Math.PI / 2
 * - Back to camera (facing into screen / down lane -Z): rotation.y = Math.PI
 * - Left profile (facing -X): rotation.y = -Math.PI / 2
 */
import * as THREE from '/vendor/three/three.module.js';
import { FBXLoader } from '/vendor/three/FBXLoader.js';
import { GLTFLoader } from '/vendor/three/GLTFLoader.js';
import { clone as cloneSkeleton } from '/vendor/three/utils/SkeletonUtils.js';

let cachedBaseModel = null;
let cachedAnimations = [];
let loadPromise = null;

export async function getRiggedModelBase() {
  if (cachedBaseModel) return { model: cachedBaseModel, animations: cachedAnimations };
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 1. Try GLB first
    try {
      const gltfLoader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load('/models/coach.glb', resolve, undefined, reject);
      });
      if (gltf && gltf.scene) {
        cachedBaseModel = gltf.scene;
        cachedAnimations = gltf.animations || [];
        return { model: cachedBaseModel, animations: cachedAnimations };
      }
    } catch {}

    // 2. Try FBX (Excited.fbx or coach.fbx)
    const fbxPaths = ['/models/Excited.fbx', '/models/coach.fbx'];
    const fbxLoader = new FBXLoader();

    for (const p of fbxPaths) {
      try {
        const fbx = await new Promise((resolve, reject) => {
          fbxLoader.load(p, resolve, undefined, reject);
        });
        if (fbx) {
          cachedBaseModel = fbx;
          cachedAnimations = fbx.animations || [];
          return { model: cachedBaseModel, animations: cachedAnimations };
        }
      } catch {}
    }

    return { model: null, animations: [] };
  })();

  return loadPromise;
}

/**
 * Creates an independent rigged avatar instance from the cached 3D model.
 */
export async function createRiggedAvatar({
  scene,
  color = '#38bdf8',
  height = 1.85,
  facing = 0,
  autoPlay = true,
} = {}) {
  const { model, animations } = await getRiggedModelBase();
  if (!model) return null;

  // Deep clone mesh and skeletal hierarchy
  const instance = cloneSkeleton(model);

  // Normalize scale to requested target height
  const box = new THREE.Box3().setFromObject(instance);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 0 ? height / size.y : 0.01;
  instance.scale.setScalar(scale);

  // Apply custom athlete / team color & shadow casting
  const threeColor = new THREE.Color(color);
  instance.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material = child.material.clone();
        if (child.name.toLowerCase().includes('surface') || child.name.toLowerCase().includes('body')) {
          child.material.color = threeColor;
        }
        child.material.roughness = 0.55;
      }
    }
  });

  // Root group with facing orientation
  const root = new THREE.Group();
  root.add(instance);
  root.rotation.y = facing;

  let mixer = null;
  let action = null;

  if (animations && animations.length > 0) {
    mixer = new THREE.AnimationMixer(instance);
    const clip = animations.find((a) => a.tracks && a.tracks.length > 0) || animations[0];
    action = mixer.clipAction(clip);
    if (autoPlay) action.play();
  }

  if (scene) scene.add(root);

  return {
    group: root,
    instance,
    mixer,
    action,
    facing,
    setFacing(angle) {
      this.facing = angle;
      root.rotation.y = angle;
    },
    setPosition(x, y, z) {
      root.position.set(x, y, z);
    },
    setSpeed(speedMultiplier) {
      if (this.action) {
        this.action.timeScale = speedMultiplier;
      }
    },
    setVisible(v) {
      root.visible = v;
    },
    update(dt) {
      if (this.mixer) this.mixer.update(dt);
    },
    dispose() {
      if (this.action) this.action.stop();
      if (this.mixer) this.mixer.stopAllAction();
      root.removeFromParent();
      instance.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}
