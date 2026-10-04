export function wasmSourceFingerprint(root: string): string;
export function wasmModuleIsCurrent(root: string): boolean;
export function buildWasm(root: string, options?: { force?: boolean }): Promise<void>;
export class WasmBuildError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number);
}
