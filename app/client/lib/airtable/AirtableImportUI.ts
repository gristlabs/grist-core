import {
  AirtableImportResult,
  applyAirtableImportSchemaAndImportData,
  validateAirtableSchemaImport,
} from "app/client/lib/airtable/AirtableImporter";
import { makeT } from "app/client/lib/localization";
import { markdown } from "app/client/lib/markdown";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { cssWell, cssWellContent, cssWellTitle } from "app/client/ui/AdminPanelCss";
import { cssCodeBlock } from "app/client/ui/CodeHighlight";
import { textInput } from "app/client/ui/inputs";
import { shadowScroll } from "app/client/ui/shadowScroll";
import { hoverTooltip } from "app/client/ui/tooltips";
import { bigBasicButton, bigPrimaryButton, textButton } from "app/client/ui2018/buttons";
import { cssLabelText, cssRadioCheckboxOptions, radioCheckboxOption } from "app/client/ui2018/checkbox";
import { isNarrowScreenObs, mediaSmall, testId, theme } from "app/client/ui2018/cssVars";
import { cssIconButton, icon } from "app/client/ui2018/icons";
import { cssNestedLinks } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import {
  menu,
  menuDivider,
  menuIcon,
  menuItem,
  menuSubHeader,
  menuText,
  selectMenu,
  selectOption,
} from "app/client/ui2018/menus";
import { cssModalBody, cssModalButtons } from "app/client/ui2018/modals";
import { AirtableAPI } from "app/common/airtable/AirtableAPI";
import { AirtableBaseSchema } from "app/common/airtable/AirtableAPITypes";
import { AirtableImportProgress } from "app/common/airtable/AirtableDataImporterTypes";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableSchemaImporter";
import { BaseAPI } from "app/common/BaseAPI";
import { DocSchemaImportWarning, ImportSchemaTransformParams } from "app/common/DocSchemaImport";
import { ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { components, tokens } from "app/common/ThemePrefs";
import { addCurrentOrgToPath } from "app/common/urlUtils";
import { UserAPI } from "app/common/UserAPI";
import { MaybePromise } from "app/plugin/gutil";

import { Computed, Disposable, dom, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";

const t = makeT("AirtableImport");

interface AirtableBase {
  id: string;                    // Base ID (e.g., "appXXXXXXXXXXXXXX")
  name: string;                  // Base name
  permissionLevel: string;       // Permission level (e.g., "owner", "create", "edit", "comment", "read", "none")
}

interface AirtableToGristMapping {
  tableId: string;
  tableName: string;
  destination: Observable<NewTable | ExistingTable | null>;
}

interface NewTable {
  type: "new-table";
  structureOnly: boolean;
}

interface ExistingTable {
  type: "existing-table";
  tableId: string;
}

interface TokenPayload {
  access_token?: string;
  expires_at?: number;
  error?: string;
};

export interface AirtableImportOptions {
  api: UserAPI;
  existingDocId?: string;
  existingDocSchema?: Computed<ExistingDocSchema>;
  onSuccess(result: AirtableImportResult): MaybePromise<void>;
  onError(error: unknown): void;
  onCancel(): void;
}

export class AirtableImport extends Disposable {
  // Check for a base URL override, for use in tests.
  public static AIRTABLE_API_BASE = (window as any).testAirtableImportBaseUrlOverride ||
    "https://api.airtable.com/v0";

  private _authMethod = Observable.create<"oauth" | "pat" | null>(this, null);
  private _isOAuthConfigured = Observable.create<boolean | null>(this, null);
  private _showPATInput = Observable.create(this, false);
  private _patToken = Observable.create(this, "");
  private _accessToken = Observable.create<string | null>(this, null);
  private _bases = Observable.create<AirtableBase[]>(this, []);
  private _loadingToken = Observable.create(this, false);
  private _loadingBases = Observable.create(this, false);
  private _base = Observable.create<AirtableBase | null>(this, null);
  private _baseSchema = Observable.create<AirtableBaseSchema | null>(this, null);
  private _loadingBaseSchema = Observable.create(this, false);
  private _importing = Observable.create(this, false);
  private _error = Observable.create<string | null>(this, null);
  private _oauth2ClientsApi = new OAuth2ClientsAPI();
  private _existingDocId = this._options.existingDocId;
  private _existingDocSchema = this._options.existingDocSchema;

  private _existingTables = Computed.create(this, (use) => {
    const existingDocSchema = this._existingDocSchema ? use(this._existingDocSchema) : null;
    return existingDocSchema ? existingDocSchema.tables : [];
  });

  private _existingTablesById = Computed.create(this, (use) => {
    const existingTables = use(this._existingTables);
    return new Map(existingTables.map(t => [t.id, t]));
  });

  private _tableMappings = Observable.create<AirtableToGristMapping[]>(this, []);

  private _skipTableIds = Computed.create(this, (use) => {
    const mappings = use(this._tableMappings);
    return mappings.filter(m => !use(m.destination)).map(d => d.tableId);
  });

  private _mapExistingTableIds = Computed.create(this, (use) => {
    const existingTablesById = use(this._existingTablesById);
    const mappings = use(this._tableMappings);
    const existingTableMappings = mappings.filter((m) => {
      const d = use(m.destination);
      return d?.type === "existing-table" && existingTablesById?.has(d.tableId);
    });

    return new Map(existingTableMappings.map((m) => {
      const d = use(m.destination) as ExistingTable;
      return [m.tableId, d.tableId];
    }));
  });

  private _newTables = Computed.create(this, (use) => {
    const mappings = use(this._tableMappings);
    return mappings.filter(m => use(m.destination)?.type === "new-table");
  });

  private _structureOnlyTableIds = Computed.create(this, (use) => {
    const newTables = use(this._newTables);
    return newTables.filter(m => (use(m.destination) as NewTable).structureOnly).map(m => m.tableId);
  });

  private _importTablesCount = Computed.create(this, (use) => {
    const existingTablesCount = use(this._mapExistingTableIds).size;
    const newTablesCount = use(this._newTables).length;
    return existingTablesCount + newTablesCount;
  });

  private _warningsByTableId = Computed.create(this, (use) => {
    const warningsByTableId = new Map<string, DocSchemaImportWarning[]>();

    const baseSchema = use(this._baseSchema);
    if (!baseSchema) { return warningsByTableId; }

    const existingDocSchema = this._existingDocSchema ? use(this._existingDocSchema) : undefined;

    const skipTableIds = use(this._skipTableIds);
    const mapExistingTableIds = use(this._mapExistingTableIds);
    const transformations: ImportSchemaTransformParams = {
      skipTableIds,
      mapExistingTableIds,
    };

    const warnings = validateAirtableSchemaImport(baseSchema, existingDocSchema, transformations);

    for (const warning of warnings) {
      const tableId = warning.ref?.originalTableId;
      if (tableId) {
        const tableWarnings = warningsByTableId.get(tableId) || [];
        tableWarnings.push(warning);
        warningsByTableId.set(tableId, tableWarnings);
      }
    }

    return warningsByTableId;
  });

  private _importProgress: Observable<AirtableImportProgress> =  Observable.create(this, { percent: 0 });

  private _api = this._options.api;

  private _onSuccess = this._options.onSuccess.bind(this);

  private _onError = this._options.onError.bind(this);

  private _onCancel = this._options.onCancel.bind(this);

  constructor(private _options: AirtableImportOptions) {
    super();
    this._checkForToken();
  }

  public buildDom() {
    return dom.domComputed((use) => {
      if (use(this._base)) {
        return dom.create(this._baseTablesList.bind(this));
      } else if (use(this._accessToken)) {
        return dom.create(this._basesList.bind(this));
      } else {
        return this._authDialog();
      }
    });
  }

  // Auth Dialog Component
  private _authDialog() {
    return cssNestedLinks(cssMainContent(
      dom("div", t("Connect your Airtable account to access your bases.")),

      dom.maybe(this._error, err => cssError(err)),

      dom.maybe(use => use(this._isOAuthConfigured) === false && !use(this._showPATInput), () =>
        cssWarning(
          cssWellTitle(t("Grist configuration required")),
          cssWellContent(t(`OAuth credentials not configured. Please set OAUTH_CLIENT_ID and \
OAUTH_CLIENT_SECRET, or use Personal Access Token.`)),
        ),
      ),

      dom.domComputed(this._showPATInput, (showPAT) => {
        if (!showPAT) {
          return [
            bigPrimaryButton(
              dom.text(use => use(this._loadingToken) ? t("Connecting...") : t("Connect with Airtable")),
              dom.prop("disabled", use => !use(this._isOAuthConfigured) || use(this._loadingToken)),
              dom.on("click", this._handleOAuthLogin.bind(this)),
              testId("import-airtable-connect"),
            ),
            cssDivider(cssDividerLine(), t("or"), cssDividerLine()),
            bigBasicButton(
              t("Use Personal Access Token instead"),
              dom.on("click", () => this._showPATInput.set(true)),
              testId("import-airtable-use-pat"),
            ),
          ];
        } else {
          return [
            cssInputGroup(
              cssLabel(t("Personal Access Token")),
              cssTextInput(this._patToken, { type: "password", placeholder: "patXXXXXXXXXXXXXXXX" },
                dom.onKeyPress({ Enter: this._handlePATLogin.bind(this) }),
              ),
              cssHelperText(markdown(
                t(`[Generate a token]({{airtableCreateTokens}}) in your Airtable \
account with scopes that include at least **\`schema.bases:read\`** and **\`data.records:read\`**.

Your token is never sent to Grist's servers, and is only used to make API calls to Airtable from your browser.`,
                { airtableCreateTokens: "https://airtable.com/create/tokens" }),
              )),
            ),
            bigPrimaryButton(
              dom.text(use => use(this._loadingToken) ? t("Connecting...") : t("Connect")),
              dom.prop("disabled", use => use(this._loadingToken) || !use(this._patToken).trim()),
              dom.on("click", this._handlePATLogin.bind(this)),
            ),
            cssTextButton(
              t("Back"),
              dom.on("click", () => {
                this._showPATInput.set(false);
                this._patToken.set("");
                this._error.set(null);
              }),
            ),
          ];
        }
      }),
    ));
  }

  private _connectionMenu() {
    return menu(() => [
      cssMenuText(
        menuIcon("Info"),
        dom.text(use =>
          t("Connected via {{method}}", { method: use(this._authMethod) === "oauth" ? "OAuth" : "PAT" }),
        ),
      ),
      menuDivider(),
      menuItem(this._handleRefresh.bind(this), menuIcon("Convert"), t("Refresh")),
      menuItem(this._handleLogout.bind(this), menuIcon("Remove"), t("Disconnect")),
    ]);
  }

  private _basesList(owner: IDisposableOwner) {
    const selected = Observable.create<string | null>(owner, null);
    return [
      cssChooseBase(t("Choose an Airtable base to import from"),
        cssSettingsButton(icon("Settings"), this._connectionMenu(), testId("import-airtable-settings")),
      ),
      dom.maybe(this._error, err => cssError(err)),

      cssScrollableContent(
        dom.domComputed(use => [use(this._loadingBases), use(this._bases)] as const, ([isLoading, basesList]) => [
          (isLoading ?
            cssLoading(
              loadingSpinner(),
              cssHelperText(t("loading your bases...")),
            ) :
            (basesList.length === 0 ?
              cssWarning(
                t("No bases found"),
                cssHelperText(t("Make sure your token has the correct permissions.")),
              ) :
              cssRadioOptions(
                basesList.map(base =>
                  radioCheckboxOption(selected, base.id, [
                    cssBaseName(base.name, testId("import-airtable-name")),
                    cssBaseId(base.id, testId("import-airtable-id")),
                  ]),
                ),
              )
            )
          ),
        ]),
        testId("import-airtable-bases"),
      ),
      cssFooterButtons(
        bigPrimaryButton(
          t("Continue"),
          dom.prop("disabled", use => use(this._loadingBases) || !use(selected)),
          dom.on("click", () => this._handleSelectBase(selected.get()!)),
        ),
        bigBasicButton(t("Cancel"), dom.on("click", this._onCancel)),
      ),
    ];
  }

  private _baseTablesList(owner: IDisposableOwner) {
    return [
      cssSelectTables(
        dom.domComputed(this._importing, importing => importing ?
          t("Import from {{baseName}} in progress. Do not navigate away from this page.", {
            baseName: dom("strong", this._base.get()!.name),
          }) :
          t("Select tables to import from {{baseName}}", {
            baseName: dom("strong", this._base.get()!.name),
          }),
        ),
      ),
      dom.maybe(this._error, err => cssError(err)),

      cssScrollableContent(
        dom.domComputed(
          use => [use(this._loadingBaseSchema), use(this._tableMappings), use(this._importing)] as const,
          ([isLoadingSchema, mappings, isImporting]) => [
            (isLoadingSchema || isImporting ?
              cssLoading(
                loadingSpinner(dom.hide(isImporting)),
                cssHelperText(
                  isImporting ?
                    dom.text(use => use(this._importProgress).status ?? "") :
                    t("loading your tables..."),
                ),
                isImporting ? cssProgressBarContainer(
                  cssProgressBarFill(
                    dom.style("width", use => `${use(this._importProgress).percent}%`),
                  ),
                ) : null,
              ) :
              this._tableMappingsList(mappings)
            ),
          ],
        ),
      ),
      cssFooterButtons(
        bigPrimaryButton(
          dom.text((use) => {
            const count = use(this._importTablesCount);
            return count > 0 ? t("Import {{count}} tables", { count }) : t("Import tables");
          }),
          dom.prop("disabled", use =>
            use(this._loadingBaseSchema) ||
            use(this._importTablesCount) === 0,
          ),
          dom.hide(this._importing),
          dom.on("click", () => this._handleImport()),
        ),
        bigBasicButton(t("Cancel"), dom.on("click", this._onCancel)),
      ),
    ];
  }

  private _tableMappingsList(mappings: AirtableToGristMapping[]) {
    return cssMappingsGrid(
      cssMappingsHeaderColumn(t("Source tables")),
      cssMappingsHeaderColumn(t("Destination")),
      cssMappingsHeaderColumn(dom.hide(isNarrowScreenObs())), // To keep grid template aligned.
      mappings.map(m => this._tableMapping(m)),
    );
  }

  private _tableMapping(mapping: AirtableToGristMapping) {
    return [
      cssTableNameColumn(
        cssTableIconAndName(
          cssTableIcon("TypeTable"),
          cssTableName(mapping.tableName),
        ),
      ),
      this._destinationMenu(mapping),
      this._tableWarnings(mapping),
    ];
  }

  private _destinationMenu(mapping: AirtableToGristMapping) {
    return selectMenu(
      cssDestinationIconAndName(
        this._destinationMenuLabel(mapping),
      ),
      () => this._destinationMenuOptions(mapping),
    );
  }

  private _destinationMenuLabel(mapping: AirtableToGristMapping) {
    return dom.domComputed((use) => {
      const destination = use(mapping.destination);
      const existingTablesById = use(this._existingTablesById);

      if (destination?.type === "existing-table" && existingTablesById.has(destination.tableId)) {
        const { name, id } = existingTablesById.get(destination.tableId)!;
        return [
          cssDestinationIcon("FieldTable"),
          cssDestinationName(name || id),
        ];
      } else if (destination?.type === "new-table" && !destination.structureOnly) {
        return [
          cssDestinationIcon("Plus"),
          cssDestinationName(t("New table")),
        ];
      } else if (destination?.type === "new-table" && destination.structureOnly) {
        return [
          cssDestinationIcon("Plus"),
          cssDestinationName(t("Structure only")),
        ];
      } else if (!destination) {
        return [
          cssDestinationIcon("CrossBig"),
          cssDestinationName(t("Skip")),
        ];
      }
    });
  }

  private _destinationMenuOptions(mapping: AirtableToGristMapping) {
    return [
      menuSubHeader(t("Choose destination")),
      selectOption(
        () => {
          mapping.destination.set({ type: "new-table", structureOnly: false });
        },
        t("New table"),
        "Plus",
        cssAccentIconColor.cls(""),
      ),
      selectOption(
        () => {
          mapping.destination.set({ type: "new-table", structureOnly: true });
        },
        t("New table: structure only"),
        "Plus",
        cssAccentIconColor.cls(""),
      ),
      selectOption(
        () => {
          mapping.destination.set(null);
        },
        t("Skip"),
        "CrossBig",
        cssAccentIconColor.cls(""),
      ),
      dom.domComputed(this._existingTables, existingTables => existingTables && existingTables.length > 0 ? [
        menuDivider(),
        menuSubHeader(t("Existing tables")),
        existingTables.map(({ id, name }) =>
          selectOption(
            () => {
              mapping.destination.set({ type: "existing-table", tableId: id });
            },
            name || id,
            "FieldTable",
            cssAccentIconColor.cls(""),
          ),
        ),
      ] : null),
    ];
  }

  private _tableWarnings({ tableId }: AirtableToGristMapping) {
    return dom.domComputed((use) => {
      const warningsByTableId = use(this._warningsByTableId);
      const warnings = warningsByTableId.get(tableId);
      if (warnings && warnings.length > 0) {
        return cssTableWarnings(
          cssWarningIcon("Warning2"),
          cssWarningsLabel(t("{{count}} warnings", { count: String(warnings.length) })),
          hoverTooltip(() => cssWarningsList(
            dom.forEach(warnings, w => dom("li", w.message)),
          )),
        );
      } else {
        return cssTableWarnings(dom.hide(isNarrowScreenObs()));
      }
    });
  }

  private _checkForToken() {
    this._voidAsyncWork(async () => {
      try {
        const payload = await this._oauth2ClientsApi.fetchToken();
        this._isOAuthConfigured.set(true);
        if (this.isDisposed()) { return; }
        this._handleTokenPayload(payload);
      } catch (err) {
        if (this.isDisposed()) { return; }
        this._accessToken.set(null);
        this._authMethod.set(null);
        if ([400, 404].includes(err.status)) {
          // OAuth endpoint unavailable or integration not configured.
          this._isOAuthConfigured.set(false);
        } else if (err.status === 401) {
          // No tokens. That's not an error!
          this._isOAuthConfigured.set(true);
        } else {
          this._error.set(String(err));
          this._isOAuthConfigured.set(true);
        }
      }
    }, { loading: this._loadingToken });
  }

  private _handleOAuthLogin() {
    const baseUrl = addCurrentOrgToPath(getHomeUrl());
    const authUrl = new URL(`${baseUrl}/oauth2/airtable/authorize`);
    authUrl.searchParams.set("openerOrigin", location.origin);
    const lis = dom.onElem(window, "message", (event: Event) => {
      const homeOrigin = new URL(getHomeUrl()).origin;
      const eventOrigin = (event as MessageEvent).origin;
      if (eventOrigin !== homeOrigin) {
        console.warn(`Not trusting event from an unrecognized origin: ${eventOrigin}`);
        return;
      }
      lis.dispose();
      if (this.isDisposed()) { return; }

      // The payload may contain an error, but we avoid sending tokens, to keep fewer paths for
      // sensitive data. If no error, the API call should succeed in returning a token.
      const payload = (event as MessageEvent).data;
      if (payload && typeof payload === "object" && typeof payload.error === "string") {
        this._error.set(payload.error);
      } else {
        this._checkForToken();
      }
    });
    window.open(authUrl, "_blank");
  }

  private _handleTokenPayload(payload: TokenPayload) {
    if (payload.error) {
      console.error("OAuth error:", payload.error);
      this._error.set(String(payload.error));
    } else {
      this._accessToken.set(payload.access_token!);
      this._authMethod.set("oauth");
      this._fetchBases(payload.access_token!);
    }
  }

  private async _handlePATLogin() {
    const token = this._patToken.get().trim();
    if (!token) {
      this._error.set(t("Please enter a Personal Access Token"));
    } else {
      this._accessToken.set(token);
      this._authMethod.set("pat");
      this._fetchBases(token);
    }
  }

  private async _handleSelectBase(baseId: string) {
    const base = this._bases.get().find(b => b.id === baseId)!;
    this._base.set(base);
    this._fetchBaseSchema();
  }

  private async _handleImport() {
    this._voidAsyncWork(async () => {
      try {
        const { schema: importSchema } = gristDocSchemaFromAirtableSchema(this._baseSchema.get()!);
        const result = await applyAirtableImportSchemaAndImportData({
          importSchema,
          dataSource: {
            api: new AirtableAPI({ apiKey: this._accessToken.get()! }),
            baseId: this._base.get()!.id,
          },
          userApi: this._api,
          options: {
            existingDocId: this._existingDocId,
            newDocName: this._base.get()!.name,
            transformations: {
              skipTableIds: this._skipTableIds.get(),
              mapExistingTableIds: this._mapExistingTableIds.get(),
            },
            structureOnlyTableIds: this._structureOnlyTableIds.get(),
            onProgress: (progress) => {
              if (this.isDisposed()) { return; }

              this._importProgress.set(progress);
            },
          },
        });
        if (this.isDisposed()) { return; }
        await this._onSuccess(result);
      } catch (err) {
        if (this.isDisposed()) { return; }
        this._onError(err);
      }
    }, { loading: this._importing });
  }

  private async _doAsyncWork(
    doWork: () => Promise<void>,
    options: { loading?: Observable<boolean> } = {},
  ) {
    const { loading } = options;
    if (loading) { loading.set(true); }
    this._error.set(null);
    try {
      await doWork();
    } catch (err) {
      if (!this.isDisposed()) {
        this._error.set(err.message);
      }
    } finally {
      if (!this.isDisposed() && loading) {
        loading.set(false);
      }
    }
  }

  private _voidAsyncWork(
    doWork: () => Promise<void>,
    options: { loading?: Observable<boolean> } = {},
  ): void {
    void this._doAsyncWork(doWork, options);
  }

  private _fetchBases(token: string) {
    this._voidAsyncWork(async () => {
      const response = await fetch(`${AirtableImport.AIRTABLE_API_BASE}/meta/bases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) { throw new Error(t("Failed to fetch bases")); }
      const data = await response.json();
      if (this.isDisposed()) { return; }
      this._bases.set(data.bases || []);
    }, { loading: this._loadingBases });
  }

  private _fetchBaseSchema() {
    this._voidAsyncWork(async () => {
      const api = new AirtableAPI({ apiKey: this._accessToken.get()! });
      try {
        const baseSchema = await api.getBaseSchema(this._base.get()!.id);
        if (this.isDisposed()) { return; }
        this._baseSchema.set(baseSchema);
        this._tableMappings.set(baseSchema.tables.map(table => ({
          tableId: table.id,
          tableName: table.name,
          destination: Observable.create(this, {
            type: "new-table" as const,
            structureOnly: false,
          }),
        })));
      } catch {
        throw new Error(t("Failed to fetch base schema"));
      }
    }, { loading: this._loadingBaseSchema });
  }

  private _handleLogout() {
    this._oauth2ClientsApi.deleteToken().catch(reportError);
    this._accessToken.set(null);
    this._authMethod.set(null);
    this._bases.set([]);
    this._patToken.set("");
    this._showPATInput.set(false);
    this._error.set(null);
  }

  private _handleRefresh() {
    const token = this._accessToken.get();
    if (token) { this._fetchBases(token); }
  }
}

/**
 * Helper to make requests to OAuth2Clients API endpoints.
 * TODO This should be moved to a shared place once there is other code that may benefit.
 */
class OAuth2ClientsAPI extends BaseAPI {
  private _homeUrl: string;   // Home URL, guaranteed to be without trailing slashes.
  constructor(homeUrl: string = getHomeUrl()) {
    super();
    this._homeUrl = addCurrentOrgToPath(homeUrl.replace(/\/+$/, ""));
  }

  public fetchToken(): Promise<TokenPayload> { return this.requestJson(`${this._homeUrl}/oauth2/airtable/token`); }
  public deleteToken() { return this.requestJson(`${this._homeUrl}/oauth2/airtable/token`, { method: "DELETE" }); }
}

function cssWarning(...args: DomElementArg[]) {
  return cssWell(cssWell.cls("-warning"), cssIcon(icon("Warning")), dom("div", ...args),
    testId("import-airtable-warning"));
}

function cssError(...args: DomElementArg[]) {
  return cssWell(cssWell.cls("-error"), cssIcon(icon("Warning")), dom("div", ...args),
    testId("import-airtable-error"));
}

// Styled Components

const cssMainContent = styled(cssModalBody, `
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssIcon = styled("div", `
  flex-shrink: 0;
`);

const cssDivider = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssDividerLine = styled("div", `
  border-bottom: 1px solid ${theme.menuBorder};
  flex-grow: 1;
`);

const cssInputGroup = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssLabel = styled("label", `
  font-weight: bold;
`);

const cssTextInput = styled(textInput, `
  height: 28px;
`);

const cssHelperText = styled("div", `
  color: ${theme.lightText};
`);

const cssTextButton = styled(textButton, `
  align-self: center;
`);

const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
`);

const cssScrollableContent = styled(shadowScroll, `
  flex: 1 1 auto;
  width: auto;
  margin: 0 -64px;
  padding: 16px 64px 24px 64px;
  border-bottom: 1px solid ${theme.modalBorderDark};

  @media ${mediaSmall} {
    & {
      margin: 0 -16px;
      padding: 16px;
    }
  }
`);

const cssChooseBase = styled("div", `
  color: ${components.mediumText};
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
`);

const cssSelectTables = styled("div", `
  color: ${components.mediumText};
  margin-bottom: 8px;
`);

const cssSettingsButton = styled(cssIconButton, `
  --icon-color: ${theme.controlFg};
`);

const cssMenuText = styled(menuText, `
  font-size: revert;
  --icon-color: ${theme.lightText};
`);

const cssRadioOptions = styled(cssRadioCheckboxOptions, `
  & .${cssLabelText.className} {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }
`);

const cssBaseName = styled("span", `
  font-weight: bold;
`);

const cssBaseId = styled(cssCodeBlock, `
  color: ${theme.lightText};
`);

const cssFooterButtons = styled(cssModalButtons, `
  margin: 16px 0 -16px 0;
`);

const cssMappingsGrid = styled("div", `
  align-items: baseline;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(220px, auto) minmax(160px, auto) auto;

  @media ${mediaSmall} {
    & {
      grid-template-columns: minmax(160px, auto) minmax(120px, auto);
    }
  }
`);

const cssMappingsHeaderColumn = styled("div", `
  color: ${components.mediumText};
  font-size: ${tokens.smallFontSize};
  text-transform: uppercase;
`);

const cssTableNameColumn = styled("div", `
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssTableIconAndName = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

const cssTableIcon = styled(icon, `
  flex-shrink: 0;
  --icon-color: ${theme.accentIcon};
`);

const cssTableName = styled("div", `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssDestinationIconAndName = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
`);

const cssDestinationIcon = styled(icon, `
  flex-shrink: 0;
  --icon-color: ${theme.accentIcon};
`);

const cssDestinationName = styled("div", `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssAccentIconColor = styled("div", `
  --icon-color: ${theme.accentIcon};
`);

const cssTableWarnings = styled("div", `
  align-items: center;
  display: flex;
  gap: 4px;

  @media ${mediaSmall} {
    & {
      grid-column-start: 2;
      grid-column-end: 3;
      margin-bottom: 8px;
    }
  }
`);

const cssWarningIcon = styled(icon, `
  flex-shrink: 0;
  height: 20px;
  width: 20px;
  --icon-color: ${theme.iconError};
`);

const cssWarningsLabel = styled("div", `
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

const cssWarningsList = styled("ul", `
  margin: 0px;
  max-width: 400px;
  padding: 8px 16px;
  text-align: left;
`);

const cssProgressBarContainer = styled("div", `
  width: 100%;
  height: 4px;
  border-radius: 5px;
  background: ${theme.progressBarBg};
`);

const cssProgressBarFill = styled(cssProgressBarContainer, `
  background: ${theme.progressBarFg};
  transition: width 0.4s linear;

  &-approaching-limit {
    background: ${theme.progressBarErrorFg};
  }
`);
