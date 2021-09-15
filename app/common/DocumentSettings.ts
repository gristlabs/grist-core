export interface DocumentSettings {
  locale: string;
  currency?: string;
  engine?: EngineCode;
}

/**
 * The back-end will for now support at most two engines, a pynbox-backed python2 and
 * a gvisor-backed python3.
 */
export type EngineCode = 'python2' | 'python3';
