import { ColorOption, colorSelect } from 'app/client/ui2018/ColorSelect';
import { cssRootVars } from 'app/client/ui2018/cssVars';
import { Disposable, dom, IDisposableOwner, makeTestId, obsArray, Observable, styled } from 'grainjs';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

const testId = makeTestId('test-');

function toBool(value: string) {
  return value === '' ? undefined : value === 'true';
}

function optionToString(value?: boolean) {
  return value === undefined ? 'undefined' : String(value);
}

function obsOption() {
  return Observable.create(null, undefined) as Observable<boolean|undefined>;
}

/**
 * TODO: This borrows code from `fixtures/projects/editableLabel` which could be factored out.
 */
class SaveableSetup extends Disposable {


  public savedTextColor = Observable.create(null, '#000000');
  public savedFillColor = Observable.create(null, '#FFFFFF');

  public textColor = Observable.create(null, '#000000');
  public fillColor = Observable.create(null, '#FFFFFF');

  public savedFontBold = obsOption();
  public savedFontItalic = obsOption();
  public savedFontUnderline = obsOption();
  public savedFontStrikethrough = obsOption();

  public fontBold = obsOption();
  public fontItalic = obsOption();
  public fontUnderline = obsOption();
  public fontStrikethrough = obsOption();

  public textColorInput: HTMLInputElement;
  public fillColorInput: HTMLInputElement;

  public fontBoldInput: HTMLInputElement;
  public fontItalicInput: HTMLInputElement;
  public fontUnderlineInput: HTMLInputElement;
  public fontStrikethroughInput: HTMLInputElement;

  // A log of calls made and completed, for testing the sequence of events.
  public callLog = this.autoDispose(obsArray<string>([]));

  constructor() {
    super();

    // exposes a way to trigger update directly from webdriver:
    // driver.executeScript('triggerUpdate()')
    (window as any).triggerUpdate = () => this.onServerUpdate();

  }

  public onServerUpdate() {
    this.savedTextColor.set(this.textColorInput.value);
    this.savedFillColor.set(this.fillColorInput.value);
    this.textColor.set(this.textColorInput.value);
    this.fillColor.set(this.fillColorInput.value);

    this.savedFontBold.set(toBool(this.fontBoldInput.value));
    this.savedFontItalic.set(toBool(this.fontItalicInput.value));
    this.savedFontUnderline.set(toBool(this.fontUnderlineInput.value));
    this.savedFontStrikethrough.set(toBool(this.fontStrikethroughInput.value));

    this.fontBold.set(toBool(this.fontBoldInput.value));
    this.fontItalic.set(toBool(this.fontItalicInput.value));
    this.fontUnderline.set(toBool(this.fontUnderlineInput.value));
    this.fontStrikethrough.set(toBool(this.fontStrikethroughInput.value));
  }

  public async makeSaveCall(): Promise<void> {
    const callValue = JSON.stringify({
      fill: this.fillColor.get(),
      text: this.textColor.get(),
      bold: this.fontBold.get(),
      underline: this.fontUnderline.get(),
      italic: this.fontItalic.get(),
      strikethrough: this.fontStrikethrough.get(),
    });
    this.callLog.push(`Called: ${callValue}`);
  }

