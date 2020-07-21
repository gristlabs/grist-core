// subset of WebStorage API
export interface Storage {
  getItem(key: string): any;
  hasItem(key: string): boolean;
  setItem(key: string, value: any): void;
  removeItem(key: string): void;
  clear(): void;
}
