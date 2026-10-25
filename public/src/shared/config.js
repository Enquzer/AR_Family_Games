/**
 * AR Family Games - Central Configuration & Tuning Parameters.
 * 
 * Centralizes magic numbers and thresholds so they can be tuned,
 * swept in headless test suites, or adapted per-player.
 */

export const CONFIG = {
  // One Euro filter parameters
  filter: {
    // Standard visual / posture stream (smooth, low jitter)
    smooth: {
      minCutoff: 1.2, // Hz
      beta: 5.0,      // velocity factor for normalized coords
      dCutoff: 1.5,   // Hz
    },
    // Fast onset stream (low latency for strikes, punches, swings)
    fast: {
      minCutoff: 2.2,
      beta: 14.0,
      dCutoff: 2.0,
    },
    // Metric world landmarks stream (meters)
    world: {
      minCutoff: 1.4,
      beta: 4.5,
      dCutoff: 1.5,
    },
    // Depth (Z) stream (noisier)
    z: {
      minCutoff: 0.6,
      beta: 2.0,
      dCutoff: 1.2,
    },
    occlusionVisibilityThreshold: 0.15,
  },

  // Multi-person tracker parameters
  tracker: {
    maxPlayers: 4,
    maxDistance: 0.28,      // gating distance in normalized units
    gateCost: 0.95,         // Hungarian cost threshold for match
    weights: {
      pos: 0.55,            // predicted hip center distance
      scale: 0.20,          // torso/body scale ratio
      shape: 0.25,          // visibility-weighted joint shape distance
    },
    crossingDist: 0.12,     // distance threshold triggering crossing mode
    tentativeHits: 3,       // hits required in 5 frames to confirm track
    tentativeWindow: 5,
    ttlInGameMs: 1200,      // track coasting TTL during match
    ttlMenuMs: 3000,        // track coasting TTL in menu
    pruneTimeoutMs: 15000,  // full release of inactive player profile
  },

  // Motion feature pipeline parameters
  motion: {
    ringBufferSize: 30,     // 0.5s buffer at 60 Hz
    wave: {
      minChanges: 2,
      minSweepShoulderRatio: 0.13,
      lockoutDurationMs: 650,
      repeatCooldownMs: 1600,
    },
    punch: {
      minForwardSpeedMps: 1.15, // m/s in world landmarks
      minArmExtension: 0.75,    // fraction of full reach
      cooldownMs: 220,
      powerScale: 3.2,
    },
    push: {
      handsNearShoulderRatio: 1.85,
      minForwardSpeed: 0.85,
      cooldownMs: 450,
    },
    kick: {
      velThreshold: 1.7,
      cooldownMs: 480,
    },
    duck: {
      hipDropThreshold: 0.08, // fraction of body height
    },
  },

  // Balling pool physics parameters
  pool: {
    simRateHz: 240,         // fixed simulation step (1 / 240 s)
    ballRadius: 0.14,
    tableWidth: 6.4,
    tableHeight: 10.4,
    cushionRestitution: 0.93,
    cushionRestitutionDecay: 0.02, // restitution = 0.93 - 0.02 * v_normal
    cushionFriction: 0.14,
    ballRestitution: 0.95,
    ballRestitutionDecay: 0.016,
    ballBallFriction: 0.05,
    slidingFriction: 0.22,
    rollingResistanceViscous: 0.30,
    rollingResistanceConst: 0.22,
    spinDecayRate: 1.25,
    englishTransferRatio: 1.65,
    arcadeCurveFactor: 0.65, // arcade lateral curving feel
    pocketRadius: 0.34,
    maxSpeed: 22.0,
    settleSpeed: 0.035,
    settleTimeSec: 0.5,
  },

  // Avatar procedural inverse kinematics parameters
  avatar: {
    footPlanting: {
      ankleSpeedPlantThreshold: 0.32,  // speed / bodyH
      ankleHeightPlantThreshold: 0.038, // (ankle.y - floorY) / bodyH
      releaseHeightThreshold: 0.065,
      releaseSpeedThreshold: 0.75,
      stableFramesToPlant: 3,
      blendRate: 24.0,                 // exponential blend speed
      rootDeadzone: 0.035,             // deadzone for horizontal root drift
    },
    kneeJointLimits: {
      minAngleRad: 0.05,               // ~3 deg
      maxAngleRad: 2.65,               // ~152 deg
    },
  },

  // Dance timing and DTW scoring parameters
  dance: {
    dtwPadFrames: 9,          // 0.3s at 30 Hz
    sakoeChibaBand: 4,
    timingToleranceSec: 0.25,
    perfectTimingSec: 0.085,
    greatTimingSec: 0.165,
    goodTimingSec: 0.265,
    mirrorVoteMoves: 4,
  },
};
