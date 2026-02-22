/**
 * @remlab/game-rcon — Shared RCON integration for game servers.
 *
 * Provides typed RCON clients for game servers managed by Pterodactyl.
 * Used by rem-bot (Discord), KeroHub (player portal), and RemHub (operator dashboard).
 *
 * Part of Game Server Ecosystem (#406)
 */

export { GameRconClient } from "./rcon-client";
export { FactorioRcon } from "./factorio";
export type {
  RconConnectionOptions,
  FactorioRconOptions,
  FactorioStats,
} from "./types";
