import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import * as version from 'app/common/version';
import {buildHomeBanners} from 'app/client/components/Banners';
import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {SupportGristPage} from 'app/client/ui/SupportGristPage';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {transition} from 'app/client/ui/transitions';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {Disposable, dom, DomContents, IDisposableOwner, Observable, styled} from 'grainjs';

const t = makeT('AdminPanel');

// Translated "Admin Panel" name, made available to other modules.
export function getAdminPanelName() {
  return t("Admin Panel");
}

export class AdminPanel extends Disposable {
  private _supportGrist = SupportGristPage.create(this, this._appModel);

  constructor(private _appModel: AppModel) {
    super();
    document.title = getAdminPanelName() + getPageTitleSuffix(getGristConfig());
  }

  public buildDom() {
    const panelOpen = Observable.create(this, false);
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen,
        hideOpener: true,
        header: dom.create(AppHeader, this._appModel),
        content: leftPanelBasic(this._appModel, panelOpen),
      },
      headerMain: this._buildMainHeader(),
      contentTop: buildHomeBanners(this._appModel),
      contentMain: dom.create(this._buildMainContent.bind(this)),
    });
  }

  private _buildMainHeader() {
    return dom.frag(
      cssBreadcrumbs({style: 'margin-left: 16px;'},
        cssLink(
          urlState().setLinkUrl({}),
          t('Home'),
        ),
        separator(' / '),
        dom('span', getAdminPanelName()),
      ),
      createTopBarHome(this._appModel),
    );
  }

  private _buildMainContent(owner: IDisposableOwner) {
    return cssPageContainer(
      dom.cls('clipboard'),
      {tabIndex: "-1"},
      cssSection(
        cssSectionTitle(t('Support Grist')),
        this._buildItem(owner, {
          id: 'telemetry',
          name: t('Telemetry'),
          description: t('Help us make Grist better'),
          value: maybeSwitchToggle(this._supportGrist.getTelemetryOptInObservable()),
          expandedContent: this._supportGrist.buildTelemetrySection(),
        }),
        this._buildItem(owner, {
          id: 'sponsor',
          name: t('Sponsor'),
          description: t('Support Grist Labs on GitHub'),
          value: this._supportGrist.buildSponsorshipSmallButton(),
          expandedContent: this._supportGrist.buildSponsorshipSection(),
        }),
      ),
      cssSection(
        cssSectionTitle(t('Version')),
        this._buildItem(owner, {
          id: 'version',
          name: t('Current'),
          description: t('Current version of Grist'),
          value: cssValueLabel(`Version ${version.version}`),
        }),
      ),
      testId('admin-panel'),
    );
  }

  private _buildItem(owner: IDisposableOwner, options: {
    id: string,
    name: DomContents,
    description: DomContents,
    value: DomContents,
    expandedContent?: DomContents,
  }) {
    const itemContent = [
      cssItemName(options.name, testId(`admin-panel-item-name-${options.id}`)),
      cssItemDescription(options.description),
      cssItemValue(options.value,
        testId(`admin-panel-item-value-${options.id}`),
        dom.on('click', ev => ev.stopPropagation())),
    ];
    if (options.expandedContent) {
      const isCollapsed = Observable.create(owner, true);
      return cssItem(
        cssItemShort(
          dom.domComputed(isCollapsed, (c) => cssCollapseIcon(c ? 'Expand' : 'Collapse')),
          itemContent,
          cssItemShort.cls('-expandable'),
          dom.on('click', () => isCollapsed.set(!isCollapsed.get())),
        ),
        cssExpandedContentWrap(
          transition(isCollapsed, {
            prepare(elem, close) { elem.style.maxHeight = close ? elem.scrollHeight + 'px' : '0'; },
            run(elem, close) { elem.style.maxHeight = close ? '0' : elem.scrollHeight + 'px'; },
            finish(elem, close) { elem.style.maxHeight = close ? '0' : 'unset'; },
          }),
          cssExpandedContent(
            options.expandedContent,
          ),
        ),
        testId(`admin-panel-item-${options.id}`),
      );
    } else {
      return cssItem(
        cssItemShort(itemContent),
        testId(`admin-panel-item-${options.id}`),
      );
    }
  }
}

function maybeSwitchToggle(value: Observable<boolean|null>): DomContents {
  return dom('div.widget_switch',
    (elem) => elem.style.setProperty('--grist-actual-cell-color', theme.controlFg.toString()),
    dom.hide((use) => use(value) === null),
    dom.cls('switch_on', (use) => use(value) || false),
    dom.cls('switch_transition', true),
    dom.on('click', () => value.set(!value.get())),
    dom('div.switch_slider'),
    dom('div.switch_circle'),
  );
}

const cssPageContainer = styled('div', `
  overflow: auto;
  padding: 40px;
  font-size: ${vars.introFontSize};
  color: ${theme.text};

  @media ${mediaSmall} {
    & {
      padding: 0px;
      font-size: ${vars.mediumFontSize};
    }
  }
`);

const cssSection = styled('div', `
  padding: 24px;
  max-width: 600px;
  width: 100%;
  margin: 16px auto;
  border: 1px solid ${theme.widgetBorder};
  border-radius: 4px;

  @media ${mediaSmall} {
    & {
      width: auto;
      padding: 12px;
      margin: 8px;
    }
  }
`);

const cssSectionTitle = styled('div', `
  height: 32px;
  line-height: 32px;
  margin-bottom: 16px;
  font-size: ${vars.headerControlFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const cssItem = styled('div', `
  margin-top: 8px;
`);

const cssItemShort = styled('div', `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 8px;
  margin: 0 -8px;
  border-radius: 4px;
  &-expandable {
    cursor: pointer;
  }
  &-expandable:hover {
    background-color: ${theme.lightHover};
  }
`);

const cssItemName = styled('div', `
  width: 112px;
  font-weight: bold;
  font-size: ${vars.largeFontSize};
  &:first-child {
    margin-left: 28px;
  }
  @media ${mediaSmall} {
    & {
      width: calc(100% - 28px);
    }
    &:first-child {
      margin-left: 0;
    }
  }
`);

const cssItemDescription = styled('div', `
  margin-right: auto;
`);

const cssItemValue = styled('div', `
  flex: none;
  margin: -16px;
  padding: 16px;
  cursor: auto;
`);

const cssCollapseIcon = styled(icon, `
  width: 24px;
  height: 24px;
  margin-right: 4px;
  margin-left: -4px;
  --icon-color: ${theme.lightText};
`);

const cssExpandedContentWrap = styled('div', `
  transition: max-height 0.3s ease-in-out;
  overflow: hidden;
  max-height: 0;
`);

const cssExpandedContent = styled('div', `
  margin-left: 24px;
  padding: 24px 0;
  border-bottom: 1px solid ${theme.widgetBorder};
  .${cssItem.className}:last-child & {
    padding-bottom: 0;
    border-bottom: none;
  }
`);

const cssValueLabel = styled('div', `
  padding: 4px 8px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: ${vars.controlBorderRadius};
`);
