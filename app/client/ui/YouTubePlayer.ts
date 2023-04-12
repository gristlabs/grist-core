import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {waitObs} from 'app/common/gutil';
import {Disposable, dom, DomElementArg} from 'grainjs';
import ko from 'knockout';

export interface Player {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
}

export interface PlayerOptions {
  height?: string;
  width?: string;
  origin?: string;
  playerVars?: PlayerVars;
  onPlayerReady?(player: Player): void
  onPlayerStateChange?(player: Player, event: PlayerStateChangeEvent): void;
}

export interface PlayerVars {
  controls?: 0 | 1;
  disablekb?: 0 | 1;
  fs?: 0 | 1;
  iv_load_policy?: 1 | 3;
  modestbranding?: 0 | 1;
}

export interface PlayerStateChangeEvent {
  data: PlayerState;
}

export enum PlayerState {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  VideoCued = 5,
}

const G = getBrowserGlobals('document', 'window');

/**
 * Wrapper component for the YouTube IFrame Player API.
 *
 * Fetches the JavaScript code for the API if needed, and creates an iframe that
 * points to a YouTube video with the specified id.
 *
 * For more documentation, see https://developers.google.com/youtube/iframe_api_reference.
 */
export class YouTubePlayer extends Disposable {
  private _domArgs: DomElementArg[];
  private _isLoading: ko.Observable<boolean> = ko.observable(true);
  private _playerId = `youtube-player-${this._videoId}`;
  private _player: Player;

  constructor(
    private _videoId: string,
    private _options: PlayerOptions,
    ...domArgs: DomElementArg[]
  ) {
    super();

    this._domArgs = domArgs;

    if (!G.window.YT) {
      const tag = document.createElement('script');

      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);

      G.window.onYouTubeIframeAPIReady = () => this._handleYouTubeIframeAPIReady();
    } else {
      setTimeout(() => this._handleYouTubeIframeAPIReady(), 0);
    }
  }

  public isLoading() {
    return this._isLoading();
  }

  public isLoaded() {
    return waitObs(this._isLoading, (val) => !val);
  }

  public play() {
    this._player.playVideo();
  }

  public setVolume(volume: number) {
    this._player.setVolume(volume);
  }

  public getCurrentTime(): number {
    return this._player.getCurrentTime();
  }

  public buildDom() {
    return dom('div', {id: this._playerId}, ...this._domArgs);
  }

  private _handleYouTubeIframeAPIReady() {
    const {onPlayerReady, onPlayerStateChange, playerVars, ...otherOptions} = this._options;
    this._player = new G.window.YT.Player(this._playerId, {
      videoId: this._videoId,
      playerVars,
      events: {
        onReady: () => {
          this._isLoading(false);
          onPlayerReady?.(this._player);
        },
        onStateChange: (event: PlayerStateChangeEvent) =>
          onPlayerStateChange?.(this._player, event),
      },
      ...otherOptions,
    });
  }
}
