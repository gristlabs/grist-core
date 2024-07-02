import {NTextBox} from "app/client/widgets/NTextBox";
import {ViewFieldRec} from "app/client/models/entities/ViewFieldRec";
import {DataRowModel} from "app/client/models/DataRowModel";
import {icon} from "app/client/ui2018/icons";
import {theme} from "app/client/ui2018/cssVars";
import {dom, styled} from "grainjs";

/**
 * User - The widget for displaying users from team.
 */
export class User extends NTextBox {
  constructor(field: ViewFieldRec) {
    super(field);
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];

    return cssUser(
      cssUserIcon('FieldUser'),
      dom.domComputed((use) => { return String(use(value)); })
    );
  }
}

const cssUser = styled('div.field_clip', ``);

const cssUserIcon = styled(icon, `
  float: left;
  --icon-color: ${theme.lightText};
  margin: -1px 2px 2px 0;
`);
