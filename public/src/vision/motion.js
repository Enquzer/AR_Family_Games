/**
 * Turns pose landmarks into gameplay signals:
 * punches, tennis swings, blocking, leaning, running cadence, jumps,
 * crouching, arm raises and rowing strokes.
 *
 * Everything is scale-invariant (normalised by shoulder width / body height
 * and MediaPipe metric worldLandmarks) so it works reliably whether the player
 * is close to or far from the camera.
 */
import { clamp, damp, dist2 } from '../shared/math.js';
import { LM, mid } from '../shared/pose.js';
import { CONFIG } from '../shared/config.js';

const nowMs = () => performance.now();

export class MotionTracker {
  constructor() {
    this.state = this.#blank();
    this.prev = null;
    this.prevWorld = null;
    this.lastTime = 0;
    this.stepTimes = [];
    this.punchCooldown = { L: 0, R: 0 };
    this.swingCooldown = 0;
    this.strokeCooldown = 0;
    this.jumpCooldown = 0;
    this.airborne = false;
    this.ankleBase = { L: null, R: null };
    this.kneeBase = { L: null, R: null };
    this.hipBase = null;
    this.pullPrev = null;
    this.initialised = false;
    this.waveHistory = [];
    this.lastWaveAt = 0;
    this.waveLockUntil = 0;
    this.kickCooldown = { L: 0, R: 0 };
    this.prevAnkleY = { L: null, R: null };
    this.standingHipY = null; // anchored at wave-to-join, used for non-drifting duck
    this.handPrev = { L: null, R: null };
    this.prevHandSpeed = { L: 0, R: 0 };
    this.punchCandidate = {
      L: { frames: 0, integral: 0, best: null },
      R: { frames: 0, integral: 0, best: null },
    };
    this.lastPunchAt = 0;
    this.lastPushAt = 0;
    this.pauseHoldDuration = 0;
    this.lastPauseToggleAt = 0;
    this.domHoldL = 0;
    this.domHoldR = 0;

    // Feature ring buffer (0.5s at 60Hz)
    this.ringBuffer = [];
    this.ringMaxSize = CONFIG.motion?.ringBufferSize || 30;
    this.handSpeedHistory = [];
  }

