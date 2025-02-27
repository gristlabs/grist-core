import { cssRootVars, testId } from 'app/client/ui2018/cssVars';
import { contextMenu } from  'app/client/ui/contextMenu';
import { dom, observable, styled } from 'grainjs';
import { menuItem } from 'popweasel';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

function setupTest() {
  const logs = observable<string[]>([]);
  document.querySelector('html')!.classList.add(cssBody.className);
  document.querySelector('body')!.classList.add(cssBody.className);

  dom.update(
    document.body,
    dom.on('contextmenu', (ev) => ev.preventDefault())
  );

  return cssFullscreen(
    "right click any where...",
    contextMenu(() => [
      menuItem(() => logs.set(logs.get().concat('foo')), 'Foo'),
      menuItem(() => logs.set(logs.get().concat('bar')), 'Bar'),
      menuItem(() => logs.set([]), 'Reset'),
    ]),
    dom.forEach(logs, name => dom('div', `${name} added`, testId('logs')))
  );
}

const cssFullscreen = styled('div', `
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
`);

const cssBody = styled('div', `
  height: 100%;
  margin: 0;
`);

void withLocale(() => {
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'}));
  dom.update(document.body, dom.cls(cssRootVars), setupTest());
});
