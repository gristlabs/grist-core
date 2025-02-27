import { cssRootVars, testId } from 'app/client/ui2018/cssVars';
import { IOnBoardingMsg, startOnBoarding } from 'app/client/ui/OnBoardingPopups';
import { dom, DomElementArg, observable, styled } from "grainjs";
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

const message: IOnBoardingMsg[] = [
  {
    selector: '.tour-add-new',
    title: 'Add New',
    body: 'Click here to add new ...',
    placement: 'right',
  },
  {
    selector: '#export',
    title: 'Export',
    body: 'Export let\'s you ...',
    placement: 'right',
  },
  {
    selector: '.tour-left-panel',
    title: 'Left Panel',
    body: 'This pane holds many useful stuff ...',
    placement: 'right',
  },
  {
    selector: '.tour-options',
    title: 'Options',
    body: 'You can customize, just click the options ...',
    placement: 'left',
  },
  {
    selector: '.tour-sharing',
    title: 'Sharing',
    body: 'You can share with who you care ...',
    placement: 'bottom',
  },
  {
    selector: '.tour-tools',
    title: 'Tools',
    body: 'Great tools to build great things ...',
    placement: 'top-start'
  }
];

const logs = observable<string[]>([]);
function log(msg: string) {
  logs.set(logs.get().concat(msg));
}

function dummyButton(name: string, ...args: DomElementArg[]) {
  return dom(
    'button', `${name} [FAKE]`,
    dom.on('click', () => log(`CLICKED ${name}!`)),
    ...args
  );
}

function setupTest() {
  return [
    leftPane(
      dummyButton('Add New', dom.cls('tour-add-new')),
      dummyButton('Export', {id: 'export'}),
      dom('button', 'Start',
          dom.on('click', () => startOnBoarding(message, () => log('On Boarding FINISHED!')))),
      dom('button', 'Reset logs',
          dom.on('click', () => logs.set([]))),
      dom.cls('tour-left-panel'),
    ),
    Share('Share#sharing', dom.cls('tour-sharing')),
    Tools('Tools', dom.cls('tour-tools')),
    rightPane(
      dummyButton('Options', {style: 'margin-top: 40px'}, dom.cls('tour-options')),
    ),
    dom.domComputed(logs, (logsArray) => (
      dom('div', {style: 'position: absolute; margin-top: 300px;'},
          logsArray.map((msg) => dom('div', msg, testId('logs')))
         )
    )),
  ];
}

const basePane = styled('div', `
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 1px solid gray;
  height: 300px;
`);

const leftPane = styled(basePane, `
  left: 10px;
`);

const rightPane = styled(basePane, `
  left: 600px;
`);

const Share = styled(dummyButton, `
  position: absolute;
  left: 300px;
`);

const Tools = styled(dummyButton, `
  position: absolute;
  left: 140px;
  top: 290px;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
