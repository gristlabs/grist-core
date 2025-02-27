import {addNewButton, cssAddNewButton} from 'app/client/ui/AddNewButton';
import {AppHeader} from 'app/client/ui/AppHeader';
import {PageContents, pagePanels} from 'app/client/ui/PagePanels';
import {attachPageWidgetPicker, openPageWidgetPicker} from 'app/client/ui/PageWidgetPicker';
import {primaryButton} from 'app/client/ui2018/buttons';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {menu, menuIcon, menuItem} from 'app/client/ui2018/menus';
import {AppModel, TopAppModelImpl} from 'app/client/models/AppModel';
import {dom, DomContents, makeTestId, observable, styled} from "grainjs";
import {addNewPage, addPages, selected} from 'test/fixtures/projects/helpers/Pages';
import {gristDocMock} from 'test/fixtures/projects/helpers/widgetPicker';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const testId = makeTestId('test-pp-');

function renderPage(appModel: AppModel, showRightPane: boolean, showLeftOpener: boolean,
                    optimizeNarrowScreen: boolean): DomContents {
  const leftPanelOpen = observable(true);
  const page: PageContents = {
    leftPanel: {
      panelWidth: observable<number>(240),
      panelOpen: leftPanelOpen,
      hideOpener: !showLeftOpener,
      header: dom.create(
        AppHeader,
        appModel
      ),
      content: dom('div',
        addNewButton({isOpen: leftPanelOpen},
          menu(() => addMenu(), {
            placement: 'bottom-start',
            stretchToSelector: `.${cssAddNewButton.className}`
          }),
          testId('addNew')),
        addPages(leftPanelOpen),
        'This is long left-pane content'
      ),
    },
    rightPanel: showRightPane ? {
      panelWidth: observable<number>(240),
      panelOpen: observable(optimizeNarrowScreen ? false : true),
      header: testContent('Header Right'),
      content: dom('div',
        primaryButton(
          (elem) => attachPageWidgetPicker(
            elem, gristDocMock,
            async (val) => { selected.get()!.record.widget = val; },
            {
              value: () => selected.get()!.record.widget,
              buttonLabel: 'Save',
            }),
          "Edit Data Selection",
          dom.prop('disabled', (use) => !use(selected)),
          testId('editDataBtn')
        ),
        testContent('Long right-pane content')
      ),
    } : undefined,
    headerMain: testContent('Header Middle'),
    contentMain: testContent('Content Middle'),
    testId,
  };
  return pagePanels(page);
}

function setupTest() {
  const mockAppModel = TopAppModelImpl.create(null, {});
  const showRightPane = observable(true);
  const showLeftOpener = observable(true);
  const optimizeNarrowScreen = observable(false);
  return [
    dom.cls(cssRootVars),
    testBox(dom.domComputed((use) => {
      const appModel = use(mockAppModel.appObs);
      if (!appModel) { return null; }
      appModel.currentOrgName = 'SmartLab with very long and overflowing name';
      return renderPage(appModel, use(showRightPane), use(showLeftOpener), use(optimizeNarrowScreen));
    })),
    controls(
      dom('input', {type: 'checkbox'},
        testId('show-right'),
        dom.prop('checked', showRightPane),
        dom.on('change', (ev, elem: any) => showRightPane.set(elem.checked))
      ),
      'Show right pane',
      dom('br'),
      dom('input', {type: 'checkbox'},
        testId('show-left-opener'),
        dom.prop('checked', showLeftOpener),
        dom.on('change', (ev, elem: any) => showLeftOpener.set(elem.checked))
      ),
      'Show left opener',
      dom('br'),
      dom('input', {type: 'checkbox'},
          testId('optimize-narrow-screen'),
          dom.prop('checked', optimizeNarrowScreen),
          dom.on('change', (ev, elem: any) => optimizeNarrowScreen.set(elem.checked))
         ),
      'Optimize narrow screen'

    ),
  ];
}

function addMenu() {
  return [
    menuItem(() => addNewPage(), menuIcon("TypeTable"), "Empty Table"),
    menuItem(
      (elem) => openPageWidgetPicker(elem, gristDocMock, addNewPage),
      menuIcon('Page'), "Page", testId('addNewPage')),
  ];
}

const testContent = styled('div', `
  padding: 5px;
  text-align: center;
  flex: 1 1 0px;
`);

const testBox = styled('div', `
  position: relative;
  width: 80vw;
  height: 80vh;
  margin: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  transform: scale(1); /* Defines the containing block for the side panels*/
`);
const controls = styled('div', `margin: 1rem`);

void withLocale(() => {
  // Load icons.css, wait for it to load, then build the page.
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'},
    dom.on('load', () => dom.update(document.body, setupTest()))
  ));
});
