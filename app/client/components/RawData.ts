import * as commands from 'app/client/components/commands';
import {DataTables} from 'app/client/components/DataTables';
import {DocumentUsage} from 'app/client/components/DocumentUsage';
import {GristDoc} from 'app/client/components/GristDoc';
import {printViewSection} from 'app/client/components/Printing';
import {buildViewSectionDom, ViewSectionHelper} from 'app/client/components/ViewLayout';
import {colors, mediaSmall, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, fromKo, makeTestId, styled} from 'grainjs';
import {reportError} from 'app/client/models/errors';

const testId = makeTestId('test-raw-data-');

export class RawData extends Disposable {
  constructor(private _gristDoc: GristDoc) {
    super();
    const commandGroup = {
      cancel: () => { this._close(); },
      printSection: () => { printViewSection(null, this._gristDoc.viewModel.activeSection()).catch(reportError); },
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));
  }

  public buildDom() {
    // Handler to close the lightbox.
    const close = this._close.bind(this);

    return cssContainer(
      dom.create(DataTables, this._gristDoc),
      dom.create(DocumentUsage, this._gristDoc.docPageModel),
      /***************  Lightbox section **********/
      dom.domComputedOwned(fromKo(this._gristDoc.viewModel.activeSection), (owner, viewSection) => {
        if (!viewSection.getRowId()) {
          return null;
        }
        ViewSectionHelper.create(owner, this._gristDoc, viewSection);
        return cssOverlay(
          testId('overlay'),
          cssSectionWrapper(
            buildViewSectionDom({
              gristDoc: this._gristDoc,
              sectionRowId: viewSection.getRowId(),
              draggable: false,
              focusable: false,
              onRename: this._renameSection.bind(this)
            })
          ),
          cssCloseButton('CrossBig',
            testId('close-button'),
            dom.on('click', close)
          ),
          // Close the lightbox when user clicks exactly on the overlay.
          dom.on('click', (ev, elem) => void (ev.target === elem ? close() : null))
        );
      }),
    );
  }

  private _close() {
    this._gristDoc.viewModel.activeSectionId(0);
  }

  private async _renameSection(name: string) {
    // here we will rename primary page for active primary viewSection
    const primaryViewName = this._gristDoc.viewModel.activeSection.peek().table.peek().primaryView.peek().name;
    await primaryViewName.saveOnly(name);
  }
}

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);

const cssOverlay = styled('div', `
  z-index: 10;
  background-color: ${colors.backdrop};
  inset: 0px;
  height: 100%;
  width: 100%;
  padding: 32px 56px 0px 56px;
  position: absolute;
  @media ${mediaSmall} {
    & {
      padding: 22px;
      padding-top: 30px;
    }
  }
`);

const cssSectionWrapper = styled('div', `
  background: white;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 5px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
  & .viewsection_content {
    margin: 0px;
    margin-top: 12px;
  }
  & .viewsection_title {
    padding: 0px 12px;
  }
  & .filter_bar {
    margin-left: 6px;
  }
`);

const cssCloseButton = styled(icon, `
  position: absolute;
  top: 16px;
  right: 16px;
  height: 24px;
  width: 24px;
  cursor: pointer;
  --icon-color: ${vars.primaryBg};
  &:hover {
    --icon-color: ${colors.lighterGreen};
  }
  @media ${mediaSmall} {
    & {
      top: 6px;
      right: 6px;
    }
  }
`);
