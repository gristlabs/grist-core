import { docBreadcrumbs } from 'app/client/ui2018/breadcrumbs';
import { basicButton, bigBasicButton, cssButtonGroup } from 'app/client/ui2018/buttons';
import { bigPrimaryButton, primaryButton } from 'app/client/ui2018/buttons';
import { basicButtonLink, bigBasicButtonLink } from 'app/client/ui2018/buttons';
import { bigPrimaryButtonLink, primaryButtonLink } from 'app/client/ui2018/buttons';
import { alignmentSelect, buttonSelect, colorSelect, cssButtonSelect } from 'app/client/ui2018/buttonSelect';
import { buttonToggleSelect, ISelectorOption } from 'app/client/ui2018/buttonSelect';
import { circleCheckbox, squareCheckbox } from 'app/client/ui2018/checkbox';
import { labeledCircleCheckbox, labeledSquareCheckbox } from 'app/client/ui2018/checkbox';
import { Indeterminate, labeledTriStateSquareCheckbox } from 'app/client/ui2018/checkbox';
import { cssRootVars, testId, vars } from 'app/client/ui2018/cssVars';
import { editableLabel } from 'app/client/ui2018/editableLabel';
import { icon } from 'app/client/ui2018/icons';
import * as menu from 'app/client/ui2018/menus';
import { searchBar } from 'app/client/ui2018/search';
import { Computed, dom, makeTestId, obsArray, styled } from 'grainjs';
import { observable, Observable } from 'grainjs';
import noop = require('lodash/noop');
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';


