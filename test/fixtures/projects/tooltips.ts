import {descriptionInfoTooltip, hoverTooltip, tooltipCloseButton, withInfoTooltip} from 'app/client/ui/tooltips';
import {cssRootVars, testId} from 'app/client/ui2018/cssVars';
import {dom, observable, styled} from 'grainjs';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';


function setupTest() {
  const showTriggerObs = observable(true);
  return cssTestBox(
    cssTrigger('Plain hover', hoverTooltip("Tooltip1"),
      testId('plain'),
    ),
    cssTrigger('Click and Expire', hoverTooltip(() => "Tooltip2", {openOnClick: true, timeoutMs: 1000}),
      testId('fancy'),
    ),
    cssTrigger('Closable', hoverTooltip((ctl) => cssTip("Tooltip3", tooltipCloseButton(ctl))),
      testId('closable'),
    ),
    cssRow(
      dom.maybe(showTriggerObs, () => (
        cssTrigger('Close on disposed', hoverTooltip("Tooltip6", {closeDelay: 2000, openDelay: 500}),
                   dom('button', dom.on('click', () => showTriggerObs.set(false)), 'Hide'),
                   testId('dispose'))
      )),
      cssLabel(
        dom(
          'input',
          {type: 'checkbox'}, dom.prop('checked', showTriggerObs),
          dom.on('change', (_ev, elem) => showTriggerObs.set(elem.checked))
        ),
        'Show trigger'
      )
    ),
    cssRow(
      cssTrigger('Added to a key', hoverTooltip("Tooltip4", {key: 'key'}),
        testId('with-key')),
      cssTrigger('Added to same key', hoverTooltip("Tooltip5", {key: 'key'}),
        testId('with-same-key')),
    ),
    withInfoTooltip(cssTrigger('Info (Click)'), 'selectBy', {domArgs: [testId('info-click')]}),
    withInfoTooltip(cssTrigger('Info (Hover)'), 'uuid', {
      variant: 'hover',
      domArgs: [testId('info-hover')],
    }),
    cssTrigger('Close on Click', hoverTooltip("Tooltip9", {closeOnClick: true}),
      testId('close-on-click'),
    ),
    cssTrigger('Info tooltip',
      el => {
        return descriptionInfoTooltip(
          'Multi line text\nAnd a https://link.to/page.html?with=filter in it'
        , 'prefix');
      },
      testId('visible'),
    ),
    cssTrigger('None', testId('none')),
  );
}

const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  margin: 40px;
  max-height: 90vh;
`);

const cssTrigger = styled('div', `
  background-color: lightgrey;
  border-radius: 4px;
  width: 200px;
  padding: 8px 16px;
  margin: 16px;
`);

const cssTip = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssRow = styled('div', `
  display: flex;
  flex-direction: row;
  height: 70px;
`);

const cssLabel = styled('label', `
  align-self: center;
`);

void withLocale(() => {
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'}));
  dom.update(document.body, dom.cls(cssRootVars), setupTest());
});
