import {DocAction} from 'app/common/DocActions';

export interface Prompt {
  tableId: string;
  colId: string
  description: string;
}

export interface Suggestion {
  suggestedActions: DocAction[];
}