function setupTest() {
  const actionText = observable('');
  const cssAction = dom('div',
    dom('button#action-reset', 'Reset', dom.on('click', () => actionText.set(''))),
    "Action: ",
    dom('span#action-text', dom.text(actionText)),
  );

  const cssElemRow = styled('div', `
    & > * {
      margin-left: 8px;
    }
  `);

  const buttons = dom('div#buttons',
    dom('h1', 'Buttons'),
    dom('h4', 'Default state'),
    cssElemRow(
      dom.cls('elements'),
      basicButton('Basic button', icon('Dropdown'), dom.on('click', () => actionText.set('Basic button'))),
      bigBasicButton('Big basic button', icon('Dropdown'), dom.on('click', () => actionText.set('Big basic button'))),
      primaryButton('Primary button', icon('Dropdown'), dom.on('click', () => actionText.set('Primary button'))),
      bigPrimaryButton('Big primary button', icon('Dropdown'),
        dom.on('click', () => actionText.set('Big primary button')))
    ),
    dom('h4', 'Disabled state'),
    cssElemRow(
      basicButton('Basic disabled', icon('Dropdown'), dom.prop('disabled', true)),
      bigBasicButton('Big basic button', icon('Dropdown'), dom.prop('disabled', true)),
      primaryButton('Primary disabled', icon('Dropdown'), dom.prop('disabled', true)),
      bigPrimaryButton('Big primary button', icon('Dropdown'), dom.prop('disabled', true))
    ),
    dom('h4', 'Button links'),
    cssElemRow(
      basicButtonLink('Basic Button Link', {href: '#'}),
      bigBasicButtonLink('Big Basic Button Link', {href: '#'}),
      primaryButtonLink('Primary Button Link', {href: '#'}),
      bigPrimaryButtonLink('Big Primary Button Link', {href: '#'}),
    ),
  );

  function myEditableLabel(obs: Observable<string>) {
    return editableLabel(obs, {save: async (val) => obs.set(val)});
  }

  const labels = dom('div#labels',
    dom('h4', 'Labels'),
    dom('div#editable-label',
      dom('div', myEditableLabel(observable('Hello'))),
      dom('div', myEditableLabel(observable("Small editable label")),
        {style: `font-size: ${vars.smallFontSize}`}),
      dom('div', myEditableLabel(observable("Medium (default) editable label")),
        {style: `font-size: ${vars.mediumFontSize}`}),
      dom('div', myEditableLabel(observable("Large editable label")),
        {style: `font-size: ${vars.largeFontSize}`}),
    ),
    dom('div#noneditable-label',
      dom('div', styled('span', `font-size: ${vars.smallFontSize}`)(dom.text(observable("Small label")))),
      dom('div', styled('span', `font-size: ${vars.mediumFontSize}`)(dom.text(observable("Medium (default) label")))),
      dom('div', styled('span', `font-size: ${vars.largeFontSize}`)(dom.text(observable("Large label"))))
    )
  );

  const obsCheck1 = observable(false);
  const obsCheck2 = observable(true);
  const bothCheck = Computed.create(null, obsCheck1, obsCheck2, (_use, check1, check2) => {
    if (check1 && check2) { return true; }
    if (check1 || check2) { return Indeterminate; }
    return false;
  })
    .onWrite((val) => {
      if (val === Indeterminate) { return; }
      obsCheck1.set(val); obsCheck2.set(val);
    });

  const checkbox = dom('div#checkbox',
    dom('h1', 'Checkbox'),
    dom('h4', 'Default'),
    dom('div',
      'obsCheck1: ', dom.text(use => String(use(obsCheck1))),
      ', obsCheck2: ', dom.text(use => String(use(obsCheck2)))
    ),
    cssElemRow(
      squareCheckbox(obsCheck1),
      labeledSquareCheckbox(obsCheck1, 'Include other values'),
      squareCheckbox(obsCheck2),
      labeledSquareCheckbox(obsCheck2, 'Include other values')
    ),
    cssElemRow(
      circleCheckbox(obsCheck1),
      labeledCircleCheckbox(obsCheck1, 'Include other values'),
      circleCheckbox(obsCheck2),
      labeledCircleCheckbox(obsCheck2, 'Include other values')
    ),
    dom('h4', 'Disabled'),
    cssElemRow(
      squareCheckbox(obsCheck1, dom.prop('disabled', true)),
      labeledSquareCheckbox(obsCheck1, 'Include other values', dom.prop('disabled', true)),
      squareCheckbox(obsCheck2, dom.prop('disabled', true)),
      labeledSquareCheckbox(obsCheck2, 'Include other values', dom.prop('disabled', true)),
    ),
    cssElemRow(
      circleCheckbox(obsCheck1, dom.prop('disabled', true)),
      labeledCircleCheckbox(obsCheck1, 'Include other values', dom.prop('disabled', true)),
      circleCheckbox(obsCheck2, dom.prop('disabled', true)),
      labeledCircleCheckbox(obsCheck2, 'Include other values', dom.prop('disabled', true)),
    ),
    dom('h4', 'Indeterminate'),
    cssElemRow(
      labeledTriStateSquareCheckbox(bothCheck, 'All checked', testId('both-check'))
    ),
    cssElemRow(labeledSquareCheckbox(obsCheck1, 'Santa', testId('check-1')), {style: `margin-left: 16px`}),
    cssElemRow(labeledSquareCheckbox(obsCheck2, 'Babar'), {style: `margin-left: 16px`}),
  );

  const type = observable("");
  const types = obsArray<string>();
  const typeOptions: Array<menu.IOption<string>> = [
    { value: "text",       label: "Text",       icon: "FieldText"                      },
    { value: "numeric",    label: "Numeric",    icon: "FieldNumeric"                   },
    { value: "integer",    label: "Integer",    icon: "FieldInteger"                   },
    { value: "toggle",     label: "Toggle",     icon: "FieldToggle"                    },
    { value: "date",       label: "Date",       icon: "FieldDate"                      },
    { value: "datetime",   label: "DateTime",   icon: "FieldDateTime"                  },
    { value: "choice",     label: "Choice",     icon: "FieldChoice"                    },
    { value: "reference",  label: "Reference",  icon: "FieldReference"                 },
    { value: "attachment", label: "Attachment", icon: "FieldAttachment"                },
    { value: "any",        label: "Any",        icon: "FieldAny",       disabled: true },
    { value: "fakeType",   label: "A very very long fake label for a very fake type",
                                                icon: "FieldText"},
  ];
  // If 4 or more items are selected in the multiSelect, turn on the error flag for testing purposes.
  const multiSelectError = Computed.create(null, types, (_use, ts) => ts.length >= 4);

  const menus = dom('div#menus',
    dom('h1', 'Menus'),
    dom('h4', 'Default'),
    primaryButton('Default menu',
      menu.menu(() => [
        // tslint:disable-next-line:no-console
        menu.menuItem(() => { console.log("Menu item: Hello"); }, "Log 'Hello'"),
        menu.menuDivider(),
        menu.menuSubHeader('Subheader'),
        menu.menuItem(() => undefined, dom.cls('disabled', true), "Disabled"),
        // tslint:disable-next-line:no-console
        menu.menuItem(() => { console.log("Menu item: World"); }, "Log 'World'"),
      ])
    ),
    dom('h4', 'Select menu'),
    dom('div', { style: `width: 200px;` },
      menu.select(type, typeOptions, {defaultLabel: "Select column type"})
    ),
    dom('h4', 'Scrollable select menu'),
    dom('div', { style: `width: 100px;` },
      menu.select(observable('0'), [...Array(100).keys()].map(n => n.toString()))
    ),
    dom('h4', 'Form select menu'),
    dom('div', { style: 'width: 200px' },
      menu.formSelect(type, typeOptions, {defaultLabel: "Select column type"}),
    ),
    dom('h4', 'Multi select menu'),
    dom('div', { style: 'width: 200px' },
      menu.multiSelect(types, typeOptions, {
        placeholder: "Select column type",
        error: multiSelectError
      }, testId('multi-select')),
    )
  );

  const cssSearchBarWrapper = styled('div#searchbar', `
    display: flex;
    flex-direction: row-reverse;
    border: 1px solid blue;
    width: 240px;
  `);

  const searchModel = {
    value: observable(''),
    isOpen: observable(false),
    noMatch: observable(true),
    isEmpty: observable(true),
    isRunning: observable(false),
    multiPage: observable(true),
    allLabel: observable('Search on all pages'),
    findNext: () => Promise.resolve(),
    findPrev: () => Promise.resolve(),
  };

  const search = dom('div#search',
    dom('h4', 'Search bar'),
    cssSearchBarWrapper(
      searchBar(searchModel, makeTestId('test-search-'))
    )
  );

  const ws = observable({ id: 0, name: 'Samples' });
  const docName = observable('Lightweight CRM');
  const pageName = observable('Clients');

  const breadcrumbs = dom('div#breadcrumbs',
    dom('h4', 'Breadcrumbs'),
    docBreadcrumbs(ws, docName, pageName, {
      docNameSave: async (val) => docName.set(val),
      pageNameSave: async (val) => pageName.set(val),
      cancelRecoveryMode: async () => undefined,
      isFork: observable(false),
      isBareFork: observable(false),
      isTutorialFork: observable(false),
      isFiddle: observable(false),
      isRecoveryMode: observable(false),
      isTemplate: observable(false),
      isAnonymous: false,
    })
  );

  const alignmentObs = observable('left');

  const widgetObs = observable(1);
  const widgetBtns: Array<ISelectorOption<number>> = [
    {value: 0, label: 'Date',    icon: 'FieldDate'},
    {value: 1, label: 'Spinner', icon: 'FieldSpinner'}
  ];

  const chartObs = observable(null);
  const chartBtns: Array<ISelectorOption<string>> = [
    {value: 'bar',    icon: 'ChartBar'},
    {value: 'pie',    icon: 'ChartPie'},
    {value: 'area',   icon: 'ChartArea'},
    {value: 'line',   icon: 'ChartLine'},
    {value: 'kaplan', icon: 'ChartKaplan'}
  ];

  const inline = styled('div', `
    display: inline-block;
    margin: 0 10px 20px 0;
  `);

  const btnSel = dom('div#buttonselect',
    dom('h4', 'Button Select'),
    dom('div',
      dom.cls('alignment-select'),
      inline(alignmentSelect(alignmentObs)),
      dom('span',
        dom.cls('alignment-value'),
        dom.text(alignmentObs)
      )
    ),
    dom('div',
      dom.cls('widget-select'),
      inline({style: 'width: 180px;'}, buttonSelect(widgetObs, widgetBtns)),
      dom('span',
        dom.cls('widget-value'),
        dom.text((use) => String(use(widgetObs)))
      )
    ),
    dom('div',
      dom.cls('widget-select'),
      inline({style: 'width: 180px;'}, buttonSelect(widgetObs, widgetBtns, cssButtonSelect.cls('-light'))),
      dom('span',
        dom.cls('widget-value'),
        dom.text((use) => String(use(widgetObs)))
      )
    ),
    dom('div',
      dom.cls('chart-select'),
      inline({style: 'width: 200px;'},
        buttonToggleSelect(chartObs, chartBtns, {large: true, primary: true})),
      dom('span',
        dom.cls('chart-value'),
        dom.text((use) => String(use(chartObs)))
      )
    )
  );

  const colorObs = observable('#ff5555');
  const colorSel = dom('div#colorselect',
    dom('h4', 'Color Select'),
    dom('div', {style: 'display: flex; align-items: center;'},
      dom('span', {style: 'margin-right: 10px;'}, 'Pick a color:'),
      colorSelect(colorObs, () => null as any)
    )
  );

  const btnGroup = dom(
    'div#btnGroup',
    dom('h4', 'Button Group'),
    cssButtonGroup(
      primaryButton('Save Copy'),
      primaryButton(
        icon('Dropdown'),
        menu.menu(() => [
          menu.menuItem(noop, "Do this"),
          menu.menuItem(noop, "Do that"),
        ]),
      ),
    )
  );

  return cssTestBox(
    cssAction,
    buttons,
    labels,
    breadcrumbs,
    checkbox,
    menus,
    search,
    btnSel,
    colorSel,
    btnGroup
  );
}

const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
`);

void withLocale(() => {
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'}));
  dom.update(document.body, dom.cls(cssRootVars), setupTest());
});
