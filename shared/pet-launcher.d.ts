export interface LaunchResult {
  launched: boolean;
  reason?: string;
  appDir?: string;
}
export function resolveAppDir(extraCandidates?: string[]): string;
export function launchPet(options?: any): LaunchResult;
export function petAlreadyRunning(options?: any): boolean;
export function acquireLaunchLock(dir: string, staleMs?: number): string | null;
export function releaseLaunchLock(file: string | null): void;
export function isSafeCmdPath(value: unknown): boolean;
export function hasElectron(dir: string): boolean;
export function resolveElectronBin(appDir: string, platform?: string): { bin: string; shell: boolean } | undefined;
