import {PageContents, pagePanels} from 'app/client/ui/PagePanels';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {dom, observable, styled} from "grainjs";

function renderPage(): Element {
  const leftPanelOpen = observable(true);
  const page: PageContents = {
    leftPanel: {
      panelWidth: observable<number>(240),
      panelOpen: leftPanelOpen,
      hideOpener: false,
      header: testContent('LEFT HEADER'),
      content: testContent('LEFT PANEL'),
    },
    rightPanel: {
      panelWidth: observable<number>(240),
      panelOpen: observable(true),
      header: testContent('RIGHT HEADER'),
      content: testContent('RIGHT PANEL'),
    },
    headerMain: testContent('Header'),
    contentMain: testContent('Welcome to a tiny bit of Grist'),
  };
  return pagePanels(page);
}

const testContent = styled('div', `
  padding: 5px;
  text-align: center;
  flex: 1 1 0px;
`);

// Load icons.css, wait for it to load, then build the page.
dom.update(document.body, dom.cls(cssRootVars), renderPage());
