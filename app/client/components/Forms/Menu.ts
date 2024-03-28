import {allCommands} from 'app/client/components/commands';
import {FormLayoutNodeType} from 'app/client/components/FormRenderer';
import * as components from 'app/client/components/Forms/elements';
import {FormView} from 'app/client/components/Forms/FormView';
import {BoxModel, Place} from 'app/client/components/Forms/Model';
import {makeTestId, stopEvent} from 'app/client/lib/domUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {getColumnTypes as getNewColumnTypes} from 'app/client/ui/GridViewMenus';
import * as menus from 'app/client/ui2018/menus';
import {Computed, dom, IDomArgs, MultiHolder} from 'grainjs';

const t = makeT('FormView');
const testId = makeTestId('test-forms-menu-');

// New box to add, either a new column of type, an existing column (by column id), or a structure.
export type NewBox = {add: string} | {show: string} | {structure: FormLayoutNodeType};

interface Props {
  /**
   * If this menu was shown as a result of clicking on a box. This box will be selected.
   */
  box?: BoxModel;
  /**
   * Parent view (to access GristDoc/selectedBox and others, TODO: this should be turned into events)
   */
  view?: FormView;
  /**
   * Whether this is context menu, so move `Copy` etc in front, and nest new items in its own menu.
   */
  context?: boolean;
  /**
   * Custom menu items to be added at the bottom (below additional separator).
   */
  customItems?: Element[],
  /**
   * Custom logic of finding right spot to insert the new box.
   */
  insertBox?: Place,
}

export function buildMenu(props: Props, ...args: IDomArgs<HTMLElement>): IDomArgs<HTMLElement> {
  const {box, context, customItems} = props;
  const view = box?.view ?? props.view;
  if (!view) { throw new Error("No view provided"); }
  const gristDoc = view.gristDoc;
  const viewSection = view.viewSection;
  const owner = new MultiHolder();

  const unmapped = Computed.create(owner, (use) => {
    const types = getNewColumnTypes(gristDoc, use(viewSection.tableId));
    const normalCols = use(viewSection.hiddenColumns).filter(col => use(col.isFormCol));
    const list = normalCols.map(col => {
      return {
        label: use(col.label),
        icon: types.find(type => type.colType === use(col.pureType))?.icon ?? 'TypeCell',
        colId: use(col.colId),
      };
    });
    return list;
  });

  const oneTo5 = Computed.create(owner, (use) => use(unmapped).length > 0 && use(unmapped).length <= 5);
  const moreThan5 = Computed.create(owner, (use) => use(unmapped).length > 5);

  // If we are in a column, then we can't insert a new column.
  const disableInsert = box?.parent?.type === 'Columns' && box.type !== 'Placeholder';

  return [
    dom.autoDispose(owner),
    menus.menu((ctl) => {
      box?.view.selectedBox.set(box);

      // Same for structure.
      const struct = (structure: FormLayoutNodeType) => ({structure});

      // Actions:

      // Insert field before and after.
      const above = (el: NewBox) => () => {
        allCommands.insertFieldBefore.run(el);
      };
      const below = (el: NewBox) => () => {
        allCommands.insertFieldAfter.run(el);
      };
      const atEnd = (el: NewBox) => () => {
        allCommands.insertField.run(el);
      };
      const custom = props.insertBox ? (el: NewBox) => () => {
        if ('add' in el || 'show' in el) {
          return view.addNewQuestion(props.insertBox!, el);
        } else {
          props.insertBox!(components.defaultElement(el.structure));
          return view.save();
        }
      } : null;

      // Field menus.
      const quick = ['Text', 'Numeric', 'Choice', 'Date'];
      const disabled = ['Attachments'];
      const commonTypes = () => getNewColumnTypes(gristDoc, viewSection.tableId());
      const isQuick = ({colType}: {colType: string}) => quick.includes(colType);
      const notQuick = ({colType}: {colType: string}) => !quick.includes(colType);
      const isEnabled = ({colType}: {colType: string}) => !disabled.includes(colType);

      const insertMenu = (where: typeof above) => () => {
        return [
          menus.menuSubHeader('New question'),
          ...commonTypes()
            .filter(isQuick)
            .filter(isEnabled)
            .map(ct => menus.menuItem(where({add: ct.colType}), menus.menuIcon(ct.icon!), ct.displayName))
          ,
          menus.menuItemSubmenu(
            () => commonTypes()
              .filter(notQuick)
              .filter(isEnabled)
              .map(ct => menus.menuItem(
                where({add: ct.colType}),
                menus.menuIcon(ct.icon!),
                ct.displayName,
              )),
            {},
            menus.menuIcon('Dots'),
            dom('span', "More", dom.style('margin-right', '8px'))
          ),
          dom.maybe(oneTo5, () => [
            menus.menuDivider(),
            menus.menuSubHeader(t('Unmapped fields')),
            dom.domComputed(unmapped, (uf) =>
              uf.map(({label, icon, colId}) => menus.menuItem(
                where({show: colId}),
                menus.menuIcon(icon),
                label,
                testId('unmapped'),
                testId('unmapped-' + colId)
              )),
            ),
          ]),
          dom.maybe(moreThan5, () => [
            menus.menuDivider(),
            menus.menuSubHeaderMenu(
              () => unmapped.get().map(
                ({label, icon, colId}) => menus.menuItem(
                  where({show: colId}),
                  menus.menuIcon(icon),
                  label,
                  testId('unmapped'),
                  testId('unmapped-' + colId)
                )),
              {},
              dom('span', "Unmapped fields", dom.style('margin-right', '8px'))
            ),
          ]),
          menus.menuDivider(),
          menus.menuSubHeader(t('Building blocks')),
          menus.menuItem(where(struct('Header')), menus.menuIcon('Headband'), t("Header")),
          menus.menuItem(where(struct('Paragraph')), menus.menuIcon('Paragraph'), t("Paragraph")),
          menus.menuItem(where(struct('Columns')), menus.menuIcon('Columns'), t("Columns")),
          menus.menuItem(where(struct('Separator')), menus.menuIcon('Separator'), t("Separator")),

          props.customItems ? menus.menuDivider() : null,
          ...(props.customItems ?? []),
        ];
      };

      if (!props.context && !disableInsert) {
        return insertMenu(custom ?? atEnd)();
      }

      return [
        disableInsert ? null : [
          menus.menuItemSubmenu(insertMenu(above), {action: above({add: 'Text'})}, t("Insert question above")),
          menus.menuItemSubmenu(insertMenu(below), {action: below({add: 'Text'})}, t("Insert question below")),
          menus.menuDivider(),
        ],
        menus.menuItemCmd(allCommands.contextMenuCopy, t("Copy")),
        menus.menuItemCmd(allCommands.contextMenuCut, t("Cut")),
        menus.menuItemCmd(allCommands.contextMenuPaste, t("Paste")),
        menus.menuDivider(),
        menus.menuItemCmd(allCommands.deleteFields, "Hide"),
        elem => void FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}),
        customItems?.length ? menus.menuDivider(dom.style('min-width', '200px')) : null,
        ...(customItems ?? []),
        ...args,
      ];
    }, {trigger: [context ? 'contextmenu' : 'click']}),
    context ? dom.on('contextmenu', stopEvent) : null,
  ];
}
