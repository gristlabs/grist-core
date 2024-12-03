import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {textInput} from 'app/client/ui/inputs';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {IModalControl, modal} from 'app/client/ui2018/modals';
import {AccessLevel, ICustomWidget, matchWidget, WidgetAuthor} from 'app/common/CustomWidget';
import {commonUrls} from 'app/common/gristUrls';
import {bundleChanges, Computed, Disposable, dom, makeTestId, Observable, styled} from 'grainjs';
import escapeRegExp from 'lodash/escapeRegExp';

const testId = makeTestId('test-custom-widget-gallery-');

const t = makeT('CustomWidgetGallery');

export const CUSTOM_URL_WIDGET_ID = 'custom';

interface Options {
  sectionRef?: number;
  addWidget?(): Promise<{viewRef: number, sectionRef: number}>;
}

export function showCustomWidgetGallery(gristDoc: GristDoc, options: Options = {}) {
  modal((ctl) => [
    dom.create(CustomWidgetGallery, ctl, gristDoc, options),
    cssModal.cls(''),
  ]);
}

interface WidgetInfo {
  variant: WidgetVariant;
  id: string;
  name: string;
  description?: string;
  developer?: WidgetAuthor;
  lastUpdated?: string;
}

interface CustomWidgetACItem extends ICustomWidget {
  cleanText: string;
}

type WidgetVariant = 'custom' | 'grist' | 'community';

class CustomWidgetGallery extends Disposable {
  private readonly _customUrl: Observable<string>;
  private readonly _filteredWidgets = Observable.create<ICustomWidget[] | null>(this, null);
  private readonly _section: ViewSectionRec | null = null;
  private readonly _searchText = Observable.create(this, '');
  private readonly _saveDisabled: Computed<boolean>;
  private readonly _savedWidgetId: Computed<string | null>;
  private readonly _selectedWidgetId = Observable.create<string | null>(this, null);
  private readonly _widgets = Observable.create<CustomWidgetACItem[] | null>(this, null);

  constructor(
    private _ctl: IModalControl,
    private _gristDoc: GristDoc,
    private _options: Options = {}
  ) {
    super();

    const {sectionRef} = _options;
    if (sectionRef) {
      const section = this._gristDoc.docModel.viewSections.getRowModel(sectionRef);
      if (!section.id.peek()) {
        throw new Error(`Section ${sectionRef} does not exist`);
      }

      this._section = section;
      this.autoDispose(section._isDeleted.subscribe((isDeleted) => {
        if (isDeleted) { this._ctl.close(); }
      }));
    }

    let customUrl = '';
    if (this._section) {
      customUrl = this._section.customDef.url() ?? '';
    }
    this._customUrl = Observable.create(this, customUrl);

    this._savedWidgetId = Computed.create(this, (use) => {
      if (!this._section) { return null; }

      const {customDef} = this._section;
      // May be stored in one of two places, depending on age of document.
      const widgetId = use(customDef.widgetId) || use(customDef.widgetDef)?.widgetId;
      if (widgetId) {
        const pluginId = use(customDef.pluginId);
        const widget = matchWidget(use(this._widgets) ?? [], {
          widgetId,
          pluginId,
        });
        return widget ? `${pluginId}:${widgetId}` : null;
      } else {
        return CUSTOM_URL_WIDGET_ID;
      }
    });

    this._saveDisabled = Computed.create(this, (use) => {
      const selectedWidgetId = use(this._selectedWidgetId);
      return selectedWidgetId === null;
    });

    this._initializeWidgets().catch(reportError);

    this.autoDispose(this._searchText.addListener(() => {
      this._filterWidgets();
      this._selectedWidgetId.set(null);
    }));
  }

  public buildDom() {
    return cssCustomWidgetGallery(
      cssHeader(
        cssTitle(t('Choose Custom Widget')),
        cssSearchInputWrapper(
          cssSearchIcon('Search'),
          cssSearchInput(
            this._searchText,
            {placeholder: t('Search')},
            (el) => { setTimeout(() => el.focus(), 10); },
            testId('search'),
          ),
        ),
      ),
      shadowScroll(
        this._buildWidgets(),
        cssShadowScroll.cls(''),
      ),
      cssFooter(
        dom('div',
          cssHelpLink(
            {href: commonUrls.helpCustomWidgets, target: '_blank'},
            cssHelpIcon('Question'),
            t('Learn more about Custom Widgets'),
          ),
        ),
        cssFooterButtons(
          bigBasicButton(
            t('Cancel'),
            dom.on('click', () => this._ctl.close()),
            testId('cancel'),
          ),
          bigPrimaryButton(
            this._options.addWidget ? t('Add Widget') : t('Change Widget'),
            dom.on('click', () => this._save()),
            dom.boolAttr('disabled', this._saveDisabled),
            testId('save'),
          ),
        ),
      ),
      dom.onKeyDown({
        Enter: () => this._save(),
        Escape: () => this._deselectOrClose(),
      }),
      dom.on('click', (ev) => this._maybeClearSelection(ev)),
      testId('container'),
    );
  }

