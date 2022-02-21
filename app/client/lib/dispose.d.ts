// TODO: add remaining Disposable method
export abstract class Disposable {
  public static create<T extends new (...args: any[]) => any>(
    this: T, ...args: ConstructorParameters<T>): InstanceType<T>;

  constructor(...args: any[]);
  public dispose(): void;
  public isDisposed(): boolean;
  public autoDispose<T>(obj: T): T;
  public autoDisposeCallback(callback: () => void): void;
  public disposeRelease<T>(obj: T): T;
  public disposeDiscard(obj: any): void;
  public makeDisposable(obj: any): void;
}

export function emptyNode(node: Node): void;
