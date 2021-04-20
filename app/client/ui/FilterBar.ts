import { allInclusive } from "app/client/models/ColumnFilter";
import { ViewFieldRec, ViewSectionRec } from "app/client/models/DocModel";
import { attachColumnFilterMenu } from "app/client/ui/ColumnFilterMenu";
import { cssButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { colors, testId } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuItemAsync } from "app/client/ui2018/menus";
import { dom, IDisposableOwner, IDomArgs, styled } from "grainjs";

export function filterBar(_owner: IDisposableOwner, viewSection: ViewSectionRec) {
  return cssFilterBar(
    testId('filter-bar'),
    dom.forEach(viewSection.filteredFields, (field) => makeFilterField(viewSection, field)),
    makePlusButton(viewSection),
    cssSpacer(),
    dom.maybe(viewSection.filterSpecChanged, () => [
      primaryButton(
        'Save', testId('btn'),
        dom.on('click', async () => await viewSection.saveFilters()),
      ),
      basicButton(
        'Revert', testId('btn'),
        dom.on('click', () => viewSection.revertFilters()),
      )
    ])
  );
}

function makeFilterField(viewSection: ViewSectionRec, field: ViewFieldRec) {
  return cssFilterBarItem(
    testId('filter-field'),
    primaryButton(
      testId('btn'),
      cssIcon('FilterSimple'),
      cssMenuTextLabel(dom.text(field.label)),
      cssBtn.cls('-saved', field.activeFilter.isSaved),
      attachColumnFilterMenu(viewSection, field, {placement: 'bottom-start', attach: 'body'}),
    ),
    deleteButton(
      testId('delete'),
      cssIcon('CrossSmall'),
      cssBtn.cls('-saved', field.activeFilter.isSaved),
      dom.on('click', () => field.activeFilter('')),
    )
  );
}

function makePlusButton(viewSectionRec: ViewSectionRec) {
  return dom.domComputed((use) => {
    const fields = use(use(viewSectionRec.viewFields).getObservable());
    const anyFilter = fields.find((f) => use(f.isFiltered));
    return cssPlusButton(
      cssBtn.cls('-saved'),
      cssIcon('Plus'),
      menu(() => fields.map((f) => (
        menuItemAsync(
          () => f.activeFilter(allInclusive),
          f.label.peek(),
          dom.cls('disabled', f.isFiltered)
        )
      ))),
      anyFilter ? null : cssPlusLabel('Add Filter'),
      testId('add-filter-btn')
    );
  });
}

const cssFilterBar = styled('div', `
  display: flex;
  flex-direction: row;
  margin-bottom: 8px;
  margin-left: -4px;
  overflow-x: scroll;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`);
const cssFilterBarItem = styled(cssButtonGroup, `
  flex-shrink: 0;
  margin: 0 4px;
  & > .${cssButton.className}:first-child {
    border-right: 0.5px solid white;
  }
`);
const cssMenuTextLabel = styled('span', `
  flex-grow: 1;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
`);
const cssIcon = styled(icon, `
  margin-top: -3px;
`);
const cssBtn = styled('div', `
  height: 24px;
  padding: 3px 8px;
  .${cssFilterBar.className} > & {
    margin: 0 4px;
  }
  &-saved {
    color:        ${colors.light};
    --icon-color: ${colors.light};
    background-color: ${colors.slate};
    border-color: ${colors.slate};
  }
  &-saved:hover {
    background-color: ${colors.darkGrey};
    border-color: ${colors.darkGrey};
  }
`);
const primaryButton = (...args: IDomArgs<HTMLDivElement>) => (
  dom('div', cssButton.cls(''), cssButton.cls('-primary'),
      cssBtn.cls(''), ...args)
);
const basicButton = (...args: IDomArgs<HTMLDivElement>) => (
  dom('div', cssButton.cls(''), cssBtn.cls(''), ...args)
);
const deleteButton = styled(primaryButton, `
  padding: 3px 4px;
`);
const cssSpacer = styled('div', `
  width: 8px;
  flex-shrink: 0;
`);
const cssPlusButton = styled(primaryButton, `
  padding: 3px 3px
`);
const cssPlusLabel = styled('span', `
  margin: 0 12px 0 4px;
`);
