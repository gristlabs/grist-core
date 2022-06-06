import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {infoTooltip} from 'app/client/ui/tooltips';
import {colors, mediaXSmall} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {APPROACHING_LIMIT_RATIO, DataLimitStatus} from 'app/common/DocUsage';
import {Features, isFreeProduct} from 'app/common/Features';
import {commonUrls} from 'app/common/gristUrls';
import {capitalizeFirstWord} from 'app/common/gutil';
import {canUpgradeOrg} from 'app/common/roles';
import {Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-doc-usage-');

// Default used by the progress bar to visually indicate row usage.
const DEFAULT_MAX_ROWS = 20000;

// Default used by the progress bar to visually indicate data size usage.
const DEFAULT_MAX_DATA_SIZE = DEFAULT_MAX_ROWS * 2 * 1024; // 40MB (2KiB per row)

// Default used by the progress bar to visually indicate attachments size usage.
const DEFAULT_MAX_ATTACHMENTS_SIZE = 1 * 1024 * 1024 * 1024; // 1GiB

const ACCESS_DENIED_MESSAGE = 'Usage statistics are only available to users with '
  + 'full access to the document data.';

/**
 * Displays statistics about document usage, such as number of rows used.
 */
export class DocumentUsage extends Disposable {
  private readonly _currentDoc = this._docPageModel.currentDoc;
  private readonly _currentDocUsage = this._docPageModel.currentDocUsage;
  private readonly _currentOrg = this._docPageModel.currentOrg;
  private readonly _currentProduct = this._docPageModel.currentProduct;

  private readonly _dataLimitStatus = Computed.create(this, this._currentDocUsage, (_use, usage) => {
    return usage?.dataLimitStatus ?? null;
  });

  private readonly _rowCount = Computed.create(this, this._currentDocUsage, (_use, usage) => {
    return usage?.rowCount;
  });

  private readonly _dataSizeBytes = Computed.create(this, this._currentDocUsage, (_use, usage) => {
    return usage?.dataSizeBytes;
  });

  private readonly _attachmentsSizeBytes = Computed.create(this, this._currentDocUsage, (_use, usage) => {
    return usage?.attachmentsSizeBytes;
  });

  private readonly _rowMetrics: Computed<MetricOptions | null> =
    Computed.create(this, this._currentProduct, this._rowCount, (_use, product, rowCount) => {
      const features = product?.features;
      if (!features || typeof rowCount !== 'number') { return null; }

      const {baseMaxRowsPerDocument: maxRows} = features;
      // Invalid row limits are currently treated as if they are undefined.
      const maxValue = maxRows && maxRows > 0 ? maxRows : undefined;
      return {
        name: 'Rows',
        currentValue: rowCount,
        maximumValue: maxValue ?? DEFAULT_MAX_ROWS,
        unit: 'rows',
        shouldHideLimits: maxValue === undefined,
      };
    });

  private readonly _dataSizeMetrics: Computed<MetricOptions | null> =
    Computed.create(this, this._currentProduct, this._dataSizeBytes, (_use, product, dataSize) => {
      const features = product?.features;
      if (!features || typeof dataSize !== 'number') { return null; }

      const {baseMaxDataSizePerDocument: maxSize} = features;
      // Invalid data size limits are currently treated as if they are undefined.
      const maxValue = maxSize && maxSize > 0 ? maxSize : undefined;
      return {
        name: 'Data Size',
        currentValue: dataSize,
        maximumValue: maxValue ?? DEFAULT_MAX_DATA_SIZE,
        unit: 'MB',
        shouldHideLimits: maxValue === undefined,
        tooltipContent: () => cssTooltipBody(
          dom('div', 'The total size of all data in this document, excluding attachments.'),
          dom('div', 'Updates every 5 minutes.'),
        ),
        formatValue: (val) => {
          // To display a nice, round number for `maximumValue`, we first convert
          // to KiBs (base-2), and then convert to MBs (base-10). Normally, we wouldn't
          // mix conversions like this, but to display something that matches our
          // marketing limits (e.g. 40MB for Pro plan), we need to bend conversions a bit.
          return ((val / 1024) / 1000).toFixed(2);
        },
      };
    });

  private readonly _attachmentsSizeMetrics: Computed<MetricOptions | null> =
    Computed.create(this, this._currentProduct, this._attachmentsSizeBytes, (_use, product, attachmentsSize) => {
      const features = product?.features;
      if (!features || typeof attachmentsSize !== 'number') { return null; }

      const {baseMaxAttachmentsBytesPerDocument: maxSize} = features;
      // Invalid attachments size limits are currently treated as if they are undefined.
      const maxValue = maxSize && maxSize > 0 ? maxSize : undefined;
      return {
        name: 'Attachments Size',
        currentValue: attachmentsSize,
        maximumValue: maxValue ?? DEFAULT_MAX_ATTACHMENTS_SIZE,
        unit: 'GB',
        shouldHideLimits: maxValue === undefined,
        formatValue: (val) => (val / (1024 * 1024 * 1024)).toFixed(2),
      };
    });

  private readonly _isLoading: Computed<boolean> =
    Computed.create(
      this, this._currentDoc, this._rowCount, this._dataSizeBytes, this._attachmentsSizeBytes,
      (_use, doc, rowCount, dataSize, attachmentsSize) => {
        return !doc || [rowCount, dataSize, attachmentsSize].some(metric => {
          return metric === 'pending' || metric === undefined;
        });
      }
    );

  private readonly _isAccessDenied: Computed<boolean | null> =
    Computed.create(
      this, this._isLoading, this._currentDoc, this._rowCount, this._dataSizeBytes, this._attachmentsSizeBytes,
      (_use, isLoading, doc, rowCount, dataSize, attachmentsSize) => {
        if (isLoading) { return null; }

        const {access} = doc!.workspace.org;
        const isPublicUser = access === 'guests' || access === null;
        return isPublicUser || [rowCount, dataSize, attachmentsSize].some(metric => metric === 'hidden');
      }
    );

  constructor(private _docPageModel: DocPageModel) {
    super();
  }

  public buildDom() {
    return dom('div',
      cssHeader('Usage', testId('heading')),
      dom.domComputed(this._isLoading, (isLoading) => {
        if (isLoading) { return cssSpinner(loadingSpinner(), testId('loading')); }

        return [this._buildMessage(), this._buildMetrics()];
      }),
      testId('container'),
    );
  }

  private _buildMessage() {
    return dom.domComputed((use) => {
      const isAccessDenied = use(this._isAccessDenied);
      if (isAccessDenied === null) { return null; }
      if (isAccessDenied) { return buildMessage(ACCESS_DENIED_MESSAGE); }

      const org = use(this._currentOrg);
      const product = use(this._currentProduct);
      const status = use(this._dataLimitStatus);
      if (!org || !status) { return null; }

      return buildMessage([
        buildLimitStatusMessage(status, product?.features, {
          disableRawDataLink: true
        }),
        (product && isFreeProduct(product)
          ? [' ', buildUpgradeMessage(canUpgradeOrg(org))]
          : null
        ),
      ]);
    });
  }

  private _buildMetrics() {
    return dom.maybe(use => use(this._isAccessDenied) === false, () =>
      cssUsageMetrics(
        dom.maybe(this._rowMetrics, (metrics) =>
          buildUsageMetric(metrics, testId('rows')),
        ),
        dom.maybe(this._dataSizeMetrics, (metrics) =>
          buildUsageMetric(metrics, testId('data-size')),
        ),
        dom.maybe(this._attachmentsSizeMetrics, (metrics) =>
          buildUsageMetric(metrics, testId('attachments-size')),
        ),
        testId('metrics'),
      ),
    );
  }
}

export function buildLimitStatusMessage(
  status: NonNullable<DataLimitStatus>,
  features?: Features,
  options: {
    disableRawDataLink?: boolean;
  } = {}
) {
  const {disableRawDataLink = false} = options;
  switch (status) {
    case 'approachingLimit': {
      return [
        'This document is ',
        disableRawDataLink ? 'approaching' : buildRawDataPageLink('approaching'),
        ' free plan limits.'
      ];
    }
    case 'gracePeriod': {
      const gracePeriodDays = features?.gracePeriodDays;
      if (!gracePeriodDays) {
        return [
          'Document limits ',
          disableRawDataLink ? 'exceeded' : buildRawDataPageLink('exceeded'),
          '.'
        ];
      }

      return [
        'Document limits ',
        disableRawDataLink ? 'exceeded' : buildRawDataPageLink('exceeded'),
        `. In ${gracePeriodDays} days, this document will be read-only.`
      ];
    }
    case 'deleteOnly': {
      return [
        'This document ',
        disableRawDataLink ? 'exceeded' : buildRawDataPageLink('exceeded'),
        ' free plan limits and is now read-only, but you can delete rows.'
      ];
    }
  }
}

export function buildUpgradeMessage(canUpgrade: boolean, variant: 'short' | 'long' = 'long') {
  if (!canUpgrade) { return 'Contact the site owner to upgrade the plan to raise limits.'; }

  const upgradeLinkText = 'start your 30-day free trial of the Pro plan.';
  return [
    variant === 'short' ? null : 'For higher limits, ',
    buildUpgradeLink(variant === 'short' ? capitalizeFirstWord(upgradeLinkText) : upgradeLinkText),
  ];
}

function buildUpgradeLink(linkText: string) {
  return cssUnderlinedLink(linkText, {
    href: commonUrls.plans,
    target: '_blank',
  });
}

function buildRawDataPageLink(linkText: string) {
  return cssUnderlinedLink(linkText, urlState().setLinkUrl({docPage: 'data'}));
}

interface MetricOptions {
  name: string;
  currentValue: number;
  // If undefined or non-positive (i.e. invalid), no limits will be assumed.
  maximumValue?: number;
  unit?: string;
  // If true, limits will always be hidden, even if `maximumValue` is a positive number.
  shouldHideLimits?: boolean;
  // Shows an icon next to the metric name that displays a tooltip on hover.
  tooltipContent?(): DomContents;
  formatValue?(value: number): string;
}

/**
 * Builds a component which displays the current and maximum values for
 * a particular metric (e.g. row count), and a progress meter showing how
 * close `currentValue` is to hitting `maximumValue`.
 */
function buildUsageMetric(options: MetricOptions, ...domArgs: DomElementArg[]) {
  const {
    name,
    currentValue,
    maximumValue,
    unit,
    shouldHideLimits,
    tooltipContent,
    formatValue = (val) => val.toString(),
  } = options;
  const ratioUsed = currentValue / (maximumValue || Infinity);
  const percentUsed = Math.min(100, Math.floor(ratioUsed * 100));
  return cssUsageMetric(
    cssMetricName(
      cssOverflowableText(name, testId('name')),
      tooltipContent ? infoTooltip(tooltipContent()) : null,
    ),
    cssProgressBarContainer(
      cssProgressBarFill(
        {style: `width: ${percentUsed}%`},
        // Change progress bar to red if close to limit, unless limits are hidden.
        shouldHideLimits || ratioUsed <= APPROACHING_LIMIT_RATIO
          ? null
          : cssProgressBarFill.cls('-approaching-limit'),
        testId('progress-fill'),
      ),
    ),
    dom('div',
      formatValue(currentValue)
        + (shouldHideLimits || !maximumValue ? '' : ' of ' + formatValue(maximumValue))
        + (unit ? ` ${unit}` : ''),
      testId('value'),
    ),
    ...domArgs,
  );
}

function buildMessage(message: DomContents) {
  return cssWarningMessage(
    cssIcon('Idea'),
    cssLightlyBoldedText(message, testId('message-text')),
    testId('message'),
  );
}

const cssLightlyBoldedText = styled('div', `
  font-weight: 500;
`);

const cssIconAndText = styled('div', `
  display: flex;
  gap: 16px;
`);

const cssWarningMessage = styled(cssIconAndText, `
  margin-top: 16px;
`);

const cssIcon = styled(icon, `
  flex-shrink: 0;
  width: 16px;
  height: 16px;
`);

const cssMetricName = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
`);

const cssOverflowableText = styled('span', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`);

const cssHeader = styled(docListHeader, `
  margin-bottom: 0px;
`);

const cssUnderlinedLink = styled(cssLink, `
  color: unset;
  text-decoration: underline;

  &:hover, &:focus {
    color: unset;
  }
`);

const cssUsageMetrics = styled('div', `
  display: flex;
  flex-wrap: wrap;
  margin-top: 24px;
  row-gap: 24px;
  column-gap: 54px;
`);

const cssUsageMetric = styled('div', `
  display: flex;
  flex-direction: column;
  width: 180px;
  gap: 8px;

  @media ${mediaXSmall} {
    & {
      width: 100%;
    }
  }
`);

const cssProgressBarContainer = styled('div', `
  width: 100%;
  height: 4px;
  border-radius: 5px;
  background: ${colors.darkGrey};
`);

const cssProgressBarFill = styled(cssProgressBarContainer, `
  background: ${colors.lightGreen};

  &-approaching-limit {
    background: ${colors.error};
  }
`);

const cssSpinner = styled('div', `
  display: flex;
  justify-content: center;
  margin-top: 32px;
`);

const cssTooltipBody = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);
