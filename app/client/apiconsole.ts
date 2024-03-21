import {loadCssFile, loadScript} from 'app/client/lib/loadScript';
import type {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {reportError} from 'app/client/models/errors';
import {createAppPage} from 'app/client/ui/createAppPage';
import {DocAPIImpl} from 'app/common/UserAPI';
import type {RecordWithStringId} from 'app/plugin/DocApiTypes';
import {dom, styled} from 'grainjs';
import type SwaggerUI from 'swagger-ui';

/**
 * This loads the swagger resources as if included as separate <script> and <link> tags in <head>.
 *
 * Swagger suggests building via webpack (in which case, it would be included into our JS bundle),
 * but I couldn't get past webpack errors (also it's unclear if that would be any better).
 * We load dynamically only to avoid maintaining a separate html file ust for these tags.
 */
function loadExternal() {
  return Promise.all([
    loadScript('swagger-ui-bundle.js'),
    loadCssFile('swagger-ui.css'),
    // Stylesheet that's only applied when prefers-color-scheme is dark.
    loadCssFile('swagger-ui-dark.css'),
  ]);
}

// Start loading scripts early (before waiting for AppModel to get initialized).
const externalScriptsPromise = loadExternal();

let swaggerUI: SwaggerUI|null = null;

// Define a few types to allow for type-checking.

type ParamValue = string|number|null;

interface Example {
  value: ParamValue;
  summary: string;
}

interface JsonSpec {
  [propName: string]: any;
}
interface SpecActions {
  changeParamByIdentity(...args: unknown[]): unknown;
  updateJsonSpec(spec: JsonSpec): unknown;
}


function applySpecActions(cb: (specActions: SpecActions, jsonSpec: JsonSpec) => void) {
  // Don't call actions directly within `wrapActions`, react/redux doesn't like it.
  setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const system = (swaggerUI as any).getSystem();
    const jsonSpec = system.getState().getIn(["spec", "json"]);
    cb(system.specActions, jsonSpec);
  }, 0);
}

function updateSpec(cb: (spec: JsonSpec) => JsonSpec) {
  applySpecActions((specActions: SpecActions, jsonSpec: JsonSpec) => {
    // `jsonSpec` is a special immutable object with methods like `getIn/setIn`.
    // `updateJsonSpec` expects a plain JS object, so we need to convert it.
    specActions.updateJsonSpec(cb(jsonSpec).toJSON());
  });
}

const searchParams = new URL(location.href).searchParams;

function setExamples(examplesArr: Example[], paramName: string) {
  examplesArr.sort((a, b) => String(a.summary || a.value).localeCompare(String(b.summary || b.value)));

  const paramValue = searchParams.get(paramName);
  let haveCurrentValue = false;
  if (paramValue) {
    // If this value appears among examples, move it to the front and label it as "Current".
    const index = examplesArr.findIndex(v => (String(v.value) == String(paramValue)));
    if (index >= 0) {
      const ex = examplesArr.splice(index, 1)[0];
      ex.summary += " (Current)";
      examplesArr.unshift(ex);
      haveCurrentValue = true;
    }
  }
  if (!haveCurrentValue) {
    // When opening an endpoint, parameters with examples are immediately set to the first example.
    // For documents and tables, this would immediately call our custom code,
    // fetching lists of tables/columns. This is especially bad for documents,
    // as the document may have to be loaded from scratch in the doc worker.
    // So the dropdown has to start with an empty value in those cases.
    // You'd think this would run into the check for `!value` in `changeParamByIdentity`,
    // but apparently swagger has its own special handing for empty values before then.
    examplesArr.unshift({value: "", summary: "Select..."});
  }

  // Swagger expects `examples` to be an object, not an array.
  // Prefix keys with something to ensure they aren't viewed as numbers: JS objects will iterate
  // them in insertion (what we want) order *unless* keys look numeric. SwaggerUI will use the
  // value from ex.value, so luckily this prefix doesn't actually matter.
  const examples = Object.fromEntries(examplesArr.map((ex) => ["#" + ex.value, ex]));
  updateSpec(spec => {
    return spec.setIn(["components", "parameters", `${paramName}PathParam`, "examples"], examples);
  });
}

