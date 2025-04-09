import {dom, styled} from 'grainjs';
import {testId, vars} from 'app/client/ui2018/cssVars';
import {makeT} from 'app/client/lib/localization';
import {primaryButton} from 'app/client/ui2018/buttons';
import {iconSpan} from 'app/client/ui2018/icons';
import BaseView from 'app/client/components/BaseView';

const t = makeT('NewRecordButton');

const translationStrings = {
  'record': 'New record',
  'single': 'New card',
};

/**
 * "New Record" button for the given view that inserts a new record at the end on click.
 *
 * Note that each view has its own implementation of how to "create a new record"
 * via the `onNewRecordRequest` method.
 *
 * Appears in the bottom-left corner of its parent element.
 */
export function newRecordButton(view: BaseView) {
  const viewType = view.viewSection.parentKey.peek();

  const translationString = translationStrings[viewType as keyof typeof translationStrings]
    || 'New record';
  return cssNewRecordButton(
    iconSpan('Plus'),
    dom('span', t(translationString)),
    dom.on('click', () => {
      if (view.onNewRecordRequest) {
        view.onNewRecordRequest();
      }
    }),
    testId('new-record-button')
  );
}

const cssNewRecordButton = styled(primaryButton, `
  position: absolute;
  bottom: -12px;
  left: -12px;
  z-index: ${vars.newRecordButtonZIndex};
  display: flex;
  align-items: center;
  gap: 6px;

  /* 16px on the plus icon is blurry, 17px is sharp, needs more test. */
  & > span:first-child {
    width: 17px;
    height: 17px;
  }
`);
