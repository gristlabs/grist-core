import { basicButton } from 'app/client/ui2018/buttons';
import { primaryButton } from 'app/client/ui2018/buttons';
import { cssRootVars } from 'app/client/ui2018/cssVars';
import { confirmModal, modal, saveModal, spinnerModal } from 'app/client/ui2018/modals';
import { dom, input, makeTestId, styled } from 'grainjs';
import { Computed, Observable, observable } from 'grainjs';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';


function setupTest() {
  const confirmed = observable(false);
  const isOpen = observable(false);
  const isSaveModalOpen = observable(false);
  const testId = makeTestId('testui-');
  const asyncTask = observable<{resolve: () => void}|null>(null);
  return cssTestBox(
    dom('h1', 'Modals'),
    dom('div',
      primaryButton('Confirmation modal',
        dom.on('click', () => {
          confirmed.set(false);
          confirmModal('Default modal header', 'OK',
            async () => confirmed.set(true),
            {explanation: 'Default modal body'});
        }),
        testId('confirm-modal-opener'),
      ),
      dom('span', ' Modal ', dom.text((use) => use(confirmed) ? 'Confirmed' : 'Cancelled'),
        testId('confirm-modal-text'),
      ),
    ),
    dom('div',
      basicButton('Custom modal',
        dom.on('click', () =>
          modal((ctl) => {
            isOpen.set(true);
            return dom('div',
              // This allows us to ensure that disposers get run when the modal is closed.
              dom.onDispose(() => isOpen.set(false)),
              primaryButton('Greetings!', dom.on('click', () => ctl.close()),
                testId('custom-modal-btn'))
            );
          }),
        ),
        testId('custom-modal-opener'),
      ),
      dom('span', ' Modal is ', dom.text((use) => use(isOpen) ? 'Open' : 'Closed'),
        testId('custom-modal-text'),
      )
    ),

    // For saveModal, we check a number of features:
    // 1. Various elements support arbitrary DomElementArg arguments.
    // 2. saveDisabled argument is respected.
    // 3. modalArgs argument is respected.
    // 4. Save button is disabled while saving.
    // 5. It waits for saveFunc before closing, and stays open on rejection
    // 6. Closing disposes owned values.
    dom('div',
      primaryButton('Save modal',
        testId('save-modal-opener'),
        dom.on('click', () => saveModal((ctl, owner) => {
          isSaveModalOpen.set(true);
          const value = Observable.create(owner, "Hello");
          const saving = Observable.create(owner, 0);

          // To test disposal, increment a counter each time this saveModal is disposed.
          owner.onDispose(() => isSaveModalOpen.set(false));

          // To test saving, fulfill saveFunc() if "y" is pressed, reject if "n" is pressed.
          // Also increment "saving" observable, so that we can tell while saveFunc() is pending.
          async function saveFunc() {
            saving.set(saving.get() + 1);
            try {
              await new Promise<void>((resolve, reject) => {
                const sub = dom.onKeyElem(document.body, 'keydown', {
                  y: () => { sub.dispose(); resolve(); },
                  n: () => { sub.dispose(); reject(new Error("fake-error")); },
                });
              });
            } finally {
              saving.set(saving.get() - 1);
            }
          }

          return {
            title: dom.text((use) => `Title [${use(value)}] (saving=${use(saving)})`),
            body: [
              dom('span', "Some value: "),
              input(value, {onInput: true}, testId('save-modal-input')),
            ],
            saveLabel: dom.text((use) => `Save [${use(value)}]`),
            // To test saveDisabled, disable the button if the value is empty.
            saveDisabled: Computed.create(owner, (use) => !use(value)),
            saveFunc,
            // To test modalArgs, change opacity when value is the text "translucent"
            modalArgs: dom.style('opacity', (use) => (use(value) === 'translucent' ? '0.5' : '')),
          };
        })),
      ),
      dom('span', ' Modal ', dom.text((use) => use(isSaveModalOpen) ? "Open" : "Closed"),
        testId('save-modal-is-open'),
      ),
       ),

    dom(
      'div',
      primaryButton(
        'Spinner modal',
        testId('spinner-modal-opener'),
        dom.on('click', async () => {
          const promise = new Promise<void>((resolve) => asyncTask.set({resolve}));
          await spinnerModal("Spinner Modal", promise);
          document.body.appendChild(
            dom('div', 'After spinner', testId('after-spinner'))
          );
        }),
        testId('spinner-modal-opener'),
      ),
      dom.maybe(asyncTask, ({resolve}) => cssResolve(
        'Async Taks',
        dom('button', 'Resolve',
            dom.on('click', () => { resolve(); asyncTask.set(null); }),
            testId('resolve-spinner-task')
           )
      ))
    )
  );
}

const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
  & > div { margin: 8px; }
                          `);

const cssResolve = styled('div', `
  float: right;
  position: relative;
  z-index: 1000;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
