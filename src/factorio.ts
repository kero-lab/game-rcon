/**
 * Factorio RCON client with typed commands and response parsers.
 *
 * Provides high-level methods to query Factorio server stats via RCON:
 * - Evolution factor, rockets launched, map age
 * - Online players, server version, map seed
 *
 * Uses `/sc rcon.print(...)` for Lua queries (silent command — avoids
 * achievements-disabled warning and console spam).
 *
 * @remlab/game-rcon — Part of Game Server Ecosystem (#406), Issue #489
 */

import { GameRconClient } from "./rcon-client";
import type { FactorioRconOptions, FactorioStats } from "./types";

const DEFAULT_CACHE_TTL = 45_000; // 45 seconds

export class FactorioRcon {
  private readonly client: GameRconClient;
  private readonly cacheTtlMs: number;
  private cache: { stats: FactorioStats; timestamp: number } | null = null;

  constructor(options: FactorioRconOptions) {
    this.client = GameRconClient.getInstance(options);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL;
  }

  /**
   * Query all Factorio server stats via RCON.
   *
   * Fires 6 RCON queries in parallel. Individual failures are handled
   * gracefully — if one query fails, others still return data.
   *
   * Results are cached for `cacheTtlMs` (default 45s) to prevent
   * hammering the game server.
   */
  async getStats(): Promise<FactorioStats> {
    // Return cached stats if fresh
    if (this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.stats;
    }

    const unavailable: FactorioStats = {
      evolution: null,
      mapAgeTicks: null,
      mapAgeFormatted: null,
      rocketsLaunched: null,
      seed: null,
      version: null,
      onlinePlayers: [],
      rconAvailable: false,
      queriedAt: new Date().toISOString(),
    };

    // Attempt connection (lazy — only connects if not already connected)
    const connected = await this.client.connect();
    if (!connected) return unavailable;

    // Fire all queries in parallel — one failure doesn't block others
    const [evoRes, timeRes, seedRes, versionRes, playersRes, rocketsRes] =
      await Promise.allSettled([
        this.client.send("/evolution"),
        this.client.send("/time"),
        this.client.send("/seed"),
        this.client.send("/version"),
        this.client.send("/players online"),
        this.client.send(
          "/sc rcon.print(game.forces['player'].rockets_launched)"
        ),
      ]);

    const stats: FactorioStats = {
      evolution: parseEvolution(settled(evoRes)),
      mapAgeTicks: parseMapTime(settled(timeRes)),
      mapAgeFormatted: formatMapTime(parseMapTime(settled(timeRes))),
      rocketsLaunched: parseNumber(settled(rocketsRes)),
      seed: settled(seedRes)?.trim() || null,
      version: parseVersion(settled(versionRes)),
      onlinePlayers: parsePlayers(settled(playersRes)),
      rconAvailable: true,
      queriedAt: new Date().toISOString(),
    };

    // Cache the result
    this.cache = { stats, timestamp: Date.now() };
    return stats;
  }

  /** Send a raw RCON command. Returns null if unavailable. */
  async sendCommand(command: string): Promise<string | null> {
    return this.client.send(command);
  }

  /** Invalidate the stats cache (force fresh query on next getStats call). */
  clearCache(): void {
    this.cache = null;
  }

  /** Disconnect from RCON. */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.cache = null;
  }
}

// ─── Response Parsers ───────────────────────────────────────

/** Extract fulfilled value from a PromiseSettledResult. */
function settled(
  result: PromiseSettledResult<string | null>
): string | null {
  return result.status === "fulfilled" ? result.value : null;
}

/**
 * Parse evolution factor from RCON response.
 * Response formats: "Evolution factor: 0.1234" or just "0.1234"
 */
function parseEvolution(response: string | null): number | null {
  if (!response) return null;
  const match = response.match(/([\d.]+)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return isNaN(value) ? null : value;
}

/**
 * Parse map time from RCON response.
 * Response format varies by Factorio version:
 * - Ticks: "123456" or similar numeric
 * - Formatted: "5 hours, 23 minutes and 10 seconds"
 * - Mixed: may include "day", "hour", "minute"
 */
function parseMapTime(response: string | null): number | null {
  if (!response) return null;

  // Try parsing as formatted time "X days, Y hours, Z minutes and W seconds"
  let totalSeconds = 0;
  let matched = false;

  const dayMatch = response.match(/(\d+)\s*day/i);
  if (dayMatch) {
    totalSeconds += parseInt(dayMatch[1], 10) * 86400;
    matched = true;
  }

  const hourMatch = response.match(/(\d+)\s*hour/i);
  if (hourMatch) {
    totalSeconds += parseInt(hourMatch[1], 10) * 3600;
    matched = true;
  }

  const minMatch = response.match(/(\d+)\s*minute/i);
  if (minMatch) {
    totalSeconds += parseInt(minMatch[1], 10) * 60;
    matched = true;
  }

  const secMatch = response.match(/(\d+)\s*second/i);
  if (secMatch) {
    totalSeconds += parseInt(secMatch[1], 10);
    matched = true;
  }

  if (matched) {
    return totalSeconds * 60; // Convert to ticks (60 ticks/second)
  }

  // Fall back to raw numeric (assume ticks)
  const tickMatch = response.match(/(\d+)/);
  if (tickMatch) return parseInt(tickMatch[1], 10);

  return null;
}

/** Format ticks to human-readable duration. */
function formatMapTime(ticks: number | null): string | null {
  if (ticks === null) return null;
  const totalSeconds = Math.floor(ticks / 60);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Parse a simple numeric response (e.g. rockets launched). */
function parseNumber(response: string | null): number | null {
  if (!response) return null;
  const match = response.match(/(\d+)/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return isNaN(value) ? null : value;
}

/**
 * Parse version string from RCON response.
 * Response format: "Version: 2.0.28 (build 72928, linux64, headless)"
 * We extract just the version number.
 */
function parseVersion(response: string | null): string | null {
  if (!response) return null;
  // Try to extract version number like "2.0.28"
  const match = response.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : response.trim() || null;
}

/**
 * Parse player list from RCON response.
 * Response format:
 *   "Online players (2):\n  player1\n  player2"
 *   "Online players (0):"
 */
function parsePlayers(response: string | null): string[] {
  if (!response) return [];

  // Check for "(0)" — no players
  if (/\(0\)/.test(response)) return [];

  // Split by newlines, skip the header line
  const lines = response.split("\n");
  const players: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const name = lines[i].trim();
    // Skip empty lines and "(offline)" markers
    if (name && !name.startsWith("(") && name !== "") {
      players.push(name);
    }
  }

  return players;
}
