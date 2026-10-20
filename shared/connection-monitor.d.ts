// Type declarations for shared/connection-monitor.js (CommonJS).

export type ConnectionStatus = "connected" | "sleeping" | "quit";

export interface ConnectionSample {
  now?: number;
  lastBeat?: number;
  pidAlive?: boolean;
  startedAt?: number;
}

export interface ConnectionMonitor {
  sample(input?: ConnectionSample): ConnectionStatus;
  readonly misses: number;
  readonly sleepingSince: number;
}

export interface ConnectionMonitorOptions {
  heartbeatTimeoutMs?: number;
  sleepQuitMs?: number;
}

export declare function createConnectionMonitor(
  options?: ConnectionMonitorOptions,
): ConnectionMonitor;