  private async _initializeWidgets() {
    const widgets: ICustomWidget[] = [
      {
        widgetId: 'custom',
        name: t('Custom URL'),
        description: t('Add a widget from outside this gallery.'),
        url: '',
      },
    ];
    try {
      const remoteWidgets = await this._gristDoc.appModel.topAppModel.getWidgets();
      if (this.isDisposed()) { return; }

      widgets.push(...remoteWidgets
        .filter(({published}) => published !== false)
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      reportError(e);
    }

    this._widgets.set(widgets.map(w => ({...w, cleanText: getWidgetCleanText(w)})));
    this._selectedWidgetId.set(this._savedWidgetId.get());
    this._filterWidgets();
  }

  private _filterWidgets() {
    const widgets = this._widgets.get();
    if (!widgets) { return; }

    const searchText = this._searchText.get();
    if (!searchText) {
      this._filteredWidgets.set(widgets);
    } else {
      const searchTerms = searchText.trim().split(/\s+/);
      const searchPatterns = searchTerms.map(term =>
        new RegExp(`\\b${escapeRegExp(term)}`, 'i'));
      const filteredWidgets = widgets.filter(({cleanText}) =>
        searchPatterns.some(pattern => pattern.test(cleanText))
      );
      this._filteredWidgets.set(filteredWidgets);
    }
  }

  private _buildWidgets() {
    return dom.domComputed(this._filteredWidgets, (widgets) => {
      if (widgets === null) {
        return cssLoadingSpinner(loadingSpinner());
      } else if (widgets.length === 0) {
        return cssNoMatchingWidgets(t('No matching widgets'));
      } else {
        return cssWidgets(
          widgets.map(widget => {
            const {description, authors = [], lastUpdatedAt} = widget;

            return this._buildWidget({
              variant: getWidgetVariant(widget),
              id: getWidgetId(widget),
              name: getWidgetName(widget),
              description,
              developer: authors[0],
              lastUpdated: lastUpdatedAt,
            });
          }),
        );
      }
    });
  }

  private _buildWidget(info: WidgetInfo) {
    const {variant, id, name, description, developer, lastUpdated} = info;

    return cssWidget(
      dom.cls('custom-widget'),
      cssWidgetHeader(
        variant === 'custom' ? t('Add Your Own Widget') :
        variant === 'grist' ? t('Grist Widget') :
        withInfoTooltip(
          t('Community Widget'),
          'communityWidgets',
          {
            variant: 'hover',
            iconDomArgs: [cssTooltipIcon.cls('')],
          }
        ),
        cssWidgetHeader.cls('-secondary', ['custom', 'community'].includes(variant)),
      ),
      cssWidgetBody(
        cssWidgetName(
          name,
          testId('widget-name'),
        ),
        cssWidgetDescription(
          description ?? t('(Missing info)'),
          cssWidgetDescription.cls('-missing', !description),
          testId('widget-description'),
        ),
        variant === 'custom' ? null : cssWidgetMetadata(
          variant === 'grist' ? null : cssWidgetMetadataRow(
            cssWidgetMetadataName(t('Developer:')),
            cssWidgetMetadataValue(
              developer?.url
                ? cssDeveloperLink(
                  developer.name,
                  {href: developer.url, target: '_blank'},
                  dom.on('click', (ev) => ev.stopPropagation()),
                  testId('widget-developer'),
                )
                : dom('span',
                  developer?.name ?? t('(Missing info)'),
                  testId('widget-developer'),
                ),
              cssWidgetMetadataValue.cls('-missing', !developer?.name),
              testId('widget-developer'),
            ),
          ),
          cssWidgetMetadataRow(
            cssWidgetMetadataName(t('Last updated:')),
            cssWidgetMetadataValue(
              lastUpdated ?
                new Date(lastUpdated).toLocaleDateString('default', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
                : t('(Missing info)'),
              cssWidgetMetadataValue.cls('-missing', !lastUpdated),
              testId('widget-last-updated'),
            ),
          ),
          testId('widget-metadata'),
        ),
        variant !== 'custom' ? null : cssCustomUrlInput(
          this._customUrl,
          {placeholder: t('Widget URL')},
          testId('custom-url'),
        ),
      ),
      cssWidget.cls('-selected', use => id === use(this._selectedWidgetId)),
      dom.on('click', () => this._selectedWidgetId.set(id)),
      testId('widget'),
      testId(`widget-${variant}`),
    );
  }

  private async _save() {
    if (this._saveDisabled.get()) { return; }

    await this._saveSelectedWidget();
    this._ctl.close();
  }

  private async _deselectOrClose() {
    if (this._selectedWidgetId.get()) {
      this._selectedWidgetId.set(null);
    } else {
      this._ctl.close();
    }
  }

  private async _saveSelectedWidget() {
    await this._gristDoc.docData.bundleActions(
      'Save selected custom widget',
      async () => {
        let section = this._section;
        if (!section) {
          const {addWidget} = this._options;
          if (!addWidget) {
            throw new Error('Cannot add custom widget: missing `addWidget` implementation');
          }

          const {sectionRef} = await addWidget();
          const newSection = this._gristDoc.docModel.viewSections.getRowModel(sectionRef);
          if (!newSection.id.peek()) {
            throw new Error(`Section ${sectionRef} does not exist`);
          }
          section = newSection;
        }
        const selectedWidgetId = this._selectedWidgetId.get();
        if (selectedWidgetId === CUSTOM_URL_WIDGET_ID) {
          return this._saveCustomUrlWidget(section);
        } else {
          return this._saveRemoteWidget(section);
        }
      }
    );
  }

  private async _saveCustomUrlWidget(section: ViewSectionRec) {
    bundleChanges(() => {
      section.customDef.renderAfterReady(false);
      section.customDef.url(this._customUrl.get());
      section.customDef.widgetId(null);
      section.customDef.widgetDef(null);
      section.customDef.pluginId('');
      section.customDef.access(AccessLevel.none);
      section.customDef.widgetOptions(null);
      section.hasCustomOptions(false);
      section.customDef.columnsMapping(null);
      section.columnsToMap(null);
      section.desiredAccessLevel(AccessLevel.none);
    });
    await section.saveCustomDef();
  }

  private async _saveRemoteWidget(section: ViewSectionRec) {
    const [pluginId, widgetId] = this._selectedWidgetId.get()!.split(':');
    const {customDef} = section;
    if (customDef.pluginId.peek() === pluginId && customDef.widgetId.peek() === widgetId) {
      return;
    }

    const selectedWidget = matchWidget(this._widgets.get() ?? [], {widgetId, pluginId});
    if (!selectedWidget) {
      throw new Error(`Widget ${this._selectedWidgetId.get()} not found`);
    }

    bundleChanges(() => {
      section.customDef.renderAfterReady(selectedWidget.renderAfterReady ?? false);
      section.customDef.access(AccessLevel.none);
      section.desiredAccessLevel(selectedWidget.accessLevel ?? AccessLevel.none);
      // Keep a record of the original widget definition.
      // Don't rely on this much, since the document could
      // have moved installation since, and widgets could be
      // served from elsewhere.
      section.customDef.widgetDef(selectedWidget);
      section.customDef.widgetId(selectedWidget.widgetId);
      section.customDef.pluginId(selectedWidget.source?.pluginId ?? '');
      section.customDef.url(null);
      section.customDef.widgetOptions(null);
      section.hasCustomOptions(false);
      section.customDef.columnsMapping(null);
      section.columnsToMap(null);
    });
    await section.saveCustomDef();
  }

  private _maybeClearSelection(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.custom-widget') &&
      !target.closest('button') &&
      !target.closest('a') &&
      !target.closest('input')
    ) {
      this._selectedWidgetId.set(null);
    }
  }
}

export function getWidgetName({name, source}: ICustomWidget) {
  return source?.name ? `${name} (${source.name})` : name;
}

function getWidgetVariant({isGristLabsMaintained = false, widgetId}: ICustomWidget): WidgetVariant {
  if (widgetId === CUSTOM_URL_WIDGET_ID) {
    return 'custom';
  } else if (isGristLabsMaintained) {
    return 'grist';
  } else {
    return 'community';
  }
}

function getWidgetId({source, widgetId}: ICustomWidget) {
  if (widgetId === CUSTOM_URL_WIDGET_ID) {
    return CUSTOM_URL_WIDGET_ID;
  } else {
    return `${source?.pluginId ?? ''}:${widgetId}`;
  }
}

function getWidgetCleanText({name, description, authors = []}: ICustomWidget) {
  let cleanText = name;
  if (description) { cleanText += ` ${description}`; }
  if (authors[0]) { cleanText += ` ${authors[0].name}`; }
  return cleanText;
}

export const cssWidgetMetadata = styled('div', `
  margin-top: auto;
  display: flex;
  flex-direction: column;
  row-gap: 4px;
`);

export const cssWidgetMetadataRow = styled('div', `
  display: flex;
  column-gap: 4px;
`);

export const cssWidgetMetadataName = styled('span', `
  color: ${theme.lightText};
  font-weight: 600;
`);

export const cssWidgetMetadataValue = styled('div', `
  &-missing {
    color: ${theme.lightText};
  }
`);

export const cssDeveloperLink = styled(cssLink, `
  font-weight: 600;
`);

const cssCustomWidgetGallery = styled('div', `
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  outline: none;
`);

const WIDGET_WIDTH_PX = 240;

const WIDGETS_GAP_PX = 16;

const cssHeader = styled('div', `
  display: flex;
  column-gap: 16px;
  row-gap: 8px;
  flex-wrap: wrap;
  justify-content: space-between;
  margin: 40px 40px 16px 40px;

  /* Don't go beyond the final grid column. */
  max-width: ${(3 * WIDGET_WIDTH_PX) + (2 * WIDGETS_GAP_PX)}px;
`);

const cssTitle = styled('div', `
  font-size: 24px;
  font-weight: 500;
  line-height: 32px;
`);

const cssSearchInputWrapper = styled('div', `
  position: relative;
  display: flex;
  align-items: center;
`);

const cssSearchIcon = styled(icon, `
  margin-left: 8px;
  position: absolute;
  --icon-color: ${theme.accentIcon};
`);

const cssSearchInput = styled(textInput, `
  height: 28px;
  padding-left: 32px;
`);

const cssShadowScroll = styled('div', `
  display: flex;
  flex-direction: column;
  flex: unset;
  flex-grow: 1;
  padding: 16px 40px;
`);

const cssCenteredFlexGrow = styled('div', `
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssLoadingSpinner = cssCenteredFlexGrow;

const cssNoMatchingWidgets = styled(cssCenteredFlexGrow, `
  color: ${theme.lightText};
`);

const cssWidgets = styled('div', `
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(0px, ${WIDGET_WIDTH_PX}px));
  gap: ${WIDGETS_GAP_PX}px;
`);

const cssWidget = styled('div', `
  display: flex;
  flex-direction: column;
  box-shadow: 1px 1px 4px 1px ${theme.widgetGalleryShadow};
  border-radius: 4px;
  min-height: 183.5px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.widgetGalleryBgHover};
  }
  &-selected {
    outline: 2px solid ${theme.widgetGalleryBorderSelected};
    outline-offset: -2px;
  }
