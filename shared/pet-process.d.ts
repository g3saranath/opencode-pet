// Type declarations for shared/pet-process.js (CommonJS).

export interface ClosePetOptions {
  /** Path to the pet pid file (defaults to shared/paths PID_FILE). */
  pidFile?: string;
  /** Path to the heartbeat file (defaults to shared/paths HEARTBEAT_FILE). */
  heartbeatFile?: string;
  /** Liveness probe (defaults to shared/process-alive isProcessAlive). */
  isAlive?: (pid: number) => boolean;
  /** Signal sender (defaults to process.kill(pid)). */
  kill?: (pid: number) => void;
}

/** Reads the overlay pid from the pid file, or 0 when missing/invalid. */
export declare function readPetPid(pidFile?: string): number;

/**
 * Stops the heartbeat and signals the overlay to quit if its pid is still
 * alive. Returns true when a live pid was signalled.
 */
export declare function closePetProcess(options?: ClosePetOptions): boolean;
