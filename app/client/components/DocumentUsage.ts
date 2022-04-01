import {DocPageModel} from 'app/client/models/DocPageModel';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {colors, mediaXSmall} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {DataLimitStatus} from 'app/common/ActiveDocAPI';
import {commonUrls} from 'app/common/gristUrls';
import {Computed, Disposable, dom, IDisposableOwner, Observable, styled} from 'grainjs';

const limitStatusMessages: Record<NonNullable<DataLimitStatus>, string> = {
  approachingLimit: 'This document is approaching free plan limits.',
  deleteOnly: 'This document is now in delete-only mode.',
  gracePeriod: 'This document has exceeded free plan limits.',
};

/**
 * Displays statistics about document usage, such as number of rows used.
 *
 * Currently only shows usage if current site is a free team site.
 */
export class DocumentUsage extends Disposable {
  constructor(private _docPageModel: DocPageModel) {
    super();
  }

  public buildDom() {
    const features = this._docPageModel.appModel.currentFeatures;
    if (features.baseMaxRowsPerDocument === undefined) { return null; }

    return dom('div',
      cssHeader('Usage'),
      dom.domComputed(this._docPageModel.dataLimitStatus, status => {
        if (!status) { return null; }

        return cssLimitWarning(
          cssIcon('Idea'),
          cssLightlyBoldedText(
            limitStatusMessages[status],
            ' For higher limits, ',
            cssUnderlinedLink('start your 30-day free trial of the Pro plan.', {
              href: commonUrls.plans,
              target: '_blank',
            }),
          ),
        );
      }),
      cssUsageMetrics(
        dom.create(buildUsageMetric, {
          name: 'Rows',
          currentValue: this._docPageModel.rowCount,
          maximumValue: features.baseMaxRowsPerDocument,
          units: 'rows',
        }),
      )
    );
  }
}

/**
 * Builds a component which displays the current and maximum values for
 * a particular metric (e.g. rows), and a progress meter showing how
 * close `currentValue` is to hitting `maximumValue`.
 */
function buildUsageMetric(owner: IDisposableOwner, {name, currentValue, maximumValue, units}: {
  name: string;
  currentValue: Observable<number | undefined>;
  maximumValue: number;
  units?: string;
}) {
  const percentUsed = Computed.create(owner, currentValue, (_use, value) => {
    return Math.min(100, Math.floor(((value ?? 0) / maximumValue) * 100));
  });
  return cssUsageMetric(
    cssMetricName(name),
    cssProgressBarContainer(
      cssProgressBarFill(
        dom.style('width', use => `${use(percentUsed)}%`),
        cssProgressBarFill.cls('-approaching-limit', use => use(percentUsed) >= 90)
      )
    ),
    dom.maybe(currentValue, value =>
      dom('div', `${value} of ${maximumValue}` + (units ? ` ${units}` : ''))
    ),
  );
}

const cssLightlyBoldedText = styled('div', `
  font-weight: 500;
`);

const cssIconAndText = styled('div', `
  display: flex;
  gap: 16px;
`);

const cssLimitWarning = styled(cssIconAndText, `
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
  display: inline-block;
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
