/**
 * Exports `docBreadcrumbs()` which returns a styled breadcrumb for the current page:
 *
 *  [icon] Workspace (link) / Document name (editable) / Page name (editable)
 *
 * Workspace is a clickable link and document and page names are editable labels.
 */
import { urlState } from 'app/client/models/gristUrlState';
import { cssHideForNarrowScreen, mediaNotSmall, testId, theme } from 'app/client/ui2018/cssVars';
import { editableLabel } from 'app/client/ui2018/editableLabel';
import { icon } from 'app/client/ui2018/icons';
import { cssLink } from 'app/client/ui2018/links';
import { UserOverride } from 'app/common/DocListAPI';
import { userOverrideParams } from 'app/common/gristUrls';
import { BindableValue, dom, Observable, styled } from 'grainjs';
import { tooltip } from 'popweasel';

export const cssBreadcrumbs = styled('div', `
  color: ${theme.lightText};
  white-space: nowrap;
  cursor: default;
`);

export const separator = styled('span', `
  padding: 0 2px;
`);

const cssIcon = styled(icon, `
  background-color: ${theme.accentIcon};
  margin-top: -2px;
`);

const cssPublicIcon = styled(cssIcon, `
  margin-left: 8px;
  margin-top: -4px;
`);

const cssWorkspaceName = styled(cssLink, `
  margin-left: 8px;
`);

const cssWorkspaceNarrowScreen = styled(icon, `
  transform: rotateY(180deg);
  width: 32px;
  height: 32px;
  margin-bottom: 4px;
  margin-left: -7px;
  margin-right: 8px;
  background-color: ${theme.lightText};
  cursor: pointer;
  @media ${mediaNotSmall} {
    & {
      display: none;
    }
  }
`);

const cssEditableName = styled('input', `
  &:hover, &:focus {
    color: ${theme.text};
  }
`);

const cssTag = styled('span', `
  background-color: ${theme.breadcrumbsTagBg};
  color: ${theme.breadcrumbsTagFg};
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
`);

const cssAlertTag = styled(cssTag, `
  background-color: ${theme.breadcrumbsTagAlertBg};
  --icon-color: ${theme.breadcrumbsTagFg};
  a {
    cursor: pointer;
  }
`);

interface PartialWorkspace {
  id: number;
  name: string;
}

const fiddleExplanation = (
  'You may make edits, but they will create a new copy and will\n' +
    'not affect the original document.'
);

export function docBreadcrumbs(
  workspace: Observable<PartialWorkspace|null>,
  docName: Observable<string>,
  pageName: Observable<string>,
  options: {
    docNameSave: (val: string) => Promise<void>,
    pageNameSave: (val: string) => Promise<void>,
    cancelRecoveryMode: () => Promise<void>,
    isDocNameReadOnly?: BindableValue<boolean>,
    isPageNameReadOnly?: BindableValue<boolean>,
    isFork: Observable<boolean>,
    isBareFork: Observable<boolean>,
    isFiddle: Observable<boolean>,
    isRecoveryMode: Observable<boolean>,
    userOverride: Observable<UserOverride|null>,
    isSnapshot?: Observable<boolean>,
    isPublic?: Observable<boolean>,
  }
  ): Element {
    return cssBreadcrumbs(
      dom.domComputed<[boolean, PartialWorkspace|null]>(
        (use) => [use(options.isBareFork), use(workspace)],
        ([isBareFork, ws]) => {
          if (isBareFork || !ws) { return null; }
          return [
            cssIcon('Home',
              testId('bc-home'),
              cssHideForNarrowScreen.cls('')),
            cssWorkspaceName(
              urlState().setLinkUrl({ws: ws.id}),
              dom.text(ws.name),
              testId('bc-workspace'),
              cssHideForNarrowScreen.cls('')
            ),
            cssWorkspaceNarrowScreen(
              'Expand',
              urlState().setLinkUrl({ws: ws.id}),
              testId('bc-workspace-ns')
            ),
            separator(' / ',
                      testId('bc-separator'),
                      cssHideForNarrowScreen.cls(''))
          ];
        }
      ),
      editableLabel(docName, {
        save: options.docNameSave,
        inputArgs: [
          testId('bc-doc'),
          cssEditableName.cls(''),
          dom.boolAttr('disabled', options.isDocNameReadOnly || false),
        ],
      }),
      dom.maybe(options.isPublic, () => cssPublicIcon('PublicFilled', testId('bc-is-public'))),
      dom.domComputed((use) => {
        if (options.isSnapshot && use(options.isSnapshot)) {
          return cssTag('snapshot', testId('snapshot-tag'));
        }
        if (use(options.isFork)) {
          return cssTag('unsaved', testId('unsaved-tag'));
        }
        if (use(options.isRecoveryMode)) {
          return cssAlertTag('recovery mode',
                             dom('a', dom.on('click', () => options.cancelRecoveryMode()),
                                 icon('CrossSmall')),
                             testId('recovery-mode-tag'));
        }
        const userOverride = use(options.userOverride);
        if (userOverride) {
          return cssAlertTag(userOverride.user?.email || 'override',
            dom('a',
              urlState().setHref(userOverrideParams(null)),
              icon('CrossSmall')
            ),
            testId('user-override-tag')
          );
        }
        if (use(options.isFiddle)) {
          return cssTag('fiddle', tooltip({title: fiddleExplanation}), testId('fiddle-tag'));
        }
      }),
      separator(' / ',
                testId('bc-separator'),
                cssHideForNarrowScreen.cls('')),
      editableLabel(pageName, {
        save: options.pageNameSave,
        inputArgs: [
          testId('bc-page'),
          cssEditableName.cls(''),
          dom.boolAttr('disabled', options.isPageNameReadOnly || false),
          dom.cls(cssHideForNarrowScreen.className),
        ],
      }),
    );
}
