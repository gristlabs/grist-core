import {ISandbox} from 'app/server/lib/ISandbox';

export class NullSandbox implements ISandbox {
  public async shutdown(): Promise<unknown> {
    return undefined;
  }

  public async pyCall(_funcName: string, ..._varArgs: unknown[]) {
    return undefined;
  }

  public async reportMemoryUsage() {
    return undefined;
  }
}
