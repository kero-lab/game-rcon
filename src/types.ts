/**
 * Shared types for game server RCON integration.
 *
 * @remlab/game-rcon — Part of Game Server Ecosystem (#406)
 */

// ─── RCON Client Types ──────────────────────────────────────

export interface RconConnectionOptions {
  host: string;
  port: number;
  password: string;
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number;
}

// ─── Factorio Types ─────────────────────────────────────────

export interface FactorioRconOptions extends RconConnectionOptions {
  /** Cache TTL in milliseconds (default: 45000) */
  cacheTtlMs?: number;
}

export interface FactorioStats {
  /** Biter evolution factor (0.0 - 1.0), null if unavailable */
  evolution: number | null;
  /** Map age in game ticks (60 ticks = 1 second), null if unavailable */
  mapAgeTicks: number | null;
  /** Human-readable map age (e.g. "12h 34m"), null if unavailable */
  mapAgeFormatted: string | null;
  /** Total rockets launched, null if unavailable */
  rocketsLaunched: number | null;
  /** Map seed string, null if unavailable */
  seed: string | null;
  /** Server version string, null if unavailable */
  version: string | null;
  /** List of currently online player names */
  onlinePlayers: string[];
  /** Whether RCON was reachable for this query */
  rconAvailable: boolean;
  /** ISO timestamp of when these stats were queried */
  queriedAt: string;
}

// ─── Factorio Extended Stats (Phase 2) ──────────────────────

/** Production rate for a single item type */
export interface FactorioProductionRate {
  /** Item prototype name (e.g. "iron-plate") */
  item: string;
  /** Display name for UI */
  displayName: string;
  /** Items produced per second (averaged over 10 minutes) */
  produced: number;
  /** Items consumed per second (averaged over 10 minutes) */
  consumed: number;
}

/** Current research status */
export interface FactorioResearchStatus {
  /** Technology name being researched, null if none */
  name: string | null;
  /** Research progress 0.0 - 1.0, null if none */
  progress: number | null;
}

/** Extended stats including production, pollution, research */
export interface FactorioExtendedStats {
  /** All basic stats (evolution, rockets, etc.) */
  basic: FactorioStats;
  /** Production rates for tracked items */
  production: FactorioProductionRate[];
  /** Total pollution on the surface */
  pollution: number | null;
  /** Current research status */
  research: FactorioResearchStatus;
  /** ISO timestamp */
  queriedAt: string;
}
