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
