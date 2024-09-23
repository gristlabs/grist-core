import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {TableRec} from 'app/client/models/DocModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {cssCode} from 'app/client/ui/DocTutorial';
import {Tooltip} from 'app/client/ui/GristTooltips';
import {
  cssLabelText,
  cssRow,
  cssSeparator
} from 'app/client/ui/RightPanelStyles';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {textButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {confirmModal} from 'app/client/ui2018/modals';
import {not} from 'app/common/gutil';
import {Computed, Disposable, dom, styled} from 'grainjs';

const t = makeT('ReverseReferenceConfig');

/**
 * Configuratino for two-way reference column shown in the right panel.
 */
export class ReverseReferenceConfig extends Disposable {
  private _refTable: Computed<TableRec | null>;
  private _isConfigured: Computed<boolean>;
  private _reverseTable: Computed<string>;
  private _reverseColumn: Computed<string>;
  private _reverseType: Computed<string>;
  private _disabled: Computed<boolean>;
  private _tooltip: Computed<Tooltip>;

  constructor(private _field: ViewFieldRec) {
    super();

    this._refTable = Computed.create(this, (use) => use(use(this._field.column).refTable));
    this._isConfigured = Computed.create(this, (use) => {
      const column = use(this._field.column);
      return use(column.hasReverse);
    });
    this._reverseTable = Computed.create(this, this._refTable, (use, refTable) => {
      return refTable ? use(refTable.tableNameDef) : '';
    });
    this._reverseColumn = Computed.create(this, (use) => {
      const column = use(this._field.column);
      const reverseCol = use(column.reverseColModel);
      return reverseCol ? use(reverseCol.label) ?? use(reverseCol.colId) : '';
    });
    this._reverseType = Computed.create(this, (use) => {
      const column = use(this._field.column);
      const reverseCol = use(column.reverseColModel);
      return reverseCol ? use(reverseCol.pureType) : '';
    });
    this._disabled = Computed.create(this, (use) => {
      // If is formula or is trigger formula.
      const column = use(this._field.column);
      return Boolean(use(column.formula));
    });
    this._tooltip = Computed.create(this, (use) => {
      return use(this._disabled)
        ? 'twoWayReferencesDisabled'
        : 'twoWayReferences';
    });
  }

  public buildDom() {
    return dom('div',
      dom.maybe(not(this._isConfigured), () => [
        cssRow(
          dom.style('margin-top', '16px'),
          cssRow.cls('-disabled', this._disabled),
          withInfoTooltip(
            textButton(
              t('Add two-way reference'),
              dom.on('click', (e) => this._toggle(e)),
              testId('add-reverse-columm'),
              dom.prop('disabled', this._disabled),
            ),
            this._tooltip
          )
        ),
      ]),
      dom.maybe(this._isConfigured, () => cssTwoWayConfig(
        // TWO-WAY REFERENCE  (?)  [Remove]
        cssRow(
          dom.style('justify-content', 'space-between'),
          withInfoTooltip(
            cssLabelText(
              t('Two-way Reference'),
            ),
            'twoWayReferences'
          ),
          cssIconButton(
            icon('Remove'),
            dom.on('click', (e) => this._toggle(e)),
            dom.style('cursor', 'pointer'),
            testId('remove-reverse-column'),
          ),
        ),
        cssRow(
          cssContent(
            cssClipLine(
              cssClipItem(
                cssCapitalize(t('Target table'), dom.style('margin-right', '8px')),
                dom('span', dom.text(this._reverseTable)),
              ),
            ),
            cssFlexBetween(
              cssClipItem(
                cssCapitalize(t('Column'), dom.style('margin-right', '8px')),
                dom('span', dom.text(this._reverseColumn)),
                cssGrayText('(', dom.text(this._reverseType), ')')
              ),
              cssIconButton(
                cssShowOnHover.cls(''),
                cssNoClip.cls(''),
                cssIconAccent('Pencil'),
                dom.on('click', () => this._editConfigClick()),
                dom.style('cursor', 'pointer'),
                testId('edit-reverse-column'),
              ),
            ),
          ),
          testId('reverse-column-label'),
        ),
        cssSeparator(
          dom.style('margin-top', '16px'),
        ),
      )),
    );
  }

  private async _toggle(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    const column = this._field.column.peek();
    if (!this._isConfigured.get()) {
      await column.addReverseColumn();
      return;
    }
    const onConfirm = async () => {
      await column.removeReverseColumn();
    };

    const refCol = column.reverseColModel.peek().label.peek() || column.reverseColModel.peek().colId.peek();
    const refTable = column.reverseColModel.peek().table.peek().tableNameDef.peek();

    const promptTitle = t('Delete two-way reference?');

    const myTable = column.table.peek().tableNameDef.peek();
    const myName = column.label.peek() || column.colId.peek();

    const explanation = t(
      'This will delete the reference column {{refCol}} in table {{refTable}}. The reference column ' +
      '{{myName}} will remain in the current table {{myTable}}.', {
      refCol: dom('b', refCol),
      refTable: cssCode(refTable),
      myName: dom('b', myName),
      myTable: cssCode(myTable),
    });

    confirmModal(
      promptTitle,
      t('Delete'),
      onConfirm,
      {
        explanation: cssHigherLine(explanation),
        width: 'fixed-wide'
      }
    );
  }

  private async _editConfigClick() {
    const rawViewSection = this._refTable.get()?.rawViewSection.peek();
    if (!rawViewSection) { return; }
    await allCommands.showRawData.run(this._refTable.get()?.rawViewSectionRef.peek());
    const reverseColId = this._field.column.peek().reverseColModel.peek().colId.peek();
    if (!reverseColId) { return; } // might happen if it is censored.
    const targetField = rawViewSection.viewFields.peek().all()
                                      .find(f => f.colId.peek() === reverseColId);
    if (!targetField) { return; }
    await allCommands.setCursor.run(null, targetField);
  }
}

const cssTwoWayConfig = styled('div', ``);
const cssShowOnHover = styled('div', `
  visibility: hidden;
  .${cssTwoWayConfig.className}:hover & {
    visibility: visible;
  }
`);

const cssContent = styled('div', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`);


const cssFlexRow = styled('div', `
  display: flex;
  align-items: center;
  overflow: hidden;
`);

const cssFlexBetween = styled(cssFlexRow, `
  justify-content: space-between;
  overflow: hidden;
`);

const cssCapitalize = styled('span', `
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.lightText};
`);

const cssClipLine = styled('div', `
  display: flex;
  align-items: baseline;
  gap: 3px;
  overflow: hidden;
  flex: 1;
`);

const cssClipItem = styled('div', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssNoClip = styled('div', `
  flex: none;
`);

const cssGrayText = styled('span', `
  color: ${theme.lightText};
  margin-left: 4px;
`);

const cssIconAccent = styled(icon, `
  --icon-color: ${theme.accentIcon};
`);

const cssHigherLine = styled('div', `
  line-height: 1.5;
`);