// Set the value of a parameter in all endpoints.
function setParamValue(resolvedParam: any, value: ParamValue) {
  applySpecActions((specActions: SpecActions, spec: JsonSpec) => {
    // This will be something like:
    // "https://url-to-grist.yml#/components/parameters/orgIdPathParam"
    // Note that we're assuming that the endpoint always uses `$ref` to define the parameter,
    // rather than defining it inline.
    // https://github.com/gristlabs/grist-help/pull/293 ensures this,
    // but future changes to the spec must remember to do the same.
    const ref = resolvedParam.get("$$ref");

    // For every endpoint in the spec...
    for (const [pathKey, path] of spec.get("paths").entries()) {
      for (const [method, operation] of path.entries()) {

        const parameters = operation.get("parameters");
        if (!parameters) { continue; }
        for (const param of parameters.values()) {
          // If this is the same parameter...
          if (ref.endsWith(param.get("$ref"))) {
            // Set the value. The final `true` is `noWrap` to prevent infinite recursion.
            specActions.changeParamByIdentity([pathKey, method], resolvedParam, value, false, true);
          }
        }
      }
    }
  });
}

class ExtendedDocAPIImpl extends DocAPIImpl {
  public listTables(): Promise<{tables: RecordWithStringId[]}> {
    return this.requestJson(`${this.getBaseUrl()}/tables`);
  }
  public listColumns(tableId: string, includeHidden = false): Promise<{columns: RecordWithStringId[]}> {
    return this.requestJson(`${this.getBaseUrl()}/tables/${tableId}/columns?hidden=${includeHidden ? 1 : 0}`);
  }
}

function wrapChangeParamByIdentity(appModel: AppModel, system: any, oriAction: any, ...args: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [keyPath, param, value, _isXml, noWrap] = args;
  if (noWrap || !value) {
    // `noWrap` is our own flag to avoid infinite recursion.
    // It's set when calling this action inside `setParamValue` below.
    // `value` is falsy when choosing our default "Select..." option from a dropdown.
    return oriAction(...args);
  }

  const paramName = param.get("name");

  // These are the path parameters that we handle specially and provide examples for.
  // When a value is selected in one endpoint, set the same value in all other endpoints.
  // This makes a bit more convenient to do multiple different operations on the same object.
  // But maybe it'll cause confusion/mistakes when operating on different objects?
  if (["orgId", "workspaceId", "docId", "tableId", "colId"].includes(paramName)) {
    setParamValue(param, value);
  }

  // When a docId is selected, fetch the list of that doc's tables and set examples for tableId.
  // This is a significant convenience, but it causes some UI jankiness.
  // Updating the spec with these examples takes some CPU and the UI freezes for a moment.
  // Then things jump around a bit as stuff is re-rendered, although it ends up in the right place
  // so it shouldn't be too disruptive.
  // All this happens after a short delay while the tables are being fetched.
  // It *might* be possible to set these example values more efficiently/lazily but I'm not sure,
  // and it'll probably significantly more difficult.
  const baseUrl = appModel.api.getBaseUrl();
  if (paramName === "docId") {
    const docAPI = new ExtendedDocAPIImpl(baseUrl, value);
    docAPI.listTables().then(({tables}: {tables: RecordWithStringId[]}) => {
      const examples: Example[] = tables.map(table => ({value: table.id, summary: table.id}));
      setExamples(examples, "tableId");
    })
    .catch(reportError);
  }

  // When a tableId is selected, fetch the list of columns and set examples for colId.
  // This causes similar UI jankiness as above, but I think less severely since fewer endpoints
  // have a colId parameter. In fact, there's currently only one: `DELETE /columns`.
  // We *could* only do this when setting tableId within that endpoint,
  // but then the dropdown will be missing if you set the tableId elsewhere and then open this endpoint.
  // Alternatively, `GET /tables` could be modified to return column metadata for each table.
  if (paramName === "tableId") {
    // When getting tables after setting docId, `value` is the docId so we have all the info.
    // Here `value` is the tableId and we need to get the docId separately.
    const parameters = system.getState().getIn(["spec", "meta", "paths", ...keyPath, "parameters"]);
    const docId = parameters.find((_value: any, key: any) => key.startsWith("path.docId"))?.get("value");
    if (docId) {
      const docAPI = new ExtendedDocAPIImpl(baseUrl, docId);
      // Second argument of `true` includes hidden columns like gristHelper_Display and manualSort.
      docAPI.listColumns(value, true)
      .then(({columns}: {columns: RecordWithStringId[]}) => {
        const examples = columns.map(col => ({value: col.id, summary: col.fields.label as string}));
        setExamples(examples, "colId");
      })
      .catch(reportError);
    }
  }
  return oriAction(...args);
}

