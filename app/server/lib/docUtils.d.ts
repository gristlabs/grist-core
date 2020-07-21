export function makeIdentifier(name: string): string;
export function copyFile(src: string, dest: string): Promise<void>;
export function createNumbered(name: string, separator: string, creator: (path: string) => Promise<void>,
                               startNum?: number): Promise<string>;
export function createNumberedTemplate(template: string, creator: (path: string) => Promise<void>): Promise<string>;
export function createExclusive(path: string): Promise<void>;
export function realPath(path: string): Promise<string>;
export function pathExists(path: string): Promise<boolean>;
export function isSameFile(path1: string, path2: string): Promise<boolean>;
