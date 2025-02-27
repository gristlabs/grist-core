import {cssRootVars} from 'app/client/ui2018/cssVars';
import {editableLabel, textInput} from 'app/client/ui2018/editableLabel';
import {Computed, Disposable, dom, IDisposableOwner, makeTestId, obsArray, Observable, select, styled} from 'grainjs';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

interface PendingCall {
  callValue: string;
  resolve(): void;
  reject(err: Error): void;
}

type ComponentName = 'textInput'|'editableLabel';

const testId = makeTestId('test-');

/**
 * This test simulates the flow when an editableLabel is used to edit a value that will get saved
 * to the server. The call to save it is asynchronous, and we expose a text-box and buttons for
 * each call to set the return value, and to resolve or reject it.
 */
class SaveableSetup extends Disposable {
  // The value that reflects the state on the server.
  public savedValue = Observable.create<string>(this, "Hello");

  // To simulate a pending call that's been made to the server, this contains the resolve/reject
  // methods to complete the call.
  public pendingCalls = this.autoDispose(obsArray<PendingCall>([]));

  // A log of calls made and completed, for testing the sequence of events.
  public callLog = this.autoDispose(obsArray<string>([]));

  constructor(public component: ComponentName) {
    super();
  }

  // Simulates a value getting updated due to an update on the server side.
  public onServerUpdate(value: string) {
    this.savedValue.set(value);
  }

  // Simulates a save call to the server. This will add an entry to pendingCalls. To resolve it,
  // call pendingCall.resolve (or reject), AND change the server value with onServerUpdate() to
  // simulate a successful save.
  public async makeSaveCall(callValue: string): Promise<void> {
    this.callLog.push(`Called: ${callValue}`);
    let pendingCall: PendingCall;
    try {
      await new Promise<void>((resolve, reject) => {
        pendingCall = {callValue, resolve, reject};
        this.pendingCalls.push(pendingCall);
      });
      this.callLog.push(`Resolved`);
    } catch (e) {
      this.callLog.push(`Rejected: ${e.message}`);
      throw e;
    } finally {
      const index = this.pendingCalls.get().indexOf(pendingCall!);
      this.pendingCalls.splice(index, 1);
    }
  }

  public buildDom() {
    let serverInput: HTMLInputElement;
    const obs = Computed.create(this, (use) => use(this.savedValue));
    const save = (val: string) => this.makeSaveCall(val);

    // To test server changes while editableLabel is being edited, listen to a Ctrl-U key
    // combination to act as the "Update" button without affecting focus.
    this.autoDispose(dom.onElem(document.body, 'keydown', (ev) => {
      if (ev.code === 'KeyU' && ev.ctrlKey) {
        this.onServerUpdate(serverInput.value);
      }
    }));

    return [
      cssTestBox(
        cssItem(
          dom('div', "Editable label:"),
          this.component === 'editableLabel' ?
            cssEditableLabel(obs, {save, inputArgs: [testId('edit-label')]}) :
            cssTextInput(obs, save, testId('edit-label')),
        ),
        cssItem(dom('div', "Saved value:"),
          dom('span', dom.text(this.savedValue), testId('saved-value'))),
        cssItem(dom('div', "Server value:"),
          serverInput = dom('input', {type: 'text'}, testId('server-value'),
            dom.prop('value', this.savedValue)),
          dom('input', {type: 'button', value: 'Update'}, testId('server-update'),
            dom.on('click', (ev) => this.onServerUpdate(serverInput.value)))
        ),
        dom.forEach(this.pendingCalls, (pendingCall: PendingCall) =>
          cssItem(dom('div', "Pending call:"), dom.text(pendingCall.callValue),
            testId('call'),
            dom('input', {type: 'button', value: 'Resolve'}, testId('call-resolve'),
              dom.on('click', () => pendingCall.resolve())),
            dom('input', {type: 'button', value: 'Reject'}, testId('call-reject'),
              dom.on('click', () => pendingCall.reject(new Error('FakeError')))),
          ),
        ),
      ),
      cssTestBox(
        cssItem(
          dom('div', "Call Log"),
          dom('ul', testId('call-log'),
            dom.forEach(this.callLog, val => dom('li', val))),
        ),
      ),
    ];
  }
}

function setupTest(owner: IDisposableOwner) {
  // The only purpose of this observable is to trigger the rebuilding of SaveableSetup. It's
  // strange, but fairly simple.
  const value = Observable.create(owner, 1);
  const component = Observable.create(owner, (window.location.hash || '#textInput').substr(1) as ComponentName);
  return [
    dom('div', dom('input', {type: 'button', value: 'Reset All'},
      testId('reset'),
      dom.on('click', () => value.set(value.get() + 1)))),
    dom('div', select(component, ['textInput', 'editableLabel']), testId('select-component')),
    dom('div', dom.domComputed((use) => (use(value), dom.create(SaveableSetup, use(component))))),
  ];
}

const cssTestBox = styled('div', `
  float: left;
  width: 250px;
  margin-left: 50px;
  margin-top: 50px;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
`);

const cssItem = styled('div', `
  margin: 30px;
`);

const cssEditableLabel = styled(editableLabel, `
  color: blue;
   &:focus { background-color: lightgrey; }
`);

const cssTextInput = styled(textInput, `
  color: blue;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), dom.create(setupTest)));
