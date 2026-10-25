/** Game factory (imports the heavy Three.js-backed games). */
import { TrackGame } from './track.js';
import { BoxingGame } from './boxing.js';
import { TennisGame } from './tennis.js';
import { BoatGame } from './boat.js';
import { CoasterGame } from './coaster.js';
import { DanceGame } from './dance.js';
import { BallingGame } from './balling.js';

export class SprintGame extends TrackGame {
  constructor(ctx, options = {}) {
    super(ctx, { ...options, id: 'sprint', title: 'SPRINT', subtitle: 'Run in place · three heats', distance: 60, heats: 3, maxSpeed: 10.2 });
  }
}

export class HurdlesGame extends TrackGame {
  constructor(ctx, options = {}) {
    super(ctx, {
      ...options,
      id: 'hurdles',
      title: 'HURDLES',
      subtitle: 'Run and jump · 80 metres',
      distance: 80,
      heats: 3,
      maxSpeed: 9.4,
      hurdles: [12, 24, 36, 48, 60, 72],
    });
  }
}

export const GAME_CLASSES = {
  boxing: BoxingGame,
  tennis: TennisGame,
  sprint: SprintGame,
  hurdles: HurdlesGame,
  boat: BoatGame,
  coaster: CoasterGame,
  dance: DanceGame,
  balling: BallingGame,
};

export function createGame(id, ctx, options = {}) {
  const Cls = GAME_CLASSES[id] || BoxingGame;
  const game = new Cls(ctx, options);
  game.init();
  return game;
}
