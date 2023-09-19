import * as commands from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {getMainOrgUrl} from 'app/client/models/gristUrlState';
import {cssLinkText, cssPageEntryMain, cssPageIcon, cssPageLink} from 'app/client/ui/LeftPanelCommon';
import {YouTubePlayer} from 'app/client/ui/YouTubePlayer';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssModalCloseButton, modal} from 'app/client/ui2018/modals';
import {isFeatureEnabled} from 'app/common/gristUrls';
import {dom, makeTestId, styled} from 'grainjs';

const t = makeT('OpenVideoTour');

const testId = makeTestId('test-video-tour-');

const VIDEO_TOUR_YOUTUBE_EMBED_ID = '56AieR9rpww';

/**
 * Opens a modal containing a video tour of Grist.
 */
 export function openVideoTour(refElement: HTMLElement) {
  return modal(
    (ctl, owner) => {
      const youtubePlayer = YouTubePlayer.create(owner,
        VIDEO_TOUR_YOUTUBE_EMBED_ID,
        {
          onPlayerReady: (player) => player.playVideo(),
          height: '100%',
          width: '100%',
          origin: getMainOrgUrl(),
        },
        cssYouTubePlayer.cls(''),
      );

      owner.onDispose(async () => {
        if (youtubePlayer.isLoading()) { return; }

        logTelemetryEvent('watchedVideoTour', {
          limited: {watchTimeSeconds: Math.floor(youtubePlayer.getCurrentTime())},
        });
      });

      return [
        cssModal.cls(''),
        cssModalCloseButton(
          cssCloseIcon('CrossBig'),
          dom.on('click', () => ctl.close()),
          testId('close'),
        ),
        cssYouTubePlayerContainer(youtubePlayer.buildDom()),
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
    t("Grist Video Tour"),
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
  if (!isFeatureEnabled('helpCenter')) { return null; }

  let iconElement: HTMLElement;

  const commandsGroup = commands.createGroup({
    videoTourToolsOpen: () => openVideoTour(iconElement),
  }, null, true);

  return cssPageEntryMain(
    dom.autoDispose(commandsGroup),
    cssPageLink(
      iconElement = cssPageIcon('Video'),
      cssLinkText(t("Video Tour")),
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

const cssYouTubePlayerContainer = styled('div', `
  position: relative;
  padding-bottom: 56.25%;
  height: 0;
`);

const cssYouTubePlayer = styled('div', `
  position: absolute;
  top: 0;
  left: 0;
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

const cssCloseIcon = styled(icon, `
  padding: 12px;
`);
