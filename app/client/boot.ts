import { AppModel } from 'app/client/models/AppModel';
import { createAppPage } from 'app/client/ui/createAppPage';
import { pagePanels } from 'app/client/ui/PagePanels';
import { BootProbeInfo, BootProbeResult } from 'app/common/BootProbe';
import { removeTrailingSlash } from 'app/common/gutil';
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

  // The back end will offer a set of probes (diagnostics) we
  // can use. Probes have unique IDs.
  public probes: Observable<BootProbeInfo[]>;

  // Keep track of probe results we have received, by probe ID.
  public results: Map<string, Observable<BootProbeResult>>;

  // Keep track of probe requests we are making, by probe ID.
  public requests: Map<string, BootProbe>;

  constructor(_appModel: AppModel) {
    super();
    // Setting title in constructor seems to be how we are doing this,
    // based on other similar pages.
    document.title = 'Booting Grist';
    this.probes = Observable.create(this, []);
    this.results = new Map();
    this.requests = new Map();
  }

  /**
   * Set up the page. Uses the generic Grist layout with an empty
   * side panel, just for convenience. Could be made a lot prettier.
   */
  public buildDom() {
    const config = getGristConfig();
    const errMessage = config.errMessage;
    if (!errMessage) {
      // Probe tool URLs are relative to the current URL. Don't trust configuration,
      // because it may be buggy if the user is here looking at the boot page
      // to figure out some problem.
      const url = new URL(removeTrailingSlash(document.location.href));
      url.pathname += '/probe';
      fetch(url.href).then(async resp => {
        const _probes = await resp.json();
        this.probes.set(_probes.probes);
      }).catch(e => reportError(e));
    }

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
      ...use(this.probes).map(probe => {
        const {id} = probe;
        let result = this.results.get(id);
        if (!result) {
          result = Observable.create(this, {});
          this.results.set(id, result);
        }
        let request = this.requests.get(id);
        if (!request) {
          request = new BootProbe(id, this);
          this.requests.set(id, request);
        }
        request.start();
        return cssResult(
          this.buildResult(probe, use(result), probeDetails[id]));
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
          key,
          dom('input', dom.prop('value', JSON.stringify(val)))));
      }
    }
    return out;
  }
}

/**
 * Represents a single diagnostic.
 */
export class BootProbe {
  constructor(public id: string, public boot: Boot) {
    const url = new URL(removeTrailingSlash(document.location.href));
    url.pathname = url.pathname + '/probe/' + id;
    fetch(url.href).then(async resp => {
      const _probes: BootProbeResult = await resp.json();
      const ob = boot.results.get(id);
      if (ob) {
        ob.set(_probes);
      }
    }).catch(e => console.error(e));
  }

  public start() {
    let result = this.boot.results.get(this.id);
    if (!result) {
      result = Observable.create(this.boot, {});
      this.boot.results.set(this.id, result);
    }
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

/**
 * Basic information about diagnostics is kept on the server,
 * but it can be useful to show extra details and tips in the
 * client.
 */
const probeDetails: Record<string, ProbeDetails> = {
  'boot-page': {
    info: `
This boot page should not be too easy to access. Either turn
it off when configuration is ok (by unsetting GRIST_BOOT_KEY)
or make GRIST_BOOT_KEY long and cryptographically secure.
`,
  },

  'health-check': {
    info: `
Grist has a small built-in health check often used when running
it as a container.
`,
  },

  'host-header': {
    info: `
Requests arriving to Grist should have an accurate Host
header. This is essential when GRIST_SERVE_SAME_ORIGIN
is set.
`,
  },

  'system-user': {
    info: `
It is good practice not to run Grist as the root user.
`,
  },

  'reachable': {
    info: `
The main page of Grist should be available.
`
  },
};

/**
 * Information about the probe.
 */
interface ProbeDetails {
  info: string;
}

