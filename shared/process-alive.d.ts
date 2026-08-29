// Type declarations for shared/process-alive.js (CommonJS).

/**
 * Probes whether `pid` refers to a running process.
 * EPERM (process exists, different owner) counts as alive; only ESRCH and
 * invalid pids count as dead.
 */
export declare function isProcessAlive(pid: number): boolean;
