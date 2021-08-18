import {urlState} from 'app/client/models/gristUrlState';
import {getTheme} from 'app/client/ui/CustomThemes';
import {cssLeftPane} from 'app/client/ui/PagePanels';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import * as version from 'app/common/version';
import {BindableValue, Disposable, dom, styled} from "grainjs";
import {menu, menuDivider, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {getOrgName} from 'app/common/UserAPI';
import {AppModel} from 'app/client/models/AppModel';
import {icon} from 'app/client/ui2018/icons';


export class AppHeader extends Disposable {
  constructor(private _orgName: BindableValue<string>, private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    const theme = getTheme(this._appModel.topAppModel.productFlavor);

    return cssAppHeader(
      cssAppHeader.cls('-widelogo', theme.wideLogo || false),
      // Show version when hovering over the application icon.
      cssAppLogo(
        {title: `Ver ${version.version} (${version.gitcommit})`},
        urlState().setLinkUrl({}),
        testId('dm-logo')
      ),
      cssOrg(
        cssOrgName(dom.text(this._orgName)),
        this._orgName && cssDropdownIcon('Dropdown'),
        menu(() => this._makeOrgMenu(), {placement: 'bottom-start'}),
        testId('dm-org'),
      ),
    );
  }

  private _makeOrgMenu() {
    const orgs = this._appModel.topAppModel.orgs;

    return [
      menuItemLink(urlState().setLinkUrl({}), 'Go to Home Page', testId('orgmenu-home-page')),
      menuDivider(),
      menuSubHeader('Switch Sites'),
      dom.forEach(orgs, (org) =>
        menuItemLink(urlState().setLinkUrl({org: org.domain || undefined}),
          cssOrgSelected.cls('', this._appModel.currentOrg ? org.id === this._appModel.currentOrg.id : false),
          getOrgName(org),
          cssOrgCheckmark('Tick', testId('orgmenu-org-tick')),
          testId('orgmenu-org'),
        )
      ),
    ];
  }
}

export const cssOrgSelected = styled('div', `
  background-color: ${colors.dark};
  color: ${colors.light};
`);

export const cssOrgCheckmark = styled(icon, `
  flex: none;
  margin-left: 16px;
  --icon-color: ${colors.light};
  display: none;
  .${cssOrgSelected.className} > & {
    display: block;
  }
`);

const cssAppHeader = styled('div', `
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: ${colors.dark};
  }
`);

const cssAppLogo = styled('a', `
  flex: none;
  height: 48px;
  width: 48px;
  background-image: var(--icon-GristLogo);
  background-size: 22px 22px;
  background-repeat: no-repeat;
  background-position: center;
  background-color: ${vars.logoBg};
  .${cssAppHeader.className}-widelogo & {
    width: 100%;
    background-size: contain;
    background-origin: content-box;
    padding: 8px;
  }
  .${cssLeftPane.className}-open .${cssAppHeader.className}-widelogo & {
    background-image: var(--icon-GristWideLogo, var(--icon-GristLogo));
  }
`);

const cssDropdownIcon = styled(icon, `
  flex-shrink: 0;
  margin-right: 8px;
`);

const cssOrg = styled('div', `
  display: flex;
  flex-grow: 1;
  align-items: center;
  max-width: calc(100% - 48px);
  cursor: pointer;
  height: 100%;
`);

const cssOrgName = styled('div', `
  padding-left: 16px;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .${cssAppHeader.className}-widelogo & {
    display: none;
  }
`);
