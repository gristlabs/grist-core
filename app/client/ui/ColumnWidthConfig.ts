import { makeT } from "app/client/lib/localization";
import { DocModel, ViewFieldRec } from "app/client/models/DocModel";
import { cssLabel, cssNumericSpinner, cssRow } from "app/client/ui/RightPanelStyles";
import { testId } from "app/client/ui2018/cssVars";
import { components } from "app/common/ThemePrefs";

import { Computed, dom, DomContents, fromKo, IDisposableOwner, styled } from "grainjs";
import * as ko from "knockout";

const t = makeT("ColumnWidthConfig");

// Same minimum as when resizing a column by dragging its border.
const MIN_WIDTH = 10;

/**
 * Builds the column width setting shown in the creator panel for columns of grid widgets. It
 * applies to all the given fields (several when multiple columns are selected). An empty value
 * stands for the widget's default width, which is how a width of 0 is interpreted.
 */
export function columnWidthConfig(docModel: DocModel, fields: ko.Computed<ViewFieldRec[]>): DomContents {
  return [
    cssLabel(t("COLUMN WIDTH"), { id: "column-width-label" }),
    // Rebuilt when the selection changes, so that a value being typed is never saved to other columns.
    dom.domComputed(fromKo(fields), list => dom.create(buildWidthSpinner, docModel, list)),
  ];
}

function buildWidthSpinner(owner: IDisposableOwner, docModel: DocModel, fields: ViewFieldRec[]) {
  // The width stored in all fields (0 for the default width), or null if they differ.
  const commonWidth = Computed.create<number | null>(owner, (use) => {
    const widths = fields.map(field => use(field.width));
    return widths.every(w => w === widths[0]) ? (widths[0] ?? 0) : null;
  });
  const value = Computed.create<number | "">(owner, use => use(commonWidth) || "");
  const defaultWidth = Computed.create<number>(owner, use =>
    fields.length ? use(use(fields[0].viewSection).defaultWidth) : 0);
  const placeholder = Computed.create<string>(owner, use =>
    use(commonWidth) === null ? t("Mixed") : String(use(defaultWidth)));

  const save = async (width?: number) => {
    const newWidth = width ?? 0;
    const changed = fields.filter(field => !field.isDisposed() && field.width.peek() !== newWidth);
    if (!changed.length) { return; }
    await docModel.viewFields.sendTableAction(["BulkUpdateRecord", changed.map(field => field.id.peek()),
      { width: changed.map(() => newWidth) }]);
  };

  return cssRow(
    cssNumericSpinner(value,
      {
        defaultValue: defaultWidth,
        minValue: MIN_WIDTH,
        save,
        inputArgs: [
          { "aria-labelledby": "column-width-label" },
          dom.prop("placeholder", placeholder),
          dom.style("width", "7em"),
        ],
      },
      dom.style("flex", "none"),
      testId("column-width"),
    ),
    cssUnit("px"),
  );
}

const cssUnit = styled("span", `
  margin-left: 8px;
  color: ${components.lightText};
`);
