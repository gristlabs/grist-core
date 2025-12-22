import {dom, input, makeTestId, observable, styled} from 'grainjs';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';
import {initGristStyles} from "test/fixtures/projects/helpers/gristStyles";
import {buildMentionTextBox, CommentWithMentions} from 'app/client/widgets/MentionTextBox';
import {PermissionData} from 'app/common/UserAPI';

const testId = makeTestId('test-');

initGristStyles();

setTimeout(() => {
  void withLocale(() => dom.update(document.body, dom.create(setupTest)));
});

function setupTest() {
  const initial = observable<string>('');
  (window as any).initial = initial; // Expose for debugging
  return cssCenter(
    input(initial, {onInput: true}, {type: 'text'}),
    dom('span', new Date().toLocaleString()),
    dom.domComputed(initial, init => [
      buildDom(init),
    ]),
    cssAway(testId('away')),
  );
}

function buildDom(init: string) {
  const text = observable(new CommentWithMentions(init));
  const rawHtml = observable('');
  const data: PermissionData = {
    users: [
      {name: 'Alice', id: 1, ref: 'alice', email: '', access: 'editors'},
      {name: 'Bob', id: 2, ref: 'bob', email: '', access: 'editors'},
      {name: 'Charlie', id: 3, ref: 'charlie', email: '', access: 'editors'},
      {name: 'Dave', id: 4, ref: 'dave', email: '', access: 'editors'},
    ],
  };

  const access = observable<PermissionData|null>(data);

  // Exposed for debugging purposes.
  (window as any).loadData = () => {
    access.set(data);
  };

  (window as any).clearData = () => {
    access.set(null);
  };

  return [
    dom('div.box',
      buildMentionTextBox(
        text,
        access,
        testId('input'),
        dom.on('input', (_, el) => rawHtml.set(el.innerHTML)),
      ),
      dom('button', 'Load', dom.on('click', () => { access.set(data); })),
      dom('button', 'Clear', dom.on('click', () => { access.set(null); })),
      dom('button', 'Load after', dom.on('click', () => {
        setTimeout(() => {
          access.set(data);
        }, 5000);
      })),
    ),
    dom('div.box wide',
      dom('div', 'Markdown'),
      dom('pre',
        dom.style('white-space', 'pre-wrap'),
        dom.text(use => use(text)?.text || ''),
        testId('output'),
      ),
    ),
    dom('div.box wide',
      dom('div', 'Raw HTML'),
      dom('pre',
        dom.style('white-space', 'pre-wrap'),
        dom.text(use => use(rawHtml)),
        testId('output'),
      ),
    ),
  ];
}


const cssAway = styled('div', `
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  height: 40px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  z-index: 1000;
  cursor: pointer;
  &:active {
    background-color: rgba(0, 0, 0, 0.7);}
`);

const cssCenter = styled('div', `
  display: flex;
  gap: 16px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  background-color: #f0f0f0;

  font-size: 13px;

  .box {
    width: 300px;
    height: 300px;
  }

  .wide {
    width: min(80%, 600px);
   }

  .grist-mention {
    text-decoration: none;
    outline: none;
    &:hover, &:active {
      outline: none;
      text-decoration: none;
    }
  }


`);

