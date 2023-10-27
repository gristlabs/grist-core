/**
 * This file defines the interface for a plugin manifest.
 *
 * Note that it is possible to validate a manifest against a TypeScript interface as follows:
 * (1) Convert the interface to a JSON schema at build time using
 *     https://www.npmjs.com/package/typescript-json-schema:
 *     bin/typescript-json-schema --required --noExtraProps PluginManifest.ts PublishedPlugin
 * (2) Use a JSON schema validator like https://www.npmjs.com/package/ajv to validate manifests
 *     read at run-time and produce informative errors automatically.
 *
 * TODO [Proposal]: To save an ImportSource for reuse, we would save:
 *  {
 *    pluginId: string;
 *    importSource: ImportSource;
 *    importProcessor?: Implementation;
 *    parseOptions?: ParseOptions;        // If importProcessor is omitted and fileParser is used.
 *  }
 * This should suffice for database re-imports, as well as for re-imports from a URL, or from a
 * saved path in the filesystem (which can be a builtIn plugin available for Electron version).
 */

/**
 * PublishedPlugin is a BarePlugin with additional attributes to identify and describe a plugin
 * for publishing.
 */
export interface PublishedPlugin extends BarePlugin {
  name: string;
  version: string;
}


/**
 * BarePlugin defines the functionality of a plugin. It is the only part required for a plugin to
 * function, and is implemented by built-in plugins, published plugins, and private plugins (such
 * as those being developed).
 */
export interface BarePlugin {
  /**
   * An optional human-readable name.
   */
  name?: string;

  /**
   * Components describe how the plugin runs. A plugin may provide UI and behavior that runs in
   * the browser, Python code that runs in a secure sandbox, and arbitrary code that runs in Node.
   */
  components: {
    /**
     * Relative path to the directory whose content will be served to the browser. Required for
     * those plugins that need to render their own HTML or run in-browser Javascript. This
     * directory should contain all html files referenced in the manifest.
     *
     * It is "safe" in that Grist offers protections that allow such plugins to be marked "safe".
     */
    safeBrowser?: string;

    /**
     * Relative path to a file with Python code that will be run in a python sandbox. This
     * file is started on plugin activation, and should register any implemented APIs.
     * Required for plugins that do Python processing.
     *
     * It is "safe" in that Grist offers protections that allow such plugins to be marked "safe".
     */
    safePython?: string;

    /**
     * Relative path to a file containing Javascript code that will be executed with Node.js.
     * The code is called on plugin activation, and should register any implemented APIs
     * once we've figured out how that should happen (TODO).  Required for plugins that need
     * to do any "unsafe" work, such as accessing the local filesystem or starting helper
     * programs.
     *
     * It is "unsafe" in that it can do too much, and Grist marks such plugins as "unsafe".
     *
     * An unsafeNode component opens as separate process to run plugin node code, with the
     * NODE_PATH set to the plugin directory.  The node code can execute arbitrary actions -
     * there is no sandboxing.
     *
     * The node child may communicate with the server via standard ChildProcess ipc
     * (`process.send`, `process.on('message', ...)`).  The child is expected to
     * `process.send` a message to the server once it is listening to the `message`
     * event.  That message is expected to contain a `ready` field set to `true`.  All
     * other communication should follow the protocol implemented by the Rpc module.
     * TODO: provide plugin authors with documentation + library to use that implements
     * these requirements.
     *
     */
    unsafeNode?: string;

    /**
     * Relative path to a specialized manifest of custom widgets.
     * I'm unsure how this fits into components and contributions,
     * this seemed the least-worst spot for it.
     */
    widgets?: string;

    /**
     * Options for when to deactivate the plugin, i.e. when to stop any plugin processes. (Note
     * that we may in the future also add options for when to activate the plugin, which is for
     * now automatic and not configurable.)
     */
    deactivate?: {
      // Deactivate after this many seconds of inactivity. Defaults to 300 (5 minutes) if omitted.
      inactivitySec?: number;
    }
  };

  /**
   * Contributions describe what new functionality the plugin contributes to the Grist
   * application. See documentation for individual contribution types for details. Any plugin may
   * provide multiple contributions. It is common to provide just one, in which case include a
   * single property with a single-element array.
   */
  contributions: {
    importSources?: ImportSource[];
    fileParsers?: FileParser[];
    customSections?: CustomSection[];
  };

