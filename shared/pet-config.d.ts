export interface PetConfig {
  version: number;
  enabled: boolean;
  autoLaunch: boolean;
  pet: string;
  scale: number;
  animationSpeed: number;
  muted: boolean;
  autoHideFullscreen: boolean;
  feed: boolean;
  visible: boolean;
}
export function normalizeConfig(raw: unknown): PetConfig;
export function normalizePosition(raw: unknown): { x: number; y: number } | null;
export function readConfig(options?: { dir?: string }): PetConfig;
export function writeConfig(config: Partial<PetConfig>, options?: { dir?: string }): PetConfig;
export function updateConfig(patch: Partial<PetConfig>, options?: { dir?: string }): PetConfig;
export function readPosition(options?: { dir?: string }): { x: number; y: number } | null;
export function writePosition(position: { x: number; y: number }, options?: { dir?: string }): { x: number; y: number } | null;