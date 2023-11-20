import {buildViewSectionDom} from 'app/client/components/buildViewSectionDom';
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {cssCloseButton, cssOverlay} from 'app/client/components/RawDataPage';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {ViewSectionHelper} from 'app/client/components/ViewLayout';
import {theme} from 'app/client/ui2018/cssVars';
import {Disposable, dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-record-card-popup-');

interface RecordCardPopupOptions {
  gristDoc: GristDoc;
  viewSection: ViewSectionRec;
  onClose(): void;
}

export class RecordCardPopup extends Disposable {
  private _gristDoc = this._options.gristDoc;
  private _viewSection = this._options.viewSection;
  private _handleClose = this._options.onClose;

  constructor(private _options: RecordCardPopupOptions) {
    super();
    const commandGroup = {
      cancel: () => { this._handleClose(); },
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));
  }

  public buildDom() {
    ViewSectionHelper.create(this, this._gristDoc, this._viewSection);
    return cssOverlay(
      testId('overlay'),
      cssSectionWrapper(
        buildViewSectionDom({
          gristDoc: this._gristDoc,
          sectionRowId: this._viewSection.getRowId(),
          draggable: false,
          focusable: false,
          renamable: false,
          hideTitleControls: true,
        }),
      ),
      cssCloseButton('CrossBig',
        dom.on('click', () => this._handleClose()),
        testId('close'),
      ),
      dom.on('click', (ev, elem) => void (ev.target === elem ? this._handleClose() : null)),
    );
  }
}

const cssSectionWrapper = styled('div', `
  background: ${theme.mainPanelBg};
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
  & .viewsection_content {
    margin: 0px;
    margin-top: 8px;
  }
  & .viewsection_title {
    padding: 0px 12px;
  }
`);
