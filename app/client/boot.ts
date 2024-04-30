import { AppModel } from 'app/client/models/AppModel';
import { AdminChecks, ProbeDetails } from 'app/client/models/AdminChecks';
import { createAppPage } from 'app/client/ui/createAppPage';
import { pagePanels } from 'app/client/ui/PagePanels';
import { BootProbeInfo, BootProbeResult } from 'app/common/BootProbe';
import { getGristConfig } from 'app/common/urlUtils';
import { Disposable, dom, Observable, styled, UseCBOwner } from 'grainjs';

const cssBody = styled('div', `
  padding: 20px;
  overflow: auto;
`);

const cssHeader = styled('div', `
  padding: 20px;
`);

const cssResult = styled('div', `
  max-width: 500px;
`);

/**
 *
 * A "boot" page for inspecting the state of the Grist installation.
 *
 * TODO: deferring using any localization machinery so as not
 * to have to worry about its failure modes yet, but it should be
 * fine as long as assets served locally are used.
 *
 */
export class Boot extends Disposable {

  private _checks: AdminChecks;

  constructor(_appModel: AppModel) {
    super();
    // Setting title in constructor seems to be how we are doing this,
    // based on other similar pages.
    document.title = 'Booting Grist';
    this._checks = new AdminChecks(this);
  }

  /**
   * Set up the page. Uses the generic Grist layout with an empty
   * side panel, just for convenience. Could be made a lot prettier.
   */
  public buildDom() {
    this._checks.fetchAvailableChecks().catch(e => reportError(e));

    const config = getGristConfig();
    const errMessage = config.errMessage;
    const rootNode = dom('div',
      dom.domComputed(
        use => {
          return pagePanels({
            leftPanel: {
              panelWidth: Observable.create(this, 240),
              panelOpen: Observable.create(this, false),
              hideOpener: true,
              header: null,
              content: null,
            },
            headerMain: cssHeader(dom('h1', 'Grist Boot')),
            contentMain: this.buildBody(use, {errMessage}),
          });
        }
      ),
      );
    return rootNode;
  }

  /**
   * The body of the page is very simple right now, basically a
   * placeholder.  Make a section for each probe, and kick them off in
   * parallel, showing results as they come in.
   */
  public buildBody(use: UseCBOwner, options: {errMessage?: string}) {
    if (options.errMessage) {
      return cssBody(cssResult(this.buildError()));
    }
    return cssBody([
      ...use(this._checks.probes).map(probe => {
        const req = this._checks.requestCheck(probe);
        return cssResult(
          this.buildResult(req.probe, use(req.result), req.details));
      }),
    ]);
  }

  /**
   * This is used when there is an attempt to access the boot page
   * but something isn't right - either the page isn't enabled, or
   * the key in the URL is wrong. Give the user some information about
   * how to set things up.
   */
  public buildError() {
    return dom(
      'div',
      dom('p',
          'A diagnostics page can be made available at:',
          dom('blockquote', '/boot/GRIST_BOOT_KEY'),
          'GRIST_BOOT_KEY is an environment variable ',
          ' set before Grist starts. It should only',
          ' contain characters that are valid in a URL.',
          ' It should be a secret, since no authentication is needed',
          ' to visit the diagnostics page.'),
      dom('p',
          'You are seeing this page because either the key is not set,',
          ' or it is not in the URL.'),
    );
  }

  /**
   * An ugly rendering of information returned by the probe.
   */
  public buildResult(info: BootProbeInfo, result: BootProbeResult,
                     details: ProbeDetails|undefined) {
    const out: (HTMLElement|string|null)[] = [];
    out.push(dom('h2', info.name));
    if (details) {
      out.push(dom('p', '> ', details.info));
    }
    if (result.verdict) {
      out.push(dom('pre', result.verdict));
    }
    if (result.success !== undefined) {
      out.push(result.success ? '✅' : '❌');
    }
    if (result.done === true) {
      out.push(dom('p', 'no fault detected'));
    }
    if (result.details) {
      for (const [key, val] of Object.entries(result.details)) {
        out.push(dom(
          'div',
          cssLabel(key),
          dom('input', dom.prop('value', JSON.stringify(val)))));
      }
    }
    return out;
  }
}

/**
 * Create a stripped down page to show boot information.
 * Make sure the API isn't used since it may well be unreachable
 * due to a misconfiguration, especially in multi-server setups.
 */
createAppPage(appModel => {
  return dom.create(Boot, appModel);
}, {
  useApi: false,
});

export const cssLabel = styled('div', `
  display: inline-block;
  min-width: 100px;
  text-align: right;
  padding-right: 5px;
`);
