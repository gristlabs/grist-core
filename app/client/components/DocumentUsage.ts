import {DocPageModel} from 'app/client/models/DocPageModel';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {colors, mediaXSmall} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {Features} from 'app/common/Features';
import {commonUrls} from 'app/common/gristUrls';
import {capitalizeFirstWord} from 'app/common/gutil';
import {APPROACHING_LIMIT_RATIO, DataLimitStatus} from 'app/common/Usage';
import {Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-doc-usage-');

// Default used by the progress bar to visually indicate row usage.
const DEFAULT_MAX_ROWS = 20000;

const ACCESS_DENIED_MESSAGE = 'Usage statistics are only available to users with '
  + 'full access to the document data.';

/**
 * Displays statistics about document usage, such as number of rows used.
 */
export class DocumentUsage extends Disposable {
  private readonly _currentDoc = this._docPageModel.currentDoc;
  private readonly _dataLimitStatus = this._docPageModel.dataLimitStatus;
  private readonly _rowCount = this._docPageModel.rowCount;

  private readonly _currentOrg = Computed.create(this, this._currentDoc, (_use, doc) => {
    return doc?.workspace.org ?? null;
  });

  private readonly _rowMetrics: Computed<MetricOptions | null> =
    Computed.create(this, this._currentOrg, this._rowCount, (_use, org, rowCount) => {
      const features = org?.billingAccount?.product.features;
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

  private readonly _isLoading: Computed<boolean> =
    Computed.create(this, this._currentDoc, this._rowCount, (_use, doc, rowCount) => {
      return doc === null || rowCount === 'pending';
    });

  private readonly _isAccessDenied: Computed<boolean | null> =
    Computed.create(
      this, this._isLoading, this._currentDoc, this._rowCount,
      (_use, isLoading, doc, rowCount) => {
        if (isLoading) { return null; }

        const {access} = doc!.workspace.org;
        const isPublicUser = access === 'guests' || access === null;
        return isPublicUser || rowCount === 'hidden';
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
      const status = use(this._dataLimitStatus);
      if (!org || !status) { return null; }

      return buildMessage([
        getLimitStatusMessage(status, org.billingAccount?.product.features),
        ' ',
        buildUpgradeMessage(org.access === 'owners')
      ]);
    });
  }

  private _buildMetrics() {
    return dom.maybe(use => use(this._isAccessDenied) === false, () =>
      cssUsageMetrics(
        dom.maybe(this._rowMetrics, (metrics) =>
          buildUsageMetric(metrics, testId('rows')),
        ),
        testId('metrics'),
      ),
    );
  }
}

function buildMessage(message: DomContents) {
  return cssWarningMessage(
    cssIcon('Idea'),
    cssLightlyBoldedText(message, testId('message-text')),
    testId('message'),
  );
}

interface MetricOptions {
  name: string;
  currentValue: number;
  // If undefined or non-positive (i.e. invalid), no limits will be assumed.
  maximumValue?: number;
  unit?: string;
  // If true, limits will always be hidden, even if `maximumValue` is a positive number.
  shouldHideLimits?: boolean;
}

/**
 * Builds a component which displays the current and maximum values for
 * a particular metric (e.g. row count), and a progress meter showing how
 * close `currentValue` is to hitting `maximumValue`.
 */
function buildUsageMetric(options: MetricOptions, ...domArgs: DomElementArg[]) {
  const {name, currentValue, maximumValue, unit, shouldHideLimits} = options;
  const ratioUsed = currentValue / (maximumValue || Infinity);
  const percentUsed = Math.min(100, Math.floor(ratioUsed * 100));
  return cssUsageMetric(
    cssMetricName(name, testId('name')),
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
      currentValue
        + (shouldHideLimits || !maximumValue ? '' : ' of ' + maximumValue)
        + (unit ? ` ${unit}` : ''),
      testId('value'),
    ),
    ...domArgs,
  );
}

export function getLimitStatusMessage(status: NonNullable<DataLimitStatus>, features?: Features): string {
  switch (status) {
    case 'approachingLimit': {
      return 'This document is approaching free plan limits.';
    }
    case 'gracePeriod': {
      const gracePeriodDays = features?.gracePeriodDays;
      if (!gracePeriodDays) { return 'Document limits exceeded.'; }

      return `Document limits exceeded. In ${gracePeriodDays} days, this document will be read-only.`;
    }
    case 'deleteOnly': {
      return 'This document exceeded free plan limits and is now read-only, but you can delete rows.';
    }
  }
}

export function buildUpgradeMessage(isOwner: boolean, variant: 'short' | 'long' = 'long') {
  if (!isOwner) { return 'Contact the site owner to upgrade the plan to raise limits.'; }

  const upgradeLinkText = 'start your 30-day free trial of the Pro plan.';
  return [
    variant === 'short' ? null : 'For higher limits, ',
    buildUpgradeLink(variant === 'short' ? capitalizeFirstWord(upgradeLinkText) : upgradeLinkText),
  ];
}

export function buildUpgradeLink(linkText: string) {
  return cssUnderlinedLink(linkText, {
    href: commonUrls.plans,
    target: '_blank',
  });
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
  font-weight: 700;
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
  gap: 56px;

  @media ${mediaXSmall} {
    & {
      gap: 24px;
    }
  }
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