  /**
   * Experimental plugins run only if the environment variable GRIST_EXPERIMENTAL_PLUGINS is
   * set. Otherwise they are ignored. This is useful for plugins that needs a bit of experimentation
   * before being pushed to production (ie: production does not have GRIST_EXPERIMENTAL_PLUGINS set
   * but staging does). Keep in mind that developers need to set this environment if they want to
   * run them locally.
   */
  experimental?: boolean;
}

/**
 * An ImportSource plugin creates a new source of imports, such as an external API, a file-sharing
 * service, or a new type of database. It adds a new item for the user to select when importing.
 */
export interface ImportSource {
  /**
   * Label shows up as a new item for the user to select when starting an import.
   */
  label: string;

  /**
   * Whether this import source can be exposed on a home screen for all users. Home imports
   * support only a safeBrowser component and have no access to current document. Primarily used as
   * an external/cloud storage providers.
   */
  safeHome?: boolean;

  /**
   * Implementation of ImportSourceAPI. Supports safeBrowser component, which allows you to create
   * custom UI to show to the user. Or describe UI using a .json or .yml config file and use
   * {component: "builtIn", name: "importSourceConfig", path: "your-config"}.
   */
  importSource: Implementation;

  /**
   * Implementation of ImportProcessorAPI. It receives the output of importSource, and produces
   * Grist data. If omitted, uses the default ImportProcessor, which is equivalent to
   * {component: "builtIn", name: "fileParser"}.
   *
   * The default ImportProcessor handles received ImportSourceItems as follows:
   *    (1) items of type "file" are saved to temp files.
   *    (2) items of type "url" are downloaded to temp files.
   *    (3) calls ParseFileAPI.parseFile() with all temp files, to produce Grist tables
   *    (4) returns those Grist tables along with all items of type "table".
   * Note that the default ImportParser ignores ImportSource items of type "custom".
   */
  importProcessor?: Implementation;

}

/**
 * A FileParser plugin adds support to parse a new type of file data, such as "csv", "yml", or
 * "ods". It then enables importing the new type of file via upload or from any other ImportSource
 * that produces Files or URLs.
 */
export interface FileParser {
  /**
   * File extensions for which this FileParser should be considered, e.g. "csv", "yml". You may
   * use "" for files with no extensions, and "*" to match any extension.
   */
  fileExtensions: string[];

  /**
   * Implementation of EditOptionsAPI. Supports safeBrowser component, which allows you to create
   * custom UI to show to the user. Or describe UI using a .json or .yml config file and use
   * {component: "builtIn", name: "parseOptionsConfig", path: "your-config"}.
   *
   * If omitted, the user will be shown no parse options.
   */
  editOptions?: Implementation;

  /**
   * Implementation of ParseFileAPI, which converts Files to Grist data using parse options.
   */
  parseFile: Implementation;
}

/**
 * A CustomSection plugin adds support to add new types of section to Grist, such as a calendar,
 * maps, data visualizations.
 */
export interface CustomSection {
  /**
   * Path to an html file.
   */
  path: string;
  /**
   * The name should uniquely identify the section in the plugin.
   */
  name: string;
}

/**
 * A Plugin supplies one or more Implementation of some APIs. Components register implementation
 * using a call such as:
 *    grist.register(SomeAPI, 'myName', impl).
 * The manifest documentation describes which API must be implemented at any particular point, and
 * it is the plugin's responsibility to register an implementation of the correct API and refer to
 * it by Implementation.name.
 */
export interface Implementation  {
  /**
   * Which component of the plugin provides this implementation.
   */
  component: "safeBrowser" | "safePython" | "unsafeNode";

  /**
   * The name of the implementation registered by the chosen component. The same component can
   * register any number of APIs at any names.
   */
  name: string;

  /**
   * Path is used by safeBrowser component for which page to load. Defaults to 'index.html'.
   * It is also used by certain builtIn implementation, e.g. if name is 'parse-options-config',
   * path is the path to JSON or YAML file containing the configuration.
   */
  path?: string;
}
