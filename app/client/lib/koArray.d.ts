import * as ko from 'knockout';

declare class KoArray<T> {
  public static syncedKoArray(...args: any[]): any;
  public peekLength: number;
  public subscribe: ko.Observable["subscribe"];

  public dispose(): void;
  public at(index: number): T|null;
  public all(): T[];
  public map<T2>(op: (x: T) => T2): KoArray<T2>;
  public peek(): T[];
  public getObservable(): ko.Observable<T[]>;
  public push(...items: T[]): void;
  public unshift(...items: T[]): void;
  public assign(newValues: T[]): void;
  public splice(start: number, optDeleteCount?: number, ...values: T[]): T[];
  public subscribeForEach(options: {
    add?: (item: T, index: number, arr: KoArray<T>) => void;
    remove?: (item: T, arr: KoArray<T>) => void;
    addDelay?: number;
  }): ko.Subscription;

  public clampIndex(index: number): number|null;
  public makeLiveIndex(index?: number): ko.Observable<number> & {setLive(live: boolean): void};
  public setAutoDisposeValues(): this;
  public arraySplice(start: number, deleteCount: number, items: T[]): T[];
}

declare function syncedKoArray(...args: any[]): any;

export default function koArray<T>(initialValue?: T[]): KoArray<T>;
export function isKoArray(obj: any): obj is KoArray<any>;
