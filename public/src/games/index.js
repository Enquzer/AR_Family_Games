/** Game factory (imports the heavy Three.js-backed games). */
import { TrackGame } from './track.js';
import { BoxingGame } from './boxing.js';
import { TennisGame } from './tennis.js';
import { BoatGame } from './boat.js';
import { CoasterGame } from './coaster.js';
import { DanceGame } from './dance.js';
import { BallingGame } from './balling.js';
import { BowlingGame } from './bowling.js';
import { ArcheryGame } from './archery.js';

export class SprintGame extends TrackGame {
  constructor(ctx, options = {}) {
    super(ctx, { ...options, id: 'sprint', title: '200m SPRINT', subtitle: 'Olympic Track & Field · 3 Heats', distance: 200, heats: 3, maxSpeed: 10.4 });
  }
}

export class HurdlesGame extends TrackGame {
  constructor(ctx, options = {}) {
    super(ctx, {
      ...options,
      id: 'hurdles',
      title: '110m HURDLES',
      subtitle: 'Olympic Track & Field · 3 Heats',
      distance: 110,
      heats: 3,
      maxSpeed: 9.8,
      hurdles: [16, 26, 36, 46, 56, 66, 76, 86, 96],
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
  bowling: BowlingGame,
  archery: ArcheryGame,
};

export function createGame(id, ctx, options = {}) {
  const Cls = GAME_CLASSES[id] || BoxingGame;
  const game = new Cls(ctx, options);
  game.init();
  return game;
}
