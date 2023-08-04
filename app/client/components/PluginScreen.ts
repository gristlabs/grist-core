import { makeT } from 'app/client/lib/localization';
import { bigBasicButton } from 'app/client/ui2018/buttons';
import { testId, theme } from 'app/client/ui2018/cssVars';
import { loadingSpinner } from 'app/client/ui2018/loaders';
import { cssModalButtons, cssModalTitle, IModalControl, IModalOptions, modal } from 'app/client/ui2018/modals';
import { PluginInstance } from 'app/common/PluginInstance';
import { RenderTarget } from 'app/plugin/RenderOptions';
import { Disposable, dom, DomContents, Observable, styled } from 'grainjs';

const t = makeT('PluginScreen');

/**
 * Rendering options for the PluginScreen modal.
 */
export interface RenderOptions {
  // Maximizes modal to fill the viewport.
  fullscreen?: boolean;
  fullbody?: boolean;
}

/**
 * Helper for showing plugin components during imports.
 */
export class PluginScreen extends Disposable {
  private _openModalCtl: IModalControl | null = null;
  private _importerContent = Observable.create<DomContents>(this, null);
  private _fullscreen = Observable.create(this, false);
  private _fullbody = Observable.create(this, false);

  constructor(private _title: string) {
    super();
  }

  // The importer state showing the inline element from the plugin (e.g. to enter URL in case of
  // import-from-url).
  public renderContent(inlineElement: HTMLElement) {
    this.render([this._buildModalTitle(), inlineElement]);
  }

  // registers a render target for plugin to render inline.
  public renderPlugin(plugin: PluginInstance): RenderTarget {
    const handle: RenderTarget = plugin.addRenderTarget((el, opt = {}) => {
      el.style.width = "100%";
      el.style.height = opt.height || "200px";
      this.renderContent(el);
    });
    return handle;
  }

  public render(content: DomContents, options?: RenderOptions) {
    this._fullscreen.set(Boolean(options?.fullscreen));
    this._fullbody.set(Boolean(options?.fullbody));
    this.showImportDialog();
    this._importerContent.set(content);
  }

  // The importer state showing just an error.
  public renderError(message: string) {
    this._fullbody.set(false);
    this.render([
      this._buildModalTitle(),
      cssModalBody(t("Import failed: "), message, testId('importer-error')),
      cssModalButtons(
        bigBasicButton('Close',
          dom.on('click', () => this.close()),
          testId('modal-cancel'))),
    ]);
  }

  // The importer state showing just a spinner, when the user has to wait. We don't even let the
  // user cancel it, because the cleanup can only happen properly once the wait completes.
  public renderSpinner() {
    this._fullbody.set(false);
    this.render([this._buildModalTitle(), cssSpinner(loadingSpinner())]);
  }

  public close() {
    this._openModalCtl?.close();
    this._openModalCtl = null;
  }

  public showImportDialog(options?: IModalOptions) {
    if (this._openModalCtl) { return; }
    modal((ctl, ctlOwner) => {
      this._openModalCtl = ctl;

      // Make sure we are close when parent is closed.
      this.onDispose(() => {
        if (ctlOwner.isDisposed()) { return; }
        ctl.close();
      });

      return [
        cssModalOverrides.cls(''),
        cssModalOverrides.cls('-fullscreen', this._fullscreen),
        cssModalOverrides.cls('-fullbody', this._fullbody),
        dom.domComputed(this._importerContent),
        testId('importer-dialog'),
      ];
    }, {
      noClickAway: true,
      noEscapeKey: true,
      ...options,
    });
  }

  private _buildModalTitle(rightElement?: DomContents) {
    return cssModalHeader(cssModalTitle(this._title), rightElement);
  }
}


const cssModalOverrides = styled('div', `
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  & > .${cssModalButtons.className} {
    margin-top: 16px;
  }

  &-fullscreen {
    height: 100%;
    margin: 32px;
  }

  &-fullbody {
    padding: 0px;
    background-color: ${theme.importerOutsideBg};
  }
`);

const cssModalBody = styled('div', `
  padding: 16px 0;
  overflow-y: auto;
  max-width: 470px;
  white-space: pre-line;
`);

const cssModalHeader = styled('div', `
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  & > .${cssModalTitle.className} {
    margin-bottom: 0px;
  }
`);

const cssSpinner = styled('div', `
  display: flex;
  align-items: center;
  height: 80px;
  margin: auto;
`);
