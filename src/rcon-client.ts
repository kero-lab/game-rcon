/**
 * RCON connection wrapper with auto-reconnect and error handling.
 *
 * Wraps the `rcon-client` library to provide:
 * - Lazy connection (connect on first command)
 * - Auto-reconnect on disconnection
 * - Connection state tracking
 * - Singleton pattern per host:port to prevent duplicate connections
 *
 * @remlab/game-rcon — Part of Game Server Ecosystem (#406)
 */

import { Rcon } from "rcon-client";
import type { RconConnectionOptions } from "./types";

/** Active connections keyed by "host:port" */
const connectionPool = new Map<string, GameRconClient>();

export class GameRconClient {
  private rcon: Rcon | null = null;
  private connecting = false;
  private readonly options: Required<RconConnectionOptions>;

  constructor(options: RconConnectionOptions) {
    this.options = {
      timeout: 5000,
      ...options,
    };
  }

  /**
   * Get or create a singleton client for a host:port combination.
   * Prevents multiple connections to the same RCON server from the same process.
   */
  static getInstance(options: RconConnectionOptions): GameRconClient {
    const key = `${options.host}:${options.port}`;
    let client = connectionPool.get(key);
    if (!client) {
      client = new GameRconClient(options);
      connectionPool.set(key, client);
    }
    return client;
  }

  /** Whether the RCON connection is currently authenticated and ready. */
  get connected(): boolean {
    return this.rcon?.authenticated === true;
  }

  /** Connect to the RCON server. Returns true if connected successfully. */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting) return false;

    this.connecting = true;
    try {
      const rcon = await Rcon.connect({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        timeout: this.options.timeout,
      });

      rcon.on("end", () => {
        this.rcon = null;
      });

      rcon.on("error", () => {
        this.rcon = null;
      });

      this.rcon = rcon;
      return true;
    } catch {
      this.rcon = null;
      return false;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Send a command to the RCON server.
   * Automatically connects if not already connected.
   * Returns null if the command could not be sent.
   */
  async send(command: string): Promise<string | null> {
    if (!this.connected) {
      const ok = await this.connect();
      if (!ok) return null;
    }

    try {
      const response = await this.rcon!.send(command);
      return response;
    } catch {
      // Connection likely dropped — clear it so next call reconnects
      this.rcon = null;
      return null;
    }
  }

  /** Disconnect from the RCON server. */
  async disconnect(): Promise<void> {
    if (this.rcon) {
      try {
        await this.rcon.end();
      } catch {
        // Ignore disconnect errors
      }
      this.rcon = null;
    }
    const key = `${this.options.host}:${this.options.port}`;
    connectionPool.delete(key);
  }
}
