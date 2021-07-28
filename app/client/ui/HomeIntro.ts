import {getLoginOrSignupUrl} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import * as css from 'app/client/ui/DocMenuCss';
import {createDocAndOpen, importDocAndOpen} from 'app/client/ui/HomeLeftPane';
import {bigBasicButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls} from 'app/common/gristUrls';
import {dom, DomContents, DomCreateFunc, styled} from 'grainjs';

export function buildHomeIntro(homeModel: HomeModel): DomContents {
  const user = homeModel.app.currentValidUser;
  if (user) {
    return [
      css.docListHeader(`Welcome to Grist, ${user.name}!`, testId('welcome-title')),
      cssIntroSplit(
        cssIntroLeft(
          cssIntroImage({src: 'https://www.getgrist.com/themes/grist/assets/images/empty-folder.png'}),
          testId('intro-image'),
        ),
        cssIntroRight(
          cssParagraph(
            'Watch video on ',
            cssLink({href: 'https://support.getgrist.com/creating-doc/', target: '_blank'}, 'creating a document'),
            '.', dom('br'),
            'Learn more in our ', cssLink({href: commonUrls.help, target: '_blank'}, 'Help Center'), '.',
            testId('welcome-text')
          ),
          makeCreateButtons(homeModel),
        ),
      ),
    ];
  } else {
    return [
      cssIntroSplit(
        cssIntroLeft(
          cssLink({href: 'https://support.getgrist.com/creating-doc/', target: '_blank'},
            cssIntroImage({src: 'https://www.getgrist.com/themes/grist/assets/images/video-create-doc.png'}),
          ),
          testId('intro-image'),
        ),
        cssIntroRight(
          css.docListHeader('Welcome to Grist!', testId('welcome-title')),
          cssParagraph(
            'You can explore and experiment without logging in. ',
            'To save your work, however, you’ll need to ',
            cssLink({href: getLoginOrSignupUrl()}, 'sign up'), '.', dom('br'),
            'Learn more in our ', cssLink({href: commonUrls.help, target: '_blank'}, 'Help Center'), '.',
            testId('welcome-text')
          ),
          makeCreateButtons(homeModel),
        ),
      ),
    ];
  }
}

function makeCreateButtons(homeModel: HomeModel) {
  return cssBtnGroup(
    cssBtn(cssBtnIcon('Import'), 'Import Document', testId('intro-import-doc'),
      dom.on('click', () => importDocAndOpen(homeModel)),
    ),
    cssBtn(cssBtnIcon('Page'), 'Create Empty Document', testId('intro-create-doc'),
      dom.on('click', () => createDocAndOpen(homeModel)),
    ),
  );
}

const cssIntroSplit = styled(css.docBlock, `
  display: flex;
  align-items: center;

  @media ${mediaXSmall} {
    & {
      display: block;
    }
  }
`);

const cssIntroLeft = styled('div', `
  flex: 0.4 1 0px;
  overflow: hidden;
  max-height: 150px;
  text-align: center;
  margin: 32px 0;
`);

const cssIntroRight = styled('div', `
  flex: 0.6 1 0px;
  overflow: auto;
  margin-left: 8px;
`);

const cssParagraph = styled(css.docBlock, `
  line-height: 1.6;
`);

const cssBtnGroup = styled('div', `
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  margin-top: -16px;
`);

const cssBtn = styled(bigBasicButton, `
  display: block;
  margin-right: 16px;
  margin-top: 16px;
  text-align: left;
`);

const cssBtnIcon = styled(icon, `
  margin-right: 8px;
`);

// Helper to create an image scaled down to half of its intrinsic size.
// Based on https://stackoverflow.com/a/25026615/328565
const cssIntroImage: DomCreateFunc<HTMLDivElement> =
  (...args) => _cssImageWrap1(_cssImageWrap2(_cssImageScaled(...args)));

const _cssImageWrap1 = styled('div', `width: 200%; margin-left: -50%;`);
const _cssImageWrap2 = styled('div', `display: inline-block;`);
const _cssImageScaled = styled('img', `width: 50%;`);
