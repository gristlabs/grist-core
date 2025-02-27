import {TopAppModelImpl} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {createAppUI} from 'app/client/ui/AppUI';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {dom} from 'grainjs';
import {MockUserAPI} from 'test/fixtures/projects/helpers/MockUserAPI';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const mockUserApi = new MockUserAPI();
// Simple mock values - not used in tests, but required for home plugins
const globalWindow = {
  gristConfig : {
    homeUrl : 'http://localhost:0',
    timestampMs : 0,
    pluginUrl : 'http://localhost:0',
    plugins: []
  }
};
const mockAppModel = TopAppModelImpl.create(null, globalWindow, mockUserApi);

function setupTest() {
  createAppUI(mockAppModel, {} as any);
}

// Match the font-size setting in the Grist app, which affects all rem units.
document.documentElement.style.fontSize = '10px';
(window as any).gristConfig = {
  pathOnly: true,
  features: ['multiAccounts', 'multiSite'],
};

// This little hack allows visiting /DocMenu#org=foo and end up in /o/foo as if that page loaded,
// to simulate what happens when switching to an arbitrary org. Similarly, #user=anon and
// #user=null allow simulating what happens when the user is anonymous or missing.
function simulateOrgChangeFromHash() {
  const hashOrgMatch = /[#&]org=(\w+)/.exec(window.location.href);
  const hashUserMatch = /[#&]user=(\w+)/.exec(window.location.href);
  let loadState = false;
  if (hashOrgMatch) {
    window.history.replaceState(null, '', urlState().makeUrl({org: hashOrgMatch[1]}));
    loadState = true;
  }
  if (hashUserMatch) {
    mockUserApi.activeUser = hashUserMatch[1];
    mockAppModel.initialize();
    loadState = true;
  }
  if (loadState) {
    urlState().loadState();
  }
}

void withLocale(() => {
  dom.update(document.body, dom.cls(cssRootVars), setupTest());
  dom.onElem(window, 'popstate', simulateOrgChangeFromHash);
  simulateOrgChangeFromHash();
});
