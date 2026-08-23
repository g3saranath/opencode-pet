// Type declarations for shared/state-protocol.js (CommonJS).

// Single plain union of valid pet states — keep in sync with shared/states.json.
export type PetState =
  | "idle" | "thinking" | "working" | "waiting" | "happy" | "error" | "sleeping";

export interface StateWriterOptions {
  dir?: string;
  stateFile?: string;
  tmpFile?: string;
}

// Returns true when a write actually happened; false when deduped or on error.
export type StateWriter = (
  state: PetState,
  extra?: Record<string, unknown>,
  feed?: ReadonlyArray<Record<string, unknown>>,
) => boolean;

export declare function createStateWriter(options?: StateWriterOptions): StateWriter;

export interface PetPayload {
  state: PetState;
  ts: number;
  feed?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// Falls back to `{ state: "idle" }` on missing/corrupt file or unknown state.
export declare function readState(stateFile?: string): PetPayload;