  public buildDom() {

    // To test server changes while editableLabel is being edited, listen to a Ctrl-U key
    // combination to act as the "Update" button without affecting focus.
    this.autoDispose(dom.onElem(document.body, 'keydown', (ev) => {
      if (ev.code === 'KeyU' && ev.ctrlKey) {
        this.onServerUpdate();
      }
    }));

    return [
      testBox(
        cssItem(
          dom('h3', 'Server value'),
          cssRow(
            cssHeader('text: '),
            cssCellBox(dom.style('background-color', this.savedTextColor)),
            cssCellBox(dom.text(this.savedTextColor)),
          ),
          cssRow(
            cssHeader('fill: '),
            cssCellBox(dom.style('background-color', this.savedFillColor)),
            cssCellBox(dom.text(this.savedFillColor))
          ),
          cssRow(
            cssHeader('bold: '),
            cssCellBox(dom.text(use => optionToString(use(this.savedFontBold))))
          ),
          cssRow(
            cssHeader('underline: '),
            cssCellBox(dom.text(use => optionToString(use(this.savedFontUnderline))))
          ),
          cssRow(
            cssHeader('italic: '),
            cssCellBox(dom.text(use => optionToString(use(this.savedFontItalic))))
          ),
          cssRow(
            cssHeader('strikethrough: '),
            cssCellBox(dom.text(use => optionToString(use(this.savedFontStrikethrough))))
          ),
        ),
        cssItem(
          dom('h3', 'Update value'),
          cssRow(
            cssHeader('text: '),
            cssCellBox(
              this.textColorInput = dom('input', {value: '#000000'}),
            ),
            testId('text-server-value'),
          ),
          cssRow(
            cssHeader('fill: '),
            cssCellBox(
              this.fillColorInput = dom('input', {value: '#FFFFFF'}),
            ),
            testId('fill-server-value'),
          ),
          cssRow(
            cssHeader('bold: '),
            cssCellBox(
              this.fontBoldInput = dom('input', {value: ''}),
            ),
            testId('bold-server-value'),
          ),
          cssRow(
            cssHeader('underline: '),
            cssCellBox(
              this.fontUnderlineInput = dom('input', {value: ''}),
            ),
            testId('underline-server-value'),
          ),
          cssRow(
            cssHeader('italic: '),
            cssCellBox(
              this.fontItalicInput = dom('input', { value: ''}),
            ),
            testId('italic-server-value'),
          ),
          cssRow(
            cssHeader('strikethrough: '),
            cssCellBox(
              this.fontStrikethroughInput = dom('input', {value: ''}),
            ),
            testId('strikethrough-server-value'),
          ),
          dom('input', {type: 'button', value: 'Update'}, testId('server-update'),
              dom.on('click', () => this.onServerUpdate()),
              testId('server-update'))
        ),
        cssItem(
          dom('h3', dom.text('Client')),
          cssRow(
            cssHeader('cell: '),
            cssCellBox(
              dom.style('color', this.textColor),
              dom.style('background-color', this.fillColor),
              dom.cls('font-bold', use => use(this.fontBold) ?? false),
              dom.cls('font-italic', use => use(this.fontItalic) ?? false),
              dom.cls('font-underline', use => use(this.fontUnderline) ?? false),
              dom.cls('font-strikethrough', use => use(this.fontStrikethrough) ?? false),
              dom.text('foo'),
              testId('client-cell'),
            )
          ),
          colorSelect({
              textColor: new ColorOption({color:this.textColor}),
              fillColor: new ColorOption({color:this.fillColor}),
              fontBold: this.fontBold,
              fontItalic: this.fontItalic,
              fontUnderline: this.fontUnderline,
              fontStrikethrough: this.fontStrikethrough
            }, {
              onSave: () => this.makeSaveCall()
            })
        )
      ),
      testBox(
        cssItem(
          dom('div', "Call Log"),
          dom('ul', testId('call-log'),
              dom.forEach(this.callLog, val => dom('li', val))),
        ),
      )
    ];
  }
}

function setupTest(owner: IDisposableOwner) {
  const value = Observable.create(owner, dom.create(SaveableSetup));
  return [
    dom('div', dom('input', {type: 'button', value: 'Reset All'},
      testId('reset'),
      dom.on('click', () => value.set(dom.create(SaveableSetup))))),
    dom('div', dom.domComputed(value)),
  ];
}

const testBox = styled('div', `
  width: 260px;
  padding: 16px;
  box-shadow: 1px 1px 4px 2px #AAA;
  margin-left: 50px;
  margin-top: 50px;
  float: left;
`);

const cssCellBox = styled('div', `
  flex-grow: 1;
  height: 30px;
  border: 1px solid gray;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace;
  width: 0;
  & input {
    width: calc(100% - 8px);
  }
`);

const cssRow = styled('div', `
  display: flex;
`);

const cssItem = styled('div', `
  margin: 25px 0;
`);

const cssHeader = styled('div', `
  min-width: 40px;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), dom.create(setupTest)));
