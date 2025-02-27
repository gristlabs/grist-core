import { bigBasicButton } from 'app/client/ui2018/buttons';
import { cssRootVars, theme } from 'app/client/ui2018/cssVars';
import { select, selectMenu, selectOption, selectTitle } from 'app/client/ui2018/menus';
import { dom, observable, styled } from 'grainjs';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

// tslint:disable:no-console

function setupTest() {
  const text = observable('1');
  const elements = observable([
    selectOption(() => {}, 'Option2', 'Script'),
    selectOption(() => {}, 'Option2', 'Script'),
    selectOption(() => {}, 'Option2', 'Script'),
    selectOption(() => {}, 'Option2', 'Script'),
  ]);
  return [
    dom.cls(cssRootVars),
    myButton(
      'Click me',
      dom.on('click', () => {
        elements.set([...elements.get(), selectOption(() => {}, 'Option2', 'Script')]);
      })
    ),
    select(text, ['1', '2', '3']),
    dom('div', 'Selected ', dom.text(text)),
    dom.style('padding', '80px'),

    selectMenu(selectTitle('Title', 'Script'), () => [
      selectOption(() => {}, 'Option1', 'Database'),
      horizontalLine(),
      dom.domComputed(elements, el => el),
    ]),
  ];
}

const myButton = styled(bigBasicButton, `
  margin-right: 16px;
`);

void withLocale(() => dom.update(document.body, setupTest()));

export const horizontalLine = styled('hr', `
  border: 1px solid ${theme.loginPageLine};
  flex-grow: 1;
`);
