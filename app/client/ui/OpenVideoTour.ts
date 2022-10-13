import * as commands from 'app/client/components/commands';
import {t} from 'app/client/lib/localization';
import {cssLinkText, cssPageEntryMain, cssPageIcon, cssPageLink} from 'app/client/ui/LeftPanelCommon';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {modal} from 'app/client/ui2018/modals';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {dom, makeTestId, styled} from 'grainjs';

const translate = (x: string, args?: any): string => t(`OpenVideoTour.${x}`, args);

const testId = makeTestId('test-video-tour-');

/**
 * Opens a modal containing a video tour of Grist.
 */
 export function openVideoTour(refElement: HTMLElement) {
  return modal(
    (ctl) => {
      return [
        cssModal.cls(''),
        cssCloseButton(
          cssCloseIcon('CrossBig'),
          dom.on('click', () => ctl.close()),
          testId('close'),
        ),
        cssVideoWrap(
          cssVideo(
            {
              src: commonUrls.videoTour,
              title: translate('YouTubeVideoPlayer'),
              frameborder: '0',
              allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
              allowfullscreen: '',
            },
          ),
        ),
        testId('modal'),
      ];
    },
    {
      refElement,
      variant: 'collapsing',
    }
  );
}

/**
 * Creates a text button that shows the video tour on click.
 */
export function createVideoTourTextButton(): HTMLDivElement {
  const elem: HTMLDivElement = cssVideoTourTextButton(
    cssVideoIcon('Video'),
    translate('GristVideoTour'),
    dom.on('click', () => openVideoTour(elem)),
    testId('text-button'),
  );

  return elem;
}

/**
 * Creates the "Video Tour" button for the "Tools" section of the left panel.
 *
 * Shows the video tour on click.
 */
export function createVideoTourToolsButton(): HTMLDivElement | null {
  if (shouldHideUiElement('helpCenter')) { return null; }

  let iconElement: HTMLElement;

  const commandsGroup = commands.createGroup({
    videoTourToolsOpen: () => openVideoTour(iconElement),
  }, null, true);

  return cssPageEntryMain(
    dom.autoDispose(commandsGroup),
    cssPageLink(
      iconElement = cssPageIcon('Video'),
      cssLinkText(translate('VideoTour')),
      dom.cls('tour-help-center'),
      dom.on('click', () => openVideoTour(iconElement)),
      testId('tools-button'),
    ),
  );
}

const cssModal = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  width: 100%;
  max-width: 864px;
`);

const cssVideoWrap = styled('div', `
  position: relative;
  padding-bottom: 56.25%;
  height: 0;
`);

const cssVideo = styled('iframe', `
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`);

const cssVideoTourTextButton = styled('div', `
  color: ${theme.controlFg};
  cursor: pointer;

  &:hover {
    color: ${theme.controlHoverFg};
  }
`);

const cssVideoIcon = styled(icon, `
  background-color: ${theme.controlFg};
  cursor: pointer;
  margin: 0px 4px 3px 0;

  .${cssVideoTourTextButton.className}:hover > & {
    background-color: ${theme.controlHoverFg};
  }
`);

const cssCloseButton = styled('div', `
  align-self: flex-end;
  margin: -8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.modalCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssCloseIcon = styled(icon, `
  padding: 12px;
`);