  #blank() {
    return {
      events: [],
      punchL: 0,
      punchR: 0,
      block: 0,
      guard: 0,
      lean: 0,
      jump: 0,
      run: 0,
      cadence: 0,
      steps: 0,
      armsUp: 0,
      pauseProgress: 0,
      pauseHold: 0,
      reachForwardL: 0,
      reachForwardR: 0,
      dominantCandidate: null,
      dominantProgress: { L: 0, R: 0 },
      duck: 0,
      rowPower: 0,
      strokes: 0,
      handSpeed: 0,
      swing: 0,
      wave: 0,
      waveAt: 0,
      kickL: 0,
      kickR: 0,
      waveProgress: 0,
      extension: 1,
      bodyH: 0.5,
      shoulderW: 0.1,
      hipY: 0.55,
      noseY: 0.25,
      wristL: { x: 0.4, y: 0.55 },
      wristR: { x: 0.6, y: 0.55 },
      ankleY: 0.9,
      hip: { x: 0.5, y: 0.55 },
      shoulder: { x: 0.5, y: 0.38 },
      handL: { x: 0, y: 0, z: 0 },
      handR: { x: 0, y: 0, z: 0 },
      elbowL: 0,
      elbowR: 0,
      shoulderTilt: 0,
      torsoTwist: 0,
      kneeLiftL: 0,
      kneeLiftR: 0,
      legDrive: 0,
      armDrive: 0,
      energy: 0,
      punchQuality: 0,
      punchMomentum: 0,
      punchReach: 0,
      punchSpeed: 0,
      punchAccel: 0,
      punchAttempts: 0,
      lastPunch: null,
      pushAt: 0,
      pushPower: 0,
      pushCurve: 0,
      pushAim: 0,
      pushCount: 0,
      confidence: 0,
      lastSeen: 0,
    };
  }

  reset() {
    this.state = this.#blank();
    this.prev = null;
    this.prevWorld = null;
    this.lastTime = 0;
    this.stepTimes = [];
    this.ankleBase = { L: null, R: null };
    this.kneeBase = { L: null, R: null };
    this.pullPrev = null;
    this.initialised = false;
    this.waveHistory = [];
    this.lastWaveAt = 0;
    this.waveLockUntil = 0;
    this.kickCooldown = { L: 0, R: 0 };
    this.prevAnkleY = { L: null, R: null };
    this.standingHipY = null;
    this.handPrev = { L: null, R: null };
    this.prevHandSpeed = { L: 0, R: 0 };
    this.punchCandidate = {
      L: { frames: 0, integral: 0, best: null },
      R: { frames: 0, integral: 0, best: null },
    };
    this.lastPunchAt = 0;
    this.lastPushAt = 0;
    this.pauseHoldDuration = 0;
    this.lastPauseToggleAt = 0;
    this.domHoldL = 0;
    this.domHoldR = 0;
    this.ringBuffer = [];
    this.handSpeedHistory = [];
  }

  /**
   * @param {Array} lm landmarks
   * @param {number} aspect video aspect
   * @param {number} ts milliseconds
   * @param {Array|null} worldLm metric worldLandmarks (meters)
   * @param {Array|null} smoothLm optional smooth landmarks
   */
  update(lm, aspect = 16 / 9, ts = nowMs(), worldLm = null, smoothLm = null) {
    const s = this.state;
    const now = ts;
    const dt = this.lastTime ? clamp((now - this.lastTime) / 1000, 0.005, 0.2) : 0.033;
    this.lastTime = now;

    if (!lm || lm.length < 33) {
      s.run = damp(s.run, 0, 6, dt);
      s.lean = damp(s.lean, 0, 6, dt);
      s.armsUp = damp(s.armsUp, 0, 6, dt);
      s.duck = damp(s.duck, 0, 6, dt);
      s.jump = damp(s.jump, 0, 8, dt);
      s.rowPower = damp(s.rowPower, 0, 8, dt);
      s.lastSeen = now;
      return s;
    }

    // Square-pixel coordinates (x normalised by width, y by height).
    const P = (i) => ({
      x: lm[i].x * aspect,
      y: lm[i].y,
      z: (lm[i].z || 0) * aspect,
    });
    const nose = P(LM.NOSE);
    const shL = P(LM.L_SHOULDER);
    const shR = P(LM.R_SHOULDER);
    const elL = P(LM.L_ELBOW);
    const elR = P(LM.R_ELBOW);
    const wrL = P(LM.L_WRIST);
    const wrR = P(LM.R_WRIST);
    const hipL = P(LM.L_HIP);
    const hipR = P(LM.R_HIP);
    const knL = P(LM.L_KNEE);
    const knR = P(LM.R_KNEE);
    const anL = P(LM.L_ANKLE);
    const anR = P(LM.R_ANKLE);

    const sh = mid(shL, shR);
    const hip = mid(hipL, hipR);
    const ankle = mid(anL, anR);
    const shoulderW = Math.max(dist2(shL.x, shL.y, shR.x, shR.y), 0.03);
    const bodyH = Math.max(dist2(sh.x, sh.y, ankle.x, ankle.y), 0.08);
    const headY = Math.min(nose.y, (shL.y + shR.y) / 2);
    const vis = (lm[LM.L_SHOULDER].visibility + lm[LM.R_SHOULDER].visibility + lm[LM.L_HIP].visibility + lm[LM.R_HIP].visibility) / 4;

    if (!this.initialised || !this.prev) {
      this.ankleBase.L = anL.y;
      this.ankleBase.R = anR.y;
      this.kneeBase.L = knL.y;
      this.kneeBase.R = knR.y;
      this.initialised = true;
    }

    const prev = this.prev;
    const speedOf = (cur, old) => (old ? dist2(cur.x, cur.y, old.x, old.y) / Math.max(dt, 0.01) / shoulderW : 0);
    const angleAt = (a, b, c) => {
      const ax = a.x - b.x;
      const ay = a.y - b.y;
      const cx = c.x - b.x;
      const cy = c.y - b.y;
      const denom = Math.hypot(ax, ay) * Math.hypot(cx, cy);
      return denom > 1e-6 ? Math.acos(clamp((ax * cx + ay * cy) / denom, -1, 1)) : 0;
    };

    const handSpeedL = speedOf(wrL, prev?.wrL);
    const handSpeedR = speedOf(wrR, prev?.wrR);
    const handHighL = wrL.y < sh.y - bodyH * 0.02;
    const handHighR = wrR.y < sh.y - bodyH * 0.02;
    const lateralL = prev?.wrL ? Math.abs(wrL.x - prev.wrL.x) / Math.max(dt, 0.01) / shoulderW : 0;
    const lateralR = prev?.wrR ? Math.abs(wrR.x - prev.wrR.x) / Math.max(dt, 0.01) / shoulderW : 0;
    const verticalL = prev?.wrL ? Math.abs(wrL.y - prev.wrL.y) / Math.max(dt, 0.01) / shoulderW : 0;
    const verticalR = prev?.wrR ? Math.abs(wrR.y - prev.wrR.y) / Math.max(dt, 0.01) / shoulderW : 0;

    // Side-to-side motion with a raised hand is a wave, not a punch/swing.
    const waveCandidate =
      (handHighL && lateralL > 1.35 && lateralL > verticalL * 1.2) ||
      (handHighR && lateralR > 1.35 && lateralR > verticalR * 1.2);
    const extL = dist2(wrL.x, wrL.y, shL.x, shL.y) / shoulderW;
    const extR = dist2(wrR.x, wrR.y, shR.x, shR.y) / shoulderW;
    const extension = Math.max(extL, extR);
    const handSpeed = Math.max(handSpeedL, handSpeedR);

    // Track hand speed history for adaptive per-player percentile calibration
    this.handSpeedHistory.push({ t: now, speed: handSpeed });
    if (this.handSpeedHistory.length > 180) this.handSpeedHistory.shift();

    // Metric worldLandmarks processing (if available from MediaPipe)
    let forwardSpeedL = 0;
    let forwardSpeedR = 0;
    let metricSpeedL = 0;
    let metricSpeedR = 0;

    if (worldLm && worldLm.length >= 33) {
      const wWrL = worldLm[LM.L_WRIST];
      const wWrR = worldLm[LM.R_WRIST];
      if (this.prevWorld) {
        // MediaPipe world z: negative is forward toward camera.
        // Therefore, forward speed (m/s) = (prevZ - currZ) / dt
        metricSpeedL = Math.max(0, (this.prevWorld.wrL.z - wWrL.z) / Math.max(dt, 0.01));
        metricSpeedR = Math.max(0, (this.prevWorld.wrR.z - wWrR.z) / Math.max(dt, 0.01));
        forwardSpeedL = clamp(metricSpeedL * 1.8, 0, 10);
        forwardSpeedR = clamp(metricSpeedR * 1.8, 0, 10);
      }
      this.prevWorld = {
        wrL: { x: wWrL.x, y: wWrL.y, z: wWrL.z },
        wrR: { x: wWrR.x, y: wWrR.y, z: wWrR.z },
      };
    } else {
      // Fallback to normalized camera coordinates divided by shoulder width
      forwardSpeedL = prev?.wrL ? clamp((prev.wrL.z - wrL.z) / Math.max(dt, 0.01) / shoulderW, 0, 8) : 0;
      forwardSpeedR = prev?.wrR ? clamp((prev.wrR.z - wrR.z) / Math.max(dt, 0.01) / shoulderW, 0, 8) : 0;
    }

    const prevExtL = this.handPrev.L?.ext ?? extL;
    const prevExtR = this.handPrev.R?.ext ?? extR;
    const extVelL = (extL - prevExtL) / Math.max(dt, 0.01);
    const extVelR = (extR - prevExtR) / Math.max(dt, 0.01);
    const accelL = clamp((handSpeedL - this.prevHandSpeed.L) / Math.max(dt, 0.01), -40, 40);
    const accelR = clamp((handSpeedR - this.prevHandSpeed.R) / Math.max(dt, 0.01), -40, 40);

    // Push snapshot into feature ring buffer
    this.ringBuffer.push({
      t: now,
      dt,
      wrL,
      wrR,
      extL,
      extR,
      fwdL: forwardSpeedL,
      fwdR: forwardSpeedR,
      speedL: handSpeedL,
      speedR: handSpeedR,
    });
    if (this.ringBuffer.length > this.ringMaxSize) this.ringBuffer.shift();

    s.handSpeed = damp(s.handSpeed, handSpeed, 18, dt);
    s.extension = extension;
    s.bodyH = bodyH;
    s.shoulderW = shoulderW;
    s.hipY = hip.y;
    s.noseY = nose.y;
    s.ankleY = ankle.y;
    s.hip = { x: hip.x, y: hip.y };
    s.shoulder = { x: sh.x, y: sh.y };
    s.wristL = { x: wrL.x, y: wrL.y };
    s.wristR = { x: wrR.x, y: wrR.y };
    s.handL = {
      x: (wrL.x - sh.x) / shoulderW,
      y: (sh.y - wrL.y) / shoulderW,
      z: (wrL.z - sh.z) / shoulderW,
    };
    s.handR = {
      x: (wrR.x - sh.x) / shoulderW,
      y: (sh.y - wrR.y) / shoulderW,
      z: (wrR.z - sh.z) / shoulderW,
    };
    s.elbowL = angleAt(wrL, elL, shL);
    s.elbowR = angleAt(wrR, elR, shR);
    s.shoulderTilt = clamp((shR.y - shL.y) / (shoulderW * 0.8), -1, 1);

    // 3D Torso twist from shoulder and hip vectors
    const shAngle = Math.atan2(shR.z - shL.z, shR.x - shL.x);
    const hipAngle = Math.atan2(hipR.z - hipL.z, hipR.x - hipL.x);
    s.torsoTwist = clamp((shAngle - hipAngle) * 1.2, -1, 1);
    s.confidence = vis;
    s.lastSeen = now;

    // Overall motion energy: used by dance/groove scoring
    const bodySpeed = (speedOf(hip, prev?.hip) + speedOf(sh, prev?.sh) + speedOf(anL, prev?.anL) + speedOf(anR, prev?.anR)) / 4;
    s.energy = damp(s.energy, clamp((handSpeed * 0.35 + bodySpeed * 0.75) / 2.0, 0, 1), 8, dt);

    /* ---------------- guard / block ---------------- */
    const nearFace = (w) => w.y < sh.y + 0.05 && Math.abs(w.x - nose.x) < shoulderW * 1.15;
    const guardL = nearFace(wrL) && wrL.y < nose.y + bodyH * 0.12;
    const guardR = nearFace(wrR) && wrR.y < nose.y + bodyH * 0.12;
    s.guard = damp(s.guard, guardL || guardR ? 1 : 0, 14, dt);
    s.block = damp(s.block, guardL && guardR ? 1 : 0, 14, dt);

    /* ---------------- lean ---------------- */
    const leanRaw = clamp((sh.x - ankle.x) / (shoulderW * 1.25), -1.2, 1.2);
    const tilt = clamp((shR.y - shL.y) / (shoulderW * 0.8), -1, 1);
    s.lean = damp(s.lean, clamp(leanRaw * 0.7 + tilt * 0.3, -1, 1), 12, dt);

    /* ---------------- punches & swings ---------------- */
    const handsUp = wrL.y < hip.y && wrR.y < hip.y;
    const torsoDrive = Math.abs(s.torsoTwist) * 0.55 + Math.abs(s.lean) * 0.2;
    const punchScoreL =
      Math.max(0, handSpeedL - 0.55) * 0.9 +
      Math.max(0, extVelL) * 1.15 +
      forwardSpeedL * 0.65 +
      Math.max(0, extL - 0.85) * 1.4 +
      torsoDrive;
    const punchScoreR =
      Math.max(0, handSpeedR - 0.55) * 0.9 +
      Math.max(0, extVelR) * 1.15 +
      forwardSpeedR * 0.65 +
      Math.max(0, extR - 0.85) * 1.4 +
      torsoDrive;

    const minForwardMps = CONFIG.motion?.punch?.minForwardSpeedMps || 1.15;
    const minArmExt = CONFIG.motion?.punch?.minArmExtension || 0.75;
    const punchCooldownMs = CONFIG.motion?.punch?.cooldownMs || 220;

    const tryPunch = (hand, score, ext, extVel, fwdSpeed, lateralSpeed, wristY, speed, accel, metricSpd) => {
      const candidate = this.punchCandidate[hand];
      const handRaised = wristY < hip.y + bodyH * 0.04 && wristY > sh.y - bodyH * 0.62;
      const reachOK = ext > minArmExt || (lateralSpeed > 1.7 && ext > minArmExt * 0.85);
      const extending = extVel > 0.15 || fwdSpeed > 0.40 || lateralSpeed > 1.8;
      const metricPass = metricSpd > 0 ? metricSpd > minForwardMps * 0.6 : true;
      const strongEnough = speed > 1.1 && score > 1.8 && metricPass;

      const qualified =
        now >= this.waveLockUntil &&
        !waveCandidate &&
        s.block < 0.55 &&
        handRaised &&
        reachOK &&
        extending &&
        strongEnough;

      if (!qualified) {
        candidate.frames = Math.max(0, candidate.frames - 1);
        candidate.integral = Math.max(0, candidate.integral - score * 0.5);
        candidate.best = null;
        return;
      }

      candidate.frames++;
      candidate.integral += score;
      candidate.best = { score, ext, fwdSpeed, speed, accel };

      // Integrate burst over at least 2 consecutive frames
      if (candidate.frames < 2) return;
      if (now - this.punchCooldown[hand] < punchCooldownMs) return;
      if (now - this.lastPunchAt < 80) return;

      this.punchCooldown[hand] = now;
      this.lastPunchAt = now;
      candidate.frames = 0;
      candidate.integral = 0;

      const quality = clamp((score - 1.6) / 3.0, 0, 1);
      const power = clamp(0.35 + quality * 1.0, 0.35, 1.4);
      const momentum = clamp(
        quality * (0.55 + Math.abs(s.torsoTwist) * 0.35 + Math.min(fwdSpeed, 2.5) * 0.12) +
          Math.min(Math.abs(accel) * 0.012, 0.18),
        0,
        1.4
      );

      const zone = wristY <= sh.y + 0.04 ? 'head' : 'torso';
      const elbowAngle = hand === 'L' ? s.elbowL : s.elbowR;
      const hardHit = ext > 1.05 || (elbowAngle && elbowAngle > 145) || speed > 2.0;

      const ev = {
        type: 'punch',
        hand,
        zone,
        hardHit,
        power: hardHit ? Math.min(1.5, power * 1.25) : power,
        quality,
        momentum,
        reach: ext,
        speed,
        accel,
        at: now,
      };
      s.events.push(ev);
      s.punchAttempts++;
      s.punchQuality = quality;
      s.punchMomentum = momentum;
      s.punchReach = ext;
      s.punchSpeed = speed;
      s.punchAccel = accel;
      s.lastPunch = ev;
      if (hand === 'L') s.punchL = now;
      else s.punchR = now;
    };

    tryPunch('L', punchScoreL, extL, extVelL, forwardSpeedL, lateralL, wrL.y, handSpeedL, accelL, metricSpeedL);
    tryPunch('R', punchScoreR, extR, extVelR, forwardSpeedR, lateralR, wrR.y, handSpeedR, accelR, metricSpeedR);
    this.handPrev.L = { ext: extL, z: wrL.z };
    this.handPrev.R = { ext: extR, z: wrR.z };
    this.prevHandSpeed.L = handSpeedL;
    this.prevHandSpeed.R = handSpeedR;

    if (
      now >= this.waveLockUntil &&
      !waveCandidate &&
      s.block < 0.5 &&
      now - this.swingCooldown > 300 &&
      handSpeed > 2.0 &&
      extension > 1.0 &&
      handsUp
    ) {
      this.swingCooldown = now;
      const quality = clamp((handSpeed - 1.4) / 4, 0, 1);
      const power = clamp(0.25 + quality * 1.05, 0.2, 1.3);
      s.events.push({
        type: 'swing',
        hand: handSpeedL > handSpeedR ? 'L' : 'R',
        power,
        quality,
        momentum: clamp(quality * (0.6 + Math.abs(s.torsoTwist) * 0.4), 0, 1.3),
        at: now,
      });
      s.swing = 1;
    }
    s.swing = damp(s.swing, 0, 8, dt);

    /* ---------------- two-hand push (Balling) ---------------- */
    const pushForward = Math.max(forwardSpeedL, forwardSpeedR);
    const pushSpeed = Math.max(handSpeedL, handSpeedR);
    const pushHandsX = (wrL.x + wrR.x) * 0.5;
    const handsNear = Math.abs(wrL.x - wrR.x) < shoulderW * (CONFIG.motion?.push?.handsNearShoulderRatio || 1.85);

    if (
      now >= this.waveLockUntil &&
      !waveCandidate &&
      s.block < 0.6 &&
      now - this.lastPushAt > (CONFIG.motion?.push?.cooldownMs || 450) &&
      handsNear &&
      pushForward > (CONFIG.motion?.push?.minForwardSpeed || 0.85) &&
      pushSpeed > 0.42
    ) {
      this.lastPushAt = now;
      const quality = clamp((pushForward * 0.55 + pushSpeed * 0.18 - 0.5) / 2.5, 0, 1);
      const power = clamp(0.35 + quality * 1.0, 0.3, 1.35);
      const aim = clamp((pushHandsX - sh.x) / shoulderW * 0.55 + s.torsoTwist * 0.25 + s.lean * 0.15, -0.7, 0.7);
      const curve = clamp((wrR.z - wrL.z) / shoulderW * 0.85 + s.torsoTwist * 0.5, -1, 1);
      const ev = {
        type: 'push',
        power,
        quality,
        momentum: clamp(quality * (0.7 + Math.abs(s.torsoTwist) * 0.4), 0, 1.3),
        aim,
        curve,
        speed: pushSpeed,
        at: now,
      };
      s.events.push(ev);
      s.pushAt = now;
      s.pushPower = power;
      s.pushCurve = curve;
      s.pushAim = aim;
      s.pushCount++;
    }

    /* ---------------- steps / running ---------------- */
    const liftL = (this.ankleBase.L - anL.y) / bodyH;
    const liftR = (this.ankleBase.R - anR.y) / bodyH;
    const kneeLiftL = (this.kneeBase.L - knL.y) / bodyH;
    const kneeLiftR = (this.kneeBase.R - knR.y) / bodyH;
    if (liftL < 0.022) this.ankleBase.L += (anL.y - this.ankleBase.L) * 0.08;
    if (liftR < 0.022) this.ankleBase.R += (anR.y - this.ankleBase.R) * 0.08;
    if (kneeLiftL < 0.018) this.kneeBase.L += (knL.y - this.kneeBase.L) * 0.08;
    if (kneeLiftR < 0.018) this.kneeBase.R += (knR.y - this.kneeBase.R) * 0.08;

    const legLiftL = Math.max(liftL, kneeLiftL * 0.85);
    const legLiftR = Math.max(liftR, kneeLiftR * 0.85);
    const stepThreshold = 0.032;
    if (legLiftL > stepThreshold && !prev?.liftLUp) {
      this.stepTimes.push(now);
      s.steps++;
    }
    if (legLiftR > stepThreshold && !prev?.liftRUp) {
      this.stepTimes.push(now);
      s.steps++;
    }
    const liftLUp = prev?.liftLUp ? legLiftL > stepThreshold * 0.58 : legLiftL > stepThreshold;
    const liftRUp = prev?.liftRUp ? legLiftR > stepThreshold * 0.58 : legLiftR > stepThreshold;

    this.stepTimes = this.stepTimes.filter((t) => now - t < 2400);
    s.cadence = this.stepTimes.length / 2.4;
    s.kneeLiftL = clamp(kneeLiftL / 0.18, 0, 1);
    s.kneeLiftR = clamp(kneeLiftR / 0.18, 0, 1);

    const legDrive = clamp(
      (Math.max(legLiftL, legLiftR) * 3.2 + Math.abs(legLiftL - legLiftR) * 1.4) / 0.45,
      0,
      1.4
    );
    const armDrive = clamp(
      ((verticalL + verticalR) * 0.55 + Math.abs(verticalL - verticalR) * 0.35) / 2.2,
      0,
      1.2
    );
    const bodyBob = clamp(speedOf(hip, prev?.hip) / 2.4, 0, 1);
    const cadenceDrive = clamp(s.cadence / 2.8, 0, 1.35);
    s.legDrive = legDrive;
    s.armDrive = armDrive;
    const runTarget = clamp(
      Math.max(cadenceDrive, legDrive * 0.72 + armDrive * 0.36 + bodyBob * 0.22),
      0,
      1.45
    );
    s.run = damp(s.run, runTarget, 8, dt);

    /* ---------------- jump ---------------- */
    const bothLift = Math.min(Math.max(liftL, kneeLiftL * 0.7), Math.max(liftR, kneeLiftR * 0.7));
    const jumpNow = clamp((bothLift - 0.025) / 0.13, 0, 1);
    if (jumpNow > 0.28 && !this.airborne && now - this.jumpCooldown > 450) {
      this.airborne = true;
      this.jumpCooldown = now;
      s.events.push({ type: 'jump', power: clamp(jumpNow, 0.3, 1), at: now });
    }
    if (jumpNow < 0.08) this.airborne = false;
    s.jump = damp(s.jump, jumpNow, 14, dt);

    /* ---------------- kick detection ---------------- */
    const KICK_VEL_THRESH = CONFIG.motion?.kick?.velThreshold || 1.7;
    const anLVelY = this.prevAnkleY.L != null ? (this.prevAnkleY.L - anL.y) / Math.max(dt, 0.01) / bodyH : 0;
    const anRVelY = this.prevAnkleY.R != null ? (this.prevAnkleY.R - anR.y) / Math.max(dt, 0.01) / bodyH : 0;
    const kickCooldownMs = CONFIG.motion?.kick?.cooldownMs || 480;

    if (anLVelY > KICK_VEL_THRESH && anRVelY < KICK_VEL_THRESH * 0.5 && !this.airborne && now - this.kickCooldown.L > kickCooldownMs) {
      this.kickCooldown.L = now;
      s.events.push({ type: 'kick', side: 'L', power: clamp((anLVelY - KICK_VEL_THRESH) / 3, 0.2, 1.0), at: now });
      s.kickL = now;
    }
    if (anRVelY > KICK_VEL_THRESH && anLVelY < KICK_VEL_THRESH * 0.5 && !this.airborne && now - this.kickCooldown.R > kickCooldownMs) {
      this.kickCooldown.R = now;
      s.events.push({ type: 'kick', side: 'R', power: clamp((anRVelY - KICK_VEL_THRESH) / 3, 0.2, 1.0), at: now });
      s.kickR = now;
    }
    this.prevAnkleY.L = anL.y;
    this.prevAnkleY.R = anR.y;

    /* ---------------- arms up ---------------- */
    const armsUpNow = wrL.y < headY + 0.01 && wrR.y < headY + 0.01 ? 1 : 0;
    s.armsUp = damp(s.armsUp, armsUpNow, 10, dt);

    /* ---------------- pause gesture || (parallel arms overhead) ---------------- */
    const wristsAboveHead = wrL.y < headY - 0.03 && wrR.y < headY - 0.03;
    const elbowsAboveShoulders = elL.y < shL.y + 0.08 && elR.y < shR.y + 0.08;
    const wristDistX = Math.abs(wrR.x - wrL.x);
    const parallelRatio = shoulderW > 0.02 ? wristDistX / shoulderW : 1.0;
    // Parallel vertical pillars: wrists not crossed (wrL.x < wrR.x) and between 0.65x and 1.65x shoulder width
    const isPausePillars = wristsAboveHead && elbowsAboveShoulders && parallelRatio >= 0.65 && parallelRatio <= 1.65 && wrL.x < wrR.x;

    if (isPausePillars) {
      this.pauseHoldDuration = (this.pauseHoldDuration || 0) + dt;
      s.pauseProgress = clamp(this.pauseHoldDuration / 0.75, 0, 1);
      if (this.pauseHoldDuration >= 0.75 && now - (this.lastPauseToggleAt || 0) > 1800) {
        this.lastPauseToggleAt = now;
        this.pauseHoldDuration = 0;
        s.events.push({ type: 'pauseToggle', at: now });
      }
    } else {
      this.pauseHoldDuration = Math.max(0, (this.pauseHoldDuration || 0) - dt * 2.5);
      s.pauseProgress = clamp((this.pauseHoldDuration || 0) / 0.75, 0, 1);
    }
    s.pauseHold = s.pauseProgress;

    /* ---------------- dominant hand reach / extension ---------------- */
    let reachFWD_L = 0;
    let reachFWD_R = 0;
    if (worldLm && worldLm[LM.L_WRIST] && worldLm[LM.L_SHOULDER]) {
      reachFWD_L = -(worldLm[LM.L_WRIST].z - worldLm[LM.L_SHOULDER].z);
      reachFWD_R = -(worldLm[LM.R_WRIST].z - worldLm[LM.R_SHOULDER].z);
    } else {
      reachFWD_L = Math.hypot(wrL.x - shL.x, wrL.y - shL.y) / (shoulderW * 1.8);
      reachFWD_R = Math.hypot(wrR.x - shR.x, wrR.y - shR.y) / (shoulderW * 1.8);
    }
    s.reachForwardL = reachFWD_L;
    s.reachForwardR = reachFWD_R;

    if (reachFWD_R > 0.28 && reachFWD_R > reachFWD_L + 0.14) {
      this.domHoldR = (this.domHoldR || 0) + dt;
      this.domHoldL = 0;
    } else if (reachFWD_L > 0.28 && reachFWD_L > reachFWD_R + 0.14) {
      this.domHoldL = (this.domHoldL || 0) + dt;
      this.domHoldR = 0;
    } else {
      this.domHoldR = Math.max(0, (this.domHoldR || 0) - dt * 2.2);
      this.domHoldL = Math.max(0, (this.domHoldL || 0) - dt * 2.2);
    }

    s.dominantCandidate = this.domHoldR >= 0.65 ? 'R' : this.domHoldL >= 0.65 ? 'L' : null;
    s.dominantProgress = {
      R: clamp((this.domHoldR || 0) / 0.65, 0, 1),
      L: clamp((this.domHoldL || 0) / 0.65, 0, 1),
    };

    /* ---------------- crouch / duck ---------------- */
    if (this.standingHipY == null) this.standingHipY = hip.y;
    const duckRatio = CONFIG.motion?.duck?.hipDropThreshold || 0.08;
    const duckNow = clamp((hip.y - this.standingHipY) / (bodyH * duckRatio * 2.2), 0, 1);
    if (duckNow < 0.1) this.standingHipY += (hip.y - this.standingHipY) * 0.008;
    s.duck = damp(s.duck, duckNow, 12, dt);

    /* ---------------- wave to join ---------------- */
    const raisedL = handHighL;
    const raisedR = handHighR;
    const waveCfg = CONFIG.motion?.wave || { minChanges: 2, minSweepShoulderRatio: 0.13, lockoutDurationMs: 650, repeatCooldownMs: 1600 };

    if ((raisedL || raisedR) && Number.isFinite(shoulderW) && shoulderW > 0.02) {
      const wrist = raisedL && (!raisedR || wrL.y <= wrR.y) ? wrL : wrR;
      const nx = (wrist.x - sh.x) / shoulderW;
      this.waveHistory.push({ t: now, x: nx });
      const cutoff = now - 1200;
      while (this.waveHistory.length && this.waveHistory[0].t < cutoff) this.waveHistory.shift();

      let changes = 0;
      let lastSign = 0;
      let lastX = this.waveHistory[0]?.x ?? nx;
      for (const sample of this.waveHistory) {
        const dx = sample.x - lastX;
        if (Math.abs(dx) > waveCfg.minSweepShoulderRatio) {
          const sign = Math.sign(dx);
          if (lastSign && sign !== lastSign) changes++;
          lastSign = sign;
          lastX = sample.x;
        }
      }
      s.waveProgress = clamp(changes / waveCfg.minChanges, 0, 1);
      if (changes >= waveCfg.minChanges && now - this.lastWaveAt > waveCfg.repeatCooldownMs) {
        this.lastWaveAt = now;
        this.waveLockUntil = now + waveCfg.lockoutDurationMs;
        // A wave must never register as a punch, swing, push or rowing stroke.
        s.events = s.events.filter((e) => e.type !== 'punch' && e.type !== 'swing' && e.type !== 'stroke' && e.type !== 'push');
        s.waveAt = now;
        s.waveProgress = 1;
        s.events.push({ type: 'wave', hand: raisedL ? 'L' : 'R', at: now });
        this.standingHipY = hip.y;
      }
    } else {
      this.waveHistory.length = 0;
      s.waveProgress = damp(s.waveProgress, 0, 3, dt);
    }
    s.wave = damp(s.wave, now - this.lastWaveAt < 420 ? 1 : 0, 10, dt);

    /* ---------------- rowing ---------------- */
    const pullDist = (dist2(wrL.x, wrL.y, hip.x, hip.y) + dist2(wrR.x, wrR.y, hip.x, hip.y)) / 2;
    if (this.pullPrev != null) {
      const pullSpeed = (this.pullPrev - pullDist) / Math.max(dt, 0.01) / shoulderW;
      const rowNow = clamp(pullSpeed * 1.4, 0, 1);
      if (now >= this.waveLockUntil && !waveCandidate && pullSpeed > 0.9) {
        s.rowPower = damp(s.rowPower, rowNow, 20, dt);
        if (now - this.strokeCooldown > 380) {
          this.strokeCooldown = now;
          s.strokes++;
          s.events.push({ type: 'stroke', power: clamp(rowNow, 0.3, 1), at: now });
        }
      } else {
        s.rowPower = damp(s.rowPower, 0, 6, dt);
      }
    }
    this.pullPrev = pullDist;

    this.prev = {
      wrL,
      wrR,
      hip,
      sh,
      liftLUp,
      liftRUp,
      liftL,
      liftR,
      time: now,
    };

    if (s.events.length > 64) s.events.splice(0, s.events.length - 64);
    return s;
  }

  takeEvents() {
    const e = this.state.events;
    this.state.events = [];
    return e;
  }

  get features() {
    return this.state;
  }

  get run() { return this.state.run; }
  get jump() { return this.state.jump; }
  get lean() { return this.state.lean; }
  get armsUp() { return this.state.armsUp; }
  get duck() { return this.state.duck; }
  get rowPower() { return this.state.rowPower; }
  get block() { return this.state.block; }
  get guard() { return this.state.guard; }
  get swing() { return this.state.swing; }
  get wave() { return this.state.wave; }
  get waveAt() { return this.state.waveAt; }
  get waveProgress() { return this.state.waveProgress; }
  get cadence() { return this.state.cadence; }
  get steps() { return this.state.steps; }
  get handSpeed() { return this.state.handSpeed; }
  get extension() { return this.state.extension; }
  get bodyH() { return this.state.bodyH; }
  get shoulderW() { return this.state.shoulderW; }
  get hipY() { return this.state.hipY; }
  get noseY() { return this.state.noseY; }
  get ankleY() { return this.state.ankleY; }
  get wristL() { return this.state.wristL; }
  get wristR() { return this.state.wristR; }
  get hip() { return this.state.hip; }
  get confidence() { return this.state.confidence; }
  get lastSeen() { return this.state.lastSeen; }
  get punchL() { return this.state.punchL; }
  get punchR() { return this.state.punchR; }
  get kickL() { return this.state.kickL; }
  get kickR() { return this.state.kickR; }
  get energy() { return this.state.energy; }
  get legDrive() { return this.state.legDrive; }
  get armDrive() { return this.state.armDrive; }
  get kneeLiftL() { return this.state.kneeLiftL; }
  get kneeLiftR() { return this.state.kneeLiftR; }
  get shoulder() { return this.state.shoulder; }
  get handL() { return this.state.handL; }
  get handR() { return this.state.handR; }
  get elbowL() { return this.state.elbowL; }
  get elbowR() { return this.state.elbowR; }
  get shoulderTilt() { return this.state.shoulderTilt; }
  get torsoTwist() { return this.state.torsoTwist; }
  get punchQuality() { return this.state.punchQuality; }
  get punchMomentum() { return this.state.punchMomentum; }
  get punchReach() { return this.state.punchReach; }
  get punchSpeed() { return this.state.punchSpeed; }
  get punchAccel() { return this.state.punchAccel; }
  get punchAttempts() { return this.state.punchAttempts; }
  get lastPunch() { return this.state.lastPunch; }
  get pushAt() { return this.state.pushAt; }
  get pushPower() { return this.state.pushPower; }
  get pushCurve() { return this.state.pushCurve; }
  get pushAim() { return this.state.pushAim; }
  get pushCount() { return this.state.pushCount; }
}
