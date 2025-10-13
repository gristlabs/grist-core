import {dom, styled} from 'grainjs';
import {testId, zIndexes} from 'app/client/ui2018/cssVars';
import {makeT} from 'app/client/lib/localization';
import {primaryButton} from 'app/client/ui2018/buttons';
import {icon} from 'app/client/ui2018/icons';
import BaseView from 'app/client/components/BaseView';

const t = makeT('NewRecordButton');

const translationStrings = {
  'record': t('New record'),
  'single': t('New card'),
};

/**
 * Helper to render the "New Record" button for the given view.
 *
 * It only renders when the experiment is enabled and the view has focus.
 */
export function maybeShowNewRecordExperiment(view: BaseView) {
  const experimentIsEnabled = view.gristDoc.appModel.experiments?.isEnabled('newRecordButton');
  return dom.maybe(
    use => (experimentIsEnabled && use(view.viewSection.hasFocus) && use(view.enableAddRow)),
    () => newRecordButton(view)
  );
}

/**
 * "New Record" button for the given view that inserts a new record at the end on click.
 *
 * Note that each view has its own implementation of how to "create a new record"
 * via the `onNewRecordRequest` method.
 *
 * Appears in the bottom-left corner of its parent element.
 */
function newRecordButton(view: BaseView) {
  const viewType = view.viewSection.parentKey.peek();

  const translationString = translationStrings[viewType as keyof typeof translationStrings]
    || t('New record');
  return cssNewRecordButton(
    icon('Plus'),
    dom('span', translationString),
    dom.on('click', () => {
      view.onNewRecordRequest?.()?.catch(reportError);
    }),
    testId('new-record-button')
  );
}

const cssNewRecordButton = styled(primaryButton, `
  position: absolute;
  bottom: -12px;
  left: -12px;
  z-index: ${zIndexes.newRecordButtonZIndex};
  display: flex;
  align-items: center;
  gap: 6px;
`);
