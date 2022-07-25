export interface IShell {
  trashItem(docPath: string): Promise<void>;
  showItemInFolder(docPath: string): void;
}
