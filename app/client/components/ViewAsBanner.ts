import { reportError } from 'app/client/models/AppModel';
import { Banner } from "app/client/components/Banner";
import { DocPageModel } from "app/client/models/DocPageModel";
import { icon } from "app/client/ui2018/icons";
import { primaryButtonLink } from 'app/client/ui2018/buttons';
import { Disposable, dom, styled } from "grainjs";
import { testId, theme } from 'app/client/ui2018/cssVars';
import { urlState } from 'app/client/models/gristUrlState';
import { userOverrideParams } from 'app/common/gristUrls';
import { cssMenuItem } from 'popweasel';
import { getUserRoleText } from 'app/common/UserAPI';
import { PermissionDataWithExtraUsers } from 'app/common/ActiveDocAPI';
import { waitGrainObs } from 'app/common/gutil';
import { cssSelectBtn } from 'app/client/ui2018/select';
import { ACLUsersPopup } from 'app/client/aclui/ACLUsers';
import { UserOverride } from 'app/common/DocListAPI';
import { makeT } from 'app/client/lib/localization';

const t = makeT('components.ViewAsBanner');

export class ViewAsBanner extends Disposable {

  private _userOverride = this._docPageModel.userOverride;
  private _usersPopup = ACLUsersPopup.create(this, this._docPageModel, this._getUsersForViewAs.bind(this));

  constructor (private _docPageModel: DocPageModel) {
    super();
  }

  public buildDom() {
    return dom.maybe(this._userOverride, (userOverride) => {
      this._initViewAsUsers().catch(reportError);
      return dom.create(Banner, {
        content: this._buildContent(userOverride),
        style: 'info',
        showCloseButton: false,
        showExpandButton: false,
        bannerCssClass: cssBanner.className,
      });
    });
  }

  private _buildContent(userOverride: UserOverride) {
    const {user, access} = userOverride;
    return cssContent(
      cssMessageText(
        cssMessageIcon('EyeShow'),
        'You are viewing this document as',
      ),
      cssSelectBtn(
        {tabIndex: '0'},
        cssBtnText(
          user ? cssMember(
            user.name || user.email,
            cssRole('(', getUserRoleText({...user, access}), ')', dom.show(Boolean(access))),
          ) : t('UnknownUser'),
        ),
        dom(
          'div', {style: 'flex: none;'},
          cssInlineCollapseIcon('Collapse'),
        ),
        elem => this._usersPopup.attachPopup(elem, {}),
        testId('select-open'),
      ),
      cssPrimaryButtonLink(
        'View as Yourself', cssIcon('Convert'),
        urlState().setHref(userOverrideParams(null)),
        testId('revert'),
      ),
      testId('view-as-banner'),
    );
  }

  private async _initViewAsUsers() {
    await waitGrainObs(this._docPageModel.gristDoc);
    await this._usersPopup.load();
  }

  private _getUsersForViewAs(): Promise<PermissionDataWithExtraUsers> {
    const docId = this._docPageModel.currentDocId.get()!;
    const docApi = this._docPageModel.appModel.api.getDocAPI(docId);
    return docApi.getUsersForViewAs();
  }
}

const cssContent = styled('div', `
  display: flex;
  justify-content: center;
  width: 100%;
  column-gap: 13px;
  align-items: center;
  & .${cssSelectBtn.className} {
    width: 184px;
  }
`);
const cssIcon = styled(icon, `
  margin-left: 10px;
`);
const cssMember = styled('span', `
  font-weight: 500;
  color: ${theme.text};

  .${cssMenuItem.className}-sel & {
    color: ${theme.menuItemSelectedFg};
  }
`);
const cssRole = styled('span', `
  font-weight: 400;
  margin-left: 1ch;
`);
const cssMessageText = styled('span', `
`);
const cssMessageIcon = styled(icon, `
  margin-right: 10px;
`);
const cssPrimaryButtonLink = styled(primaryButtonLink, `
  margin-left: 5px;
`);
const cssBtnText = styled('div', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);
const cssInlineCollapseIcon = styled(icon, `
  margin: 0 2px;
  pointer-events: none;
`);
const cssBanner = styled('div', `
  border-bottom: 1px solid ${theme.pagePanelsBorder};
  height: 45px;
`);
