import { runGristImport, validateGristSchemaImport } from "app/client/lib/imports/grist/GristImporter";
import {
  GristImportDestination,
  GristImportResult,
  GristImportTableMapping,
  NewDoc,
} from "app/client/lib/imports/grist/GristImporterTypes";
import {
  cssAccentIconColor,
  cssDestinationIcon,
  cssDestinationIconAndName,
  cssDestinationMenu,
  cssDestinationName,
  cssFooterButtons,
  cssHelperText,
  cssIncludeColumn,
  cssLoading,
  cssMappingsGrid,
  cssMappingsHeaderColumn,
  cssScrollableContent,
  cssTableIcon,
  cssTableIconAndName,
  cssTableName,
  cssTableNameColumn,
  cssTableWarnings,
  cssWarningIcon,
  cssWarningsLabel,
  cssWarningsList,
} from "app/client/lib/imports/ImportCss";
import {
  allTablesIncludedComputed,
  ExistingTable,
  IMPORT_TABLE_AND_DATA,
  ImportTableMapping,
  includedTablesComputed,
  includeTableCheckbox,
  NewTable,
} from "app/client/lib/imports/ImportTableMapping";
import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import { cssWell } from "app/client/ui/AdminPanelCss";
import { isGristImportAvailable } from "app/client/ui/FeatureStatus";
import { hoverTooltip } from "app/client/ui/tooltips";
import { bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { triStateSquareCheckbox } from "app/client/ui2018/checkbox";
import { isNarrowScreenObs, testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { loadingSpinner } from "app/client/ui2018/loaders";
import {
  IOption, menuDivider, menuSubHeader, selectMenu, selectOption, selectWithLoader,
} from "app/client/ui2018/menus";
import { cssModalBody } from "app/client/ui2018/modals";
import {
  buildDocSchema,
  DocSchema,
  DocSchemaImportWarning,
  ImportSchemaTransformParams,
} from "app/common/DocSchemaImport";
import { commonUrls } from "app/common/gristUrls";
import { isLongerThan } from "app/common/gutil";
import { components } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";
import { Document, getOrgName, Organization, Workspace } from "app/common/UserAPI";
import { MaybePromise } from "app/plugin/gutil";

import { Computed, Disposable, dom, DomElementArg, Observable, styled, subscribe } from "grainjs";
import sortBy from "lodash/sortBy";

const t = makeT("GristImportUI");

type GristToGristMapping = ImportTableMapping<NewTable | ExistingTable>;

type GristImportStep = "select-doc" | "select-tables";

type LoadingState = boolean | "slow";

const DELAY_BEFORE_SPINNER_MS = 500;

type Destination =
  { type: "existing-doc", docId: string, docSchema?: Computed<DocSchema> } |
  Omit<NewDoc, "name">;

export interface GristImportOptions {
  appModel: AppModel;
  destination: Destination;
  onSuccess(result: GristImportResult): MaybePromise<void>;
  onError(error: unknown): void;
  onCancel(): void;
}

/**
 * UI for importing tables from another Grist document on the same installation.
 *
 * Based on AirtableImport from AirtableImportUI.ts, with the first step replaced with
 * a source Grist document picker.
 */
export class GristImport extends Disposable {
  private _api = this._options.appModel.api;
  private _currentStep = Observable.create<GristImportStep>(this, "select-doc");
  private _orgs = this._options.appModel.topAppModel.orgs;
  private _selectedOrg = Observable.create<Organization | null>(this, null);
  private _workspaces = Observable.create<Workspace[] | null>(this, null);
  private _selectedWorkspace = Observable.create<Workspace | null>(this, null);
  private _selectedDoc = Observable.create<Document | null>(this, null);
  // The chosen source document, and the site it lives on. Only read when acting on the
  // selection, never rendered reactively, so plain fields are enough.
  private _sourceDoc: Document | null = null;
  private _sourceOrg: Organization | null = null;
  private _sourceSchema = Observable.create<DocSchema | null>(this, null);
  private _loadingSourceSchema = Observable.create<LoadingState>(this, false);
  private _importing = Observable.create(this, false);
  private _error = Observable.create<string | null>(this, null);
  private _isAvailable = isGristImportAvailable(this._options.appModel);

  private _selectableDocs = Computed.create(this, (use) => {
    const workspace = use(this._selectedWorkspace);
    if (!workspace) { return []; }

    const destination = this._options.destination;
    const destDocId = destination.type === "existing-doc" ? destination.docId : null;
    return workspace.docs.filter(doc => doc.id !== destDocId && doc.urlId !== destDocId);
  });

  private _orgOptions = Computed.create(this, (use): IOption<Organization | null>[] | null => {
    // Every user belongs to at least their personal site, so an empty list means the sites
    // haven't arrived yet; show the loading state rather than an empty select.
    const orgs = use(this._orgs);
    return orgs.length > 0 ?
      orgs.map(value => ({ value, label: getOrgName(value) })) :
      null;
  });

  private _workspaceOptions = Computed.create(this, (use): IOption<Workspace | null>[] | null => {
    const workspaces = use(this._workspaces);
    return workspaces?.map(value => ({ value, label: value.name })) ?? null;
  });

  private _docOptions = Computed.create(this, (use): IOption<Document | null>[] | null => {
    if (use(this._workspaces) === null) { return null; }

    return use(this._selectableDocs).map(value => ({ value, label: value.name }));
  });

  private _noDocsAvailable = Computed.create(this, use =>
    use(this._workspaces) !== null && use(this._selectableDocs).length === 0);

  private _noWorkspacesAvailable = Computed.create(this, use =>
    use(this._workspaces)?.length === 0);

  private _destDocSchema = this._options.destination.type === "existing-doc" ?
    this._options.destination.docSchema : undefined;

  private _existingTables = Computed.create(this, use =>
    (this._destDocSchema ? use(this._destDocSchema).tables : []));

  private _existingTablesById = Computed.create(this, use =>
    new Map(use(this._existingTables).map(table => [table.id, table])));

  private _tableMappings = Observable.create<GristToGristMapping[]>(this, []);

  private _skipTableIds = Computed.create(this, (use) => {
    const mappings = use(this._tableMappings);
    return mappings.filter(m => !use(m.destination)).map(m => m.tableId);
  });

  // Source tables whose destination is a table the document already has, keyed by source
  // table id. A destination that has since disappeared is ignored, and the table is created.
  private _mapExistingTableIds = Computed.create(this, (use) => {
    const existingTablesById = use(this._existingTablesById);
    const mapping = new Map<string, string>();
    for (const m of use(this._tableMappings)) {
      const destination = use(m.destination);
      if (destination?.type === "existing-table" && existingTablesById.has(destination.tableId)) {
        mapping.set(m.tableId, destination.tableId);
      }
    }
    return mapping;
  });

  private _includedTables = includedTablesComputed(this, this._tableMappings);

  private _allTablesIncluded = allTablesIncludedComputed(this, this._tableMappings, this._includedTables);

  private _warningsByTableId = Computed.create(this, (use) => {
    const warningsByTableId = new Map<string, DocSchemaImportWarning[]>();

    const sourceSchema = use(this._sourceSchema);
    if (!sourceSchema) { return warningsByTableId; }

    const transformations: ImportSchemaTransformParams = {
      skipTableIds: use(this._skipTableIds),
      mapExistingTableIds: use(this._mapExistingTableIds),
    };

    const warnings = validateGristSchemaImport(
      sourceSchema, transformations, this._destDocSchema && use(this._destDocSchema));

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

  constructor(private _options: GristImportOptions) {
    super();
    this.autoDispose(subscribe(this._selectedOrg, (use, org) => {
      this._updateWorkspaces(org).catch((err) => {
        if (!this.isDisposed()) { this._error.set(err.message); }
      });
    }));
    this.autoDispose(subscribe(this._selectableDocs, (use, docs) => {
      this._selectedDoc.set(docs[0] ?? null);
    }));
    this._selectDefaultOrg();
  }

  public buildDom() {
    return dom.domComputed(this._currentStep, (step) => {
      switch (step) {
        case "select-doc": {
          return this._buildDocPicker();
        }
        case "select-tables": {
          return this._buildSourceTables();
        }
      }
    });
  }

  private _buildDocPicker() {
    return [
      cssMainContent(
        cssHeaderText(t("Select the Grist document to copy data from.")),
        dom.maybe(this._error, err => cssError(err)),
        cssField(
          cssFieldLabel(t("Site")),
          selectWithLoader(this._selectedOrg, this._orgOptions),
          testId("import-grist-org"),
        ),
        cssField(
          cssFieldLabel(t("Workspace")),
          dom.update(
            selectWithLoader(this._selectedWorkspace, this._workspaceOptions),
            dom.hide(this._noWorkspacesAvailable),
          ),
          cssHelperText(
            t("No workspaces available in this site."),
            dom.show(this._noWorkspacesAvailable),
          ),
          testId("import-grist-workspace"),
        ),
        cssField(
          cssFieldLabel(t("Document")),
          dom.update(
            selectWithLoader(this._selectedDoc, this._docOptions),
            dom.hide(this._noDocsAvailable),
          ),
          cssHelperText(
            t("No documents available in this workspace."),
            dom.show(this._noDocsAvailable),
          ),
          testId("import-grist-doc"),
        ),
      ),
      cssFooterButtons(
        bigPrimaryButton(
          t("Continue"),
          dom.prop("disabled", use => !use(this._selectedDoc)),
          dom.on("click", () => this._handleSelectDoc()),
          testId("import-grist-continue"),
        ),
        bigBasicButton(t("Cancel"), dom.on("click", () => this._options.onCancel()),
          testId("import-grist-cancel")),
      ),
    ];
  }

  private _buildSourceTables() {
    return [
      cssHeaderText(
        dom.domComputed(this._importing, importing => importing ?
          t("Copy from {{docName}} in progress. Do not navigate away from this page.", {
            docName: dom("strong", this._sourceDoc?.name ?? ""),
          }) :
          t("Select tables to copy from {{docName}}", {
            docName: dom("strong", this._sourceDoc?.name ?? ""),
          }),
        ),
      ),
      dom.maybe(this._error, err => cssError(err)),

      cssScrollableContent(
        this._isAvailable ? null : [cssScrollableContent.cls("-inert"), dom.attr("inert", "")],
        dom.domComputed(
          use => [use(this._loadingSourceSchema), use(this._tableMappings), use(this._importing)] as const,
          ([loadingSchema, mappings, isImporting]) => {
            if (isImporting || loadingSchema === "slow") {
              return cssLoading(
                loadingSpinner(),
                cssHelperText(
                  isImporting ? t("Copying tables...") : t("loading your tables..."),
                ),
              );
            }
            return loadingSchema ? null : this._tableMappingsList(mappings);
          },
        ),
      ),
      this._isAvailable ?
        cssFooterButtons(
          bigPrimaryButton(
            dom.text((use) => {
              const count = use(this._includedTables).length;
              if (count === 0) { return t("Copy tables"); }
              return count === 1 ? t("Copy 1 table") : t("Copy {{count}} tables", { count });
            }),
            dom.prop("disabled", use =>
              Boolean(use(this._loadingSourceSchema)) ||
              use(this._includedTables).length === 0,
            ),
            dom.hide(this._importing),
            dom.on("click", () => this._handleImport()),
            testId("import-grist-import"),
          ),
          // TODO: Cancel currently only closes the modal. Make it also stop an import in
          // progress (which otherwise keeps running server-side).
          bigBasicButton(t("Cancel"), dom.on("click", () => this._options.onCancel()),
            testId("import-grist-cancel")),
        ) :
        this._buildUpgradeNudge(),
    ];
  }

  private _buildUpgradeNudge() {
    const { appModel } = this._options;
    const { deploymentType } = getGristConfig();
    const isCoreDeployment = deploymentType === "core";
    const canUpgrade = deploymentType === "saas" && appModel.isOwner() && appModel.isBillingManager();

    return cssUpgradeNudge(
      cssUpgradeNudgeText(isCoreDeployment ?
        t("Copying data from another document is available in the full edition of Grist.") :
        t("Copying data from another document is available on Business plans and above.")),
      canUpgrade ?
        bigPrimaryButton(
          t("Try for free"),
          dom.on("click", () => appModel.showUpgradeModal()),
          testId("import-grist-upgrade"),
        ) :
        bigPrimaryButtonLink(
          isCoreDeployment ? t("Try full Grist") : t("Try for free"),
          { href: commonUrls.plans, target: "_blank" },
          testId("import-grist-upgrade"),
        ),
      testId("import-grist-upsell"),
    );
  }

  private _tableMappingsList(mappings: GristToGristMapping[]) {
    return cssMappingsGrid(
      cssIncludeColumn(
        triStateSquareCheckbox(this._allTablesIncluded, testId("import-grist-include-all")),
      ),
      cssMappingsHeaderColumn(t("Source tables")),
      cssMappingsHeaderColumn(t("Destination")),
      mappings.map(m => this._tableMapping(m)),
      testId("import-grist-mappings"),
    );
  }

  private _tableMapping(mapping: GristToGristMapping) {
    return [
      includeTableCheckbox(mapping, testId(`import-grist-table-${mapping.tableId}-include`)),
      cssTableNameColumn(
        cssTableIconAndName(
          cssTableIcon("TypeTable"),
          cssTableName(
            mapping.tableId,
            testId("import-grist-table-name"),
          ),
        ),
      ),
      this._destinationMenu(mapping),
      this._tableWarnings(mapping),
    ];
  }

  private _destinationMenu(mapping: GristToGristMapping) {
    return selectMenu(
      cssDestinationIconAndName(
        this._destinationMenuLabel(mapping),
        testId("import-grist-destination-label"),
      ),
      () => this._destinationMenuOptions(mapping),
      cssDestinationMenu.cls(""),
      testId(`import-grist-table-${mapping.tableId}-destination`),
    );
  }

  private _destinationMenuLabel(mapping: GristToGristMapping) {
    return dom.domComputed((use) => {
      const destination = use(mapping.destination);
      const existingTablesById = use(this._existingTablesById);

      if (!destination) {
        return [
          cssDestinationIcon("CrossBig"),
          cssDestinationName(t("Skip")),
        ];
      }
      if (destination.type === "existing-table" && existingTablesById.has(destination.tableId)) {
        const { name, id } = existingTablesById.get(destination.tableId)!;
        return [
          cssDestinationIcon("FieldTable"),
          cssDestinationName(name || id),
        ];
      }
      return [
        cssDestinationIcon("Plus"),
        cssDestinationName(destination.type === "new-table" && destination.structureOnly ?
          t("Structure only") :
          t("New table")),
      ];
    });
  }

  private _destinationMenuOptions(mapping: GristToGristMapping) {
    // Picking a destination also records it, so that unchecking and rechecking the table
    // comes back to it rather than resetting to "New table".
    const setDestination = (destination: NewTable | ExistingTable) => {
      mapping.lastDestination = destination;
      mapping.destination.set(destination);
    };

    return [
      menuSubHeader(t("Choose destination")),
      selectOption(
        () => setDestination(IMPORT_TABLE_AND_DATA),
        t("New table"),
        "Plus",
        cssAccentIconColor.cls(""),
      ),
      selectOption(
        () => setDestination({ type: "new-table", structureOnly: true }),
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
      dom.domComputed(this._existingTables, existingTables => existingTables.length > 0 ? [
        menuDivider(),
        menuSubHeader(t("Existing tables")),
        existingTables.map(({ id, name }) =>
          selectOption(
            () => setDestination({ type: "existing-table", tableId: id }),
            name || id,
            "FieldTable",
            cssAccentIconColor.cls(""),
          ),
        ),
      ] : null),
    ];
  }

  private _tableWarnings({ tableId }: GristToGristMapping) {
    return dom.domComputed((use) => {
      const warningsByTableId = use(this._warningsByTableId);
      const warnings = warningsByTableId.get(tableId);
      if (warnings && warnings.length > 0) {
        return cssTableWarnings(
          cssWarningIcon("Warning2"),
          cssWarningsLabel(warnings.length === 1 ?
            t("1 warning") :
            t("{{count}} warnings", { count: String(warnings.length) })),
          hoverTooltip(() => cssWarningsList(
            dom.forEach(warnings, w => dom("li", w.message)),
          )),
        );
      } else {
        return cssTableWarnings(dom.hide(isNarrowScreenObs()));
      }
    });
  }

  /**
   * Starts on the site the user is currently on, once the site list is available.
   */
  private _selectDefaultOrg() {
    // TopAppModel fetches the sites eagerly on startup, but they may not have arrived yet.
    this.autoDispose(subscribe(this._orgs, (use, orgs) => {
      if (this._selectedOrg.get() || orgs.length === 0) { return; }

      const currentOrgId = this._options.appModel.currentOrg?.id;
      this._selectedOrg.set(orgs.find(org => org.id === currentOrgId) ?? orgs[0]);
    }));
  }

  private async _updateWorkspaces(org: Organization | null) {
    this._workspaces.set(null);
    this._selectedWorkspace.set(null);
    if (!org) { return; }

    let workspaces = await this._api.getOrgWorkspaces(org.id);
    if (this.isDisposed() || this._selectedOrg.get() !== org) { return; }

    workspaces = sortBy(workspaces.filter(ws => !ws.isSupportWorkspace), ws => ws.name.toLowerCase());
    this._workspaces.set(workspaces);
    this._selectedWorkspace.set(workspaces[0] ?? null);
  }

  private _handleSelectDoc() {
    const doc = this._selectedDoc.get();
    if (!doc) { return; }

    this._sourceDoc = doc;
    this._sourceOrg = this._selectedOrg.get();
    this._currentStep.set("select-tables");
    this._fetchSourceSchema();
  }

  private _fetchSourceSchema() {
    const done = this._doAsyncWork(async () => {
      // The source document may live on a different site than the page is on, and a document
      // is only findable under its own site, so pin the client to the site it was picked from
      // rather than letting it follow the current page.
      const sourceApi = this._sourceOrg?.domain ?
        this._api.forOrg(this._sourceOrg.domain) : this._api;
      const docApi = sourceApi.getDocAPI(this._sourceDoc!.id);
      try {
        const { tables } = await docApi.getTables({ expand: ["column"] });
        if (this.isDisposed()) { return; }

        const sourceSchema = buildDocSchema(tables);
        this._sourceSchema.set(sourceSchema);
        this._tableMappings.set(sourceSchema.tables.map(table => ({
          tableId: table.id,
          destination: Observable.create<NewTable | ExistingTable | null>(this, IMPORT_TABLE_AND_DATA),
          lastDestination: IMPORT_TABLE_AND_DATA,
        })));
      } catch (e) {
        console.error(e);
        throw new Error(t("Failed to fetch document tables"));
      }
    }, { loading: this._loadingSourceSchema });

    void isLongerThan(done, DELAY_BEFORE_SPINNER_MS).then((isSlow) => {
      if (isSlow && !this.isDisposed() && this._loadingSourceSchema.get()) {
        this._loadingSourceSchema.set("slow");
      }
    });
  }

  private _destination(): GristImportDestination {
    const destination = this._options.destination;
    if (destination.type === "existing-doc") {
      return destination;
    } else {
      return {
        ...destination,
        name: this._sourceDoc?.name,
      };
    }
  }

  private _handleImport() {
    void this._doAsyncWork(async () => {
      try {
        const existingTableIds = this._mapExistingTableIds.get();
        const tables: GristImportTableMapping[] = [];
        for (const mapping of this._tableMappings.get()) {
          const destination = mapping.destination.get();
          if (!destination) { continue; }

          tables.push({
            sourceTableId: mapping.tableId,
            destTableId: existingTableIds.get(mapping.tableId),
            structureOnly: destination.type === "new-table" && destination.structureOnly,
          });
        }
        const result = await runGristImport({
          sourceDocId: this._sourceDoc!.id,
          userApi: this._api,
          tables,
          destination: this._destination(),
        });
        if (this.isDisposed()) { return; }

        await this._options.onSuccess(result);
      } catch (err) {
        if (this.isDisposed()) { return; }

        this._options.onError(err);
      }
    }, { loading: this._importing });
  }

  private async _doAsyncWork(
    doWork: () => Promise<void>,
    options: { loading?: Observable<boolean> | Observable<LoadingState> } = {},
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
}

function cssError(...args: DomElementArg[]) {
  return cssWell(cssWell.cls("-error"), cssErrorIcon(icon("Warning")), dom("div", ...args),
    testId("import-grist-error"));
}

const cssMainContent = styled(cssModalBody, `
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssErrorIcon = styled("div", `
  flex-shrink: 0;
`);

const cssHeaderText = styled("div", `
  color: ${components.mediumText};
  margin-bottom: 8px;
`);

const cssField = styled("div", `
  margin: 4px 0;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 30px;
`);

const cssFieldLabel = styled("div", `
  min-width: 100px;
  font-weight: bold;
`);

const cssUpgradeNudge = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin: 24px 0 -16px 0;
  text-align: center;
`);

const cssUpgradeNudgeText = styled("div", `
  color: ${theme.text};
  max-width: 460px;
`);
