// Type declarations for shared/desktop-follow.js (CommonJS).

export type DesktopMode = "follow" | "off";
export type DesktopProbe = "present" | "absent" | "unknown";

export interface DesktopFollowConfig {
  mode: DesktopMode;
  processName: string;
  source: "env" | "default";
}

export interface TasklistRow {
  name: string;
  pid: number;
}

export interface ProbeOptions {
  execFile?: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    callback: (error: any, stdout?: string, stderr?: string) => void,
  ) => unknown;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  resolveTimeoutMs?: number;
  cache?: Map<string, number>;
}

export declare function resolveAppProcess(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): DesktopFollowConfig;

export declare function parseTasklist(stdout: string, processName: string): boolean;

export declare function parseTasklistRows(stdout: string, processName: string): TasklistRow[];

export declare function probeDesktopApp(
  config: DesktopFollowConfig,
  options?: ProbeOptions,
): Promise<DesktopProbe>;

export declare function resetProbeCache(cache?: Map<string, number>): void;

export declare const OFF_VALUES: ReadonlySet<string>;
export declare const PROBE_TIMEOUT_MS: number;
export declare const RESOLVE_TIMEOUT_MS: number;