`);

const cssWidgetHeader = styled('div', `
  flex-shrink: 0;
  border: 2px solid ${theme.widgetGalleryBorder};
  border-bottom: 1px solid ${theme.widgetGalleryBorder};
  border-radius: 4px 4px 0px 0px;
  color: ${theme.lightText};
  font-size: 10px;
  line-height: 16px;
  font-weight: 500;
  padding: 4px 18px;
  text-transform: uppercase;

  &-secondary {
    border: 0px;
    color: ${theme.widgetGallerySecondaryHeaderFg};
    background-color: ${theme.widgetGallerySecondaryHeaderBg};
  }
  .${cssWidget.className}:hover &-secondary {
    background-color: ${theme.widgetGallerySecondaryHeaderBgHover};
  }
`);

const cssWidgetBody = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  border: 2px solid ${theme.widgetGalleryBorder};
  border-top: 0px;
  border-radius: 0px 0px 4px 4px;
  padding: 16px;
`);

const cssWidgetName = styled('div', `
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
`);

const cssWidgetDescription = styled('div', `
  margin-bottom: 24px;

  &-missing {
    color: ${theme.lightText};
  }
`);

const cssCustomUrlInput = styled(textInput, `
  height: 28px;
`);

const cssHelpLink = styled(cssLink, `
  display: inline-flex;
  align-items: center;
  column-gap: 8px;
`);

const cssHelpIcon = styled(icon, `
  flex-shrink: 0;
`);

const cssFooter = styled('div', `
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 40px;
  border-top: 1px solid ${theme.widgetGalleryBorder};
`);

const cssFooterButtons = styled('div', `
  display: flex;
  column-gap: 8px;
`);

const cssModal = styled('div', `
  width: 100%;
  height: 100%;
  max-width: 930px;
  max-height: 623px;
  padding: 0px;
`);

const cssTooltipIcon = styled('div', `
  color: ${theme.widgetGallerySecondaryHeaderFg};
  border-color: ${theme.widgetGallerySecondaryHeaderFg};
`);
