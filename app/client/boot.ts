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
  max-width: 500px;
`);

const cssHeader = styled('div', `
  padding: 20px;
`);

/**
 * A "boot" page for inspecting the state of the Grist installation.
 * The page should ideally be visible even if a lot is wrong with the,
 * installation, so avoid introducing dependenceis on middleware, or
 * authentication, or anything else that could break. TODO: there are some
 * configuration problems that currently result in Grist not running
 * at all, ideally they would result in Grist running in a limited
 * mode that is enough to bring up the boot page.
 *
 * TODO: deferring using any internationalization machinery so as not
 * to have to worry about its failure modes yet, but should be
 * straightforward really.
 */
export class Boot extends Disposable {
  public probes: Observable<BootProbeInfo[]>;
  public results: Map<string, Observable<BootProbeResult>>;
  public requests: Map<string, BootProbe>;

  constructor(_appModel: AppModel) {
    super();
    // Setting title in constructor seems to be how we are doing this?
    document.title = 'Booting Grist';
    this.probes = Observable.create(this, []);
    this.results = new Map();
    this.requests = new Map();
  }

  public buildDom() {
    const config = getGristConfig();

    const errMessage = config.errMessage;

    if (!errMessage) {
      // Probe tool URLs are relative to current URL. Don't trust configuration.
      const url = new URL(removeTrailingSlash(document.location.href));
      url.pathname = url.pathname + '/probe';

      fetch(url.href).then(async resp => {
        const _probes = await resp.json();
        this.probes.set(_probes.probes);
      }).catch(e => console.error(e));
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
          // return main;
        }
      ),
      );
    return rootNode;
  }

  public buildBody(use: UseCBOwner, options: {errMessage?: string}) {
    const p = use(this.probes);
    const main = options.errMessage ? this.buildError() : [
      ...p.map(p0 => {
        const {id} = p0;
        let ob = this.results.get(id);
        if (!ob) {
          ob = Observable.create(this, {});
          this.results.set(id, ob);
        }
        let ob2 = this.requests.get(id);
        if (!ob2) {
          ob2 = new BootProbe(id, this);
          this.requests.set(id, ob2);
        }
        ob2.start();
        const result = use(ob);
        const deets = probeDetails[id];
        return this.buildResult(p0, result, deets);
      }),
    ];
    return cssBody(main);
  }

  public buildError() {
    return dom(
      'div',
      'A diagnostics page is available at:',
      dom('blockquote', '/boot/GRIST_BOOT_KEY'),
      'GRIST_BOOT_KEY is an environment variable ',
      ' set before Grist starts. It should only',
      ' contain characters that are valid in a URL.',
      ' It should be a secret, since no authentication is needed',
      ' To visit the diagnostics page.',
    );
  }

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
    let ob = this.boot.results.get(this.id);
    if (!ob) {
      ob = Observable.create(this.boot, {});
      this.boot.results.set(this.id, ob);
    }
  }
}

/**
 * Create a stripped down page to show boot information.
 * Make sure the API isn't used since it may well be broken.
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
interface ProbeDetails {
  info: string;
}

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
