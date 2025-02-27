import {TableDataAction} from 'app/common/DocActions';
import {schema} from 'app/common/schema';

export const META_TABLES: {[tableId: string]: TableDataAction} = Object.fromEntries(
  Object.keys(schema).map(tableId => [tableId, ['TableData', tableId, [], {}]])
);
