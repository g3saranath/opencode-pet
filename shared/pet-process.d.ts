export function readPetPid(pidFile?: string): number;
export function closePetProcess(options?: {
  pidFile?: string;
  heartbeatFile?: string;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
}): boolean;
