export const PET_COMMANDS: string[];
export function parsePetCommand(input: unknown): { action: string; raw: string };
export function shortcutAction(running: boolean): "start" | "stop";
export function resolveCommand(
  action: string,
  state: { running?: boolean; visible?: boolean },
): { start: boolean; show: boolean; stop: boolean };
