// Type declarations for shared/electron-bin.js (CommonJS).

export interface ElectronBin {
  /** Absolute path to a spawnable Electron binary. */
  bin: string;
  /** Whether spawn() needs `shell: true` (Windows `.cmd` shim). */
  shell: boolean;
}

export declare function resolveElectronBin(
  appDir: string,
  platform?: NodeJS.Platform,
): ElectronBin | undefined;

export declare function hasElectron(appDir: string, platform?: NodeJS.Platform): boolean;