function gristPlugin(appModel: AppModel, system: any) {
  return {
    statePlugins: {
      spec: {
        wrapActions: {
          // Customize what happens when a parameter is changed, e.g. selected from a dropdown.
          changeParamByIdentity: (oriAction: any) => (...args: any[]) =>
            wrapChangeParamByIdentity(appModel, system, oriAction, ...args),
        }
      }
    }
  };
}

function initialize(appModel: AppModel) {
  // These are used to set the examples for orgs, workspaces, and docs.
  const orgsPromise = appModel.api.getOrgs();

  // We make a request for each org - hopefully there aren't too many.
  // Currently I only see rate limiting in DocApi, which shouldn't be a problem here.
  // Fortunately we don't need a request for each workspace,
  // since listing workspaces in an org also lists the docs in each workspace.
  const workspacesPromise = orgsPromise.then(orgs => Promise.all(orgs.map(org =>
    appModel.api.getOrgWorkspaces(org.id, false).then(workspaces => ({org, workspaces}))
  )));

  // To be called after the spec is downloaded and parsed.
  function onComplete() {
    // Add an instruction for where to get API key.
    const description = document.querySelector('.information-container .info');
    if (description) {
      const href = urlState().makeUrl({account: 'account'});
      dom.update(description, dom('div', 'Find or create your API key at ', dom('a', {href}, href), '.'));
    }

    updateSpec(spec => {
      // The actual spec sets the server to `https://{subdomain}.getgrist.com/api`,
      // where {subdomain} is a variable that defaults to `docs`.
      // We want to use the same server as the page is loaded from.
      // This simplifies the UI and makes it work e.g. on localhost.
      spec = spec.set("servers", [{url: window.origin + "/api"}]);

      // Some table-specific parameters have examples with fake data in grist.yml. We don't want
      // to actually use this for running requests, so clear those out.
      for (const paramName of [
        'filterQueryParam', 'sortQueryParam', 'sortHeaderParam',
        'limitQueryParam', 'limitHeaderParam'
      ]) {
        spec = spec.removeIn(["components", "parameters", paramName, "example"]);
      }
      return spec;
    });

    // Show that we need a key, but let's not display it. The user may or may not have the API key
    // set. Actual requests from the console use cookies, so can work anyway. When the key is set,
    // showing it in cleartext makes it riskier to ask for help with screenshots and the like.
    // We set a fake key anyway to be clear that it's needed in the curl command.
    const key = 'XXXXXXXXXXX';
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    swaggerUI!.preauthorizeApiKey('ApiKey', key);

    // Set examples for orgs, workspaces, and docs.
    orgsPromise.then(orgs => {
      const examples: Example[] = orgs.map(org => ({
        value: org.domain,
        summary: org.name,
      }));
      setExamples(examples, "orgId");
    }).catch(reportError);

    workspacesPromise.then(orgs => {
      const workSpaceExamples: Example[] = orgs.flatMap(({org, workspaces}) => workspaces.map(ws => ({
        value: ws.id,
        summary: `${org.name} » ${ws.name}`
      })));
      setExamples(workSpaceExamples, "workspaceId");

      const docExamples = orgs.flatMap(({org, workspaces}) => workspaces.flatMap(ws => ws.docs.map(doc => ({
        value: doc.id,
        summary: `${org.name} » ${ws.name} » ${doc.name}`
      }))));
      setExamples(docExamples, "docId");
    }).catch(reportError);
  }
  return onComplete;
}

function requestInterceptor(request: SwaggerUI.Request) {
  delete request.headers.Authorization;
  return request;
}

createAppPage((appModel) => {
  // Default Grist page prevents scrolling unnecessarily.
  document.documentElement.style.overflow = 'initial';

  const rootNode = cssWrapper();
  const onComplete = initialize(appModel);

  externalScriptsPromise.then(() => {
    const buildSwaggerUI: typeof SwaggerUI = (window as any).SwaggerUIBundle;
    swaggerUI = buildSwaggerUI({
      filter: true,
      plugins: [gristPlugin.bind(null, appModel)],
      url: 'https://raw.githubusercontent.com/gristlabs/grist-help/master/api/grist.yml',
      domNode: rootNode,
      showMutatedRequest: false,
      requestInterceptor,
      onComplete,
    });
  })
  .catch(reportError);

  return rootNode;
});

const cssWrapper = styled('div', `
  & .scheme-container {
    display: none;
  }
  & .information-container h1 {   /* Authorization header, strangely enough */
    display: none;
  }
  & .information-container .info {
    margin-bottom: 0;
  }
`);
