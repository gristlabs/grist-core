import {ISandbox} from 'app/server/lib/ISandbox';

export class UnavailableSandboxMethodError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class NullSandbox implements ISandbox {
  public async shutdown(): Promise<unknown> {
    throw new UnavailableSandboxMethodError('shutdown is not available');
  }

  public async pyCall(_funcName: string, ..._varArgs: unknown[]) {
    throw new UnavailableSandboxMethodError('pyCall is not available');
  }

  public async reportMemoryUsage() {
    throw new UnavailableSandboxMethodError('reportMemoryUsage is not available');
  }
}
