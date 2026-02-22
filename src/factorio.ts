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
import type {
  FactorioRconOptions,
  FactorioStats,
  FactorioExtendedStats,
  FactorioProductionRate,
  FactorioResearchStatus,
} from "./types";

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

  /** Items to track production rates for. */
  private static readonly TRACKED_ITEMS: ReadonlyArray<{
    item: string;
    displayName: string;
  }> = [
    { item: "iron-plate", displayName: "Iron Plates" },
    { item: "copper-plate", displayName: "Copper Plates" },
    { item: "steel-plate", displayName: "Steel Plates" },
    { item: "electronic-circuit", displayName: "Green Circuits" },
    { item: "advanced-circuit", displayName: "Red Circuits" },
    { item: "processing-unit", displayName: "Blue Circuits" },
  ];

  /**
   * Query extended Factorio stats via RCON.
   *
   * Fires additional Lua queries for production rates, pollution,
   * and research on top of the basic stats.
   *
   * Production data uses `get_flow_count` with
   * `defines.flow_precision_index.ten_minutes` (items/s averaged
   * over the last 10 game-minutes).
   */
  async getExtendedStats(): Promise<FactorioExtendedStats> {
    const basic = await this.getStats();

    if (!basic.rconAvailable) {
      return {
        basic,
        production: [],
        pollution: null,
        research: { name: null, progress: null },
        queriedAt: basic.queriedAt,
      };
    }

    // Single Lua script that queries all tracked items and returns pipe-delimited output
    const itemList = FactorioRcon.TRACKED_ITEMS.map(
      (i) => `"${i.item}"`
    ).join(",");
    const productionLua = `/sc local items={${itemList}} local f=game.forces["player"] local r={} for _,item in ipairs(items) do local p=f.item_production_statistics.get_flow_count{name=item,input=true,precision_index=defines.flow_precision_index.ten_minutes,count=false} local c=f.item_production_statistics.get_flow_count{name=item,input=false,precision_index=defines.flow_precision_index.ten_minutes,count=false} table.insert(r,item..":"..string.format("%.4f",p)..":"..string.format("%.4f",c)) end rcon.print(table.concat(r,"|"))`;

    const pollutionLua =
      '/sc rcon.print(string.format("%.2f", game.surfaces[1].get_total_pollution()))';

    const researchLua =
      '/sc local t=game.forces["player"].current_research if t then rcon.print(t.name..":"..string.format("%.4f",game.forces["player"].research_progress)) else rcon.print("none") end';

    const [prodRes, pollRes, resRes] = await Promise.allSettled([
      this.client.send(productionLua),
      this.client.send(pollutionLua),
      this.client.send(researchLua),
    ]);

    return {
      basic,
      production: parseProductionRates(settled(prodRes)),
      pollution: parseFloat(settled(pollRes) ?? "") || null,
      research: parseResearch(settled(resRes)),
      queriedAt: new Date().toISOString(),
    };
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

// ─── Extended Stats Parsers ─────────────────────────────────

const DISPLAY_NAMES: Record<string, string> = {
  "iron-plate": "Iron Plates",
  "copper-plate": "Copper Plates",
  "steel-plate": "Steel Plates",
  "electronic-circuit": "Green Circuits",
  "advanced-circuit": "Red Circuits",
  "processing-unit": "Blue Circuits",
};

/**
 * Parse production rates from Lua output.
 * Format: "iron-plate:1.2300:0.4500|copper-plate:2.3400:1.5600"
 */
function parseProductionRates(
  response: string | null
): FactorioProductionRate[] {
  if (!response) return [];

  return response
    .split("|")
    .map((segment) => {
      const [item, producedStr, consumedStr] = segment.split(":");
      if (!item) return null;
      return {
        item,
        displayName: DISPLAY_NAMES[item] ?? item,
        produced: parseFloat(producedStr) || 0,
        consumed: parseFloat(consumedStr) || 0,
      };
    })
    .filter((r): r is FactorioProductionRate => r !== null);
}

/**
 * Parse research status from Lua output.
 * Format: "automation-2:0.4523" or "none"
 */
function parseResearch(response: string | null): FactorioResearchStatus {
  if (!response || response.trim() === "none") {
    return { name: null, progress: null };
  }
  const parts = response.trim().split(":");
  return {
    name: parts[0] ?? null,
    progress: parts[1] ? parseFloat(parts[1]) : null,
  };
}
