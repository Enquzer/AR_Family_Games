/** Shared game lifecycle, camera and HUD helpers. */
import * as THREE from '/vendor/three/three.module.js';
import { Effects } from '../engine/effects.js';
import { clamp, damp } from '../shared/math.js';

export class BaseGame {
  constructor(ctx, options = {}) {
    this.ctx = ctx; // { engine, camera, audio, calibration, room, settings }
    this.options = options;
    this.id = 'base';
    this.title = 'GAME';
    this.subtitle = '';
    this.phase = 'idle';
    this.time = 0;
    this.message = '';
    this.messageSub = '';
    this.players = [];
    this.minPlayers = 1;
    this.env = null;
    this.scene = null;
    this.fx = null;
    this.cameraInfo = null;
    this.startedAt = 0;
  }

  /** Create world + effects. Subclasses implement buildWorld(). */
  init() {
    this.buildWorld();
    this.scene = this.env.scene;
    this.fx = new Effects(this.scene);
    this.cameraInfo = this.env.camera;
    this.setCamera();
  }

  buildWorld() {
    throw new Error('buildWorld() not implemented');
  }

  addPlayer(p) {
    if (this.players.find((x) => x.key === p.key)) return;
    this.players.push(p);
    p.avatar.followStage = false;
    p.avatar.seated = false;
    p.avatar.setProp('none');
    p.avatar.setVisible(true);
    this.scene.add(p.avatar.group);
  }

  removePlayer(p) {
    p.avatar.group.removeFromParent();
    this.players = this.players.filter((x) => x !== p);
  }

  start() {
    this.phase = 'playing';
    this.startedAt = performance.now();
  }

  update(dt) {
    this.time += dt;
    this.updateCamera();
  }

  updateCamera() {
    if (!this.cameraInfo) return;
    this.setCamera(this.cameraInfo.pos, this.cameraInfo.look, this.cameraInfo.fov);
  }

  setCamera(pos, look, fov = null) {
    const cam = this.ctx.camera;
    const p = pos || this.env?.camera?.pos || [0, 2, 8];
    const l = look || this.env?.camera?.look || [0, 1, 0];
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(new THREE.Vector3(l[0], l[1], l[2]));
    cam.fov = fov ?? this.ctx.calibration?.fov ?? this.env?.camera?.fov ?? 46;
    cam.updateProjectionMatrix();
    const roll = this.ctx.calibration?.roll || 0;
    cam.rotation.z += -roll * 0.55;
  }

  place(p, x, z, { y = 0, facing = 0, seated = false } = {}) {
    p.avatar.followStage = false;
    p.avatar.group.position.set(x, y, z);
    p.avatar.facingTarget = facing;
    p.avatar.seated = seated;
  }

  drain(p) {
    return p?.motion ? p.motion.takeEvents() : [];
  }

  hudPlayer(p, { value = 0, max = 100, label = '', detail = '', rank = null, active = true, color = null } = {}) {
    return {
      id: p.key,
      name: p.name,
      color: color || p.color,
      value,
      max,
      label,
      detail,
      rank,
      active,
    };
  }

  getHud() {
    return {
      title: this.title,
      subtitle: this.subtitle,
      phase: this.phase,
      timer: null,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players: [],
      queue: [],
    };
  }

  dispose() {
    for (const p of this.players) p.avatar.group.removeFromParent();
    this.fx?.dispose();
    this.env?.dispose();
    this.scene = null;
    this.fx = null;
  }
}
