import {buildHomeBanners} from 'app/client/components/Banners';
import {beaconOpenMessage} from 'app/client/lib/helpScout';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {BillingModel, BillingModelImpl, ISubscriptionModel} from 'app/client/models/BillingModel';
import {urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {BillingForm, IFormData} from 'app/client/ui/BillingForm';
import * as css from 'app/client/ui/BillingPageCss';
import {BillingPlanManagers} from 'app/client/ui/BillingPlanManagers';
import {createForbiddenPage} from 'app/client/ui/errorPages';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {showTeamUpgradeConfirmation} from 'app/client/ui/ProductUpgrades';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, cssBreadcrumbsLink, separator} from 'app/client/ui2018/breadcrumbs';
import {bigBasicButton, bigBasicButtonLink, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {confirmModal} from 'app/client/ui2018/modals';
import {BillingTask, IBillingCoupon} from 'app/common/BillingAPI';
import {displayPlanName, TEAM_FREE_PLAN, TEAM_PLAN} from 'app/common/Features';
import {capitalize} from 'app/common/gutil';
import {Organization} from 'app/common/UserAPI';
import {Disposable, dom, DomArg, IAttrObj, makeTestId, Observable} from 'grainjs';

const testId = makeTestId('test-bp-');
const billingTasksNames = {
  signUp: 'Sign Up', // task for payment page
  signUpLite: 'Complete Sign Up', // task for payment page
  updateDomain: 'Update Name', // task for summary page
  cancelPlan: 'Cancel plan', // this is not a task, but a sub page
  upgraded: 'Account',
};

/**
 * Creates the billing page where users can manage their subscription and payment card.
 */
export class BillingPage extends Disposable {
  private _model: BillingModel = new BillingModelImpl(this._appModel);
  private _form: BillingForm | undefined = undefined;
  private _formData: IFormData = {};
  private _showConfirmPage: Observable<boolean> = Observable.create(this, false);
  private _isSubmitting: Observable<boolean> = Observable.create(this, false);

  constructor(private _appModel: AppModel) {
    super();
    this._appModel.refreshOrgUsage().catch(reportError);
  }

  // Exposed for tests.
  public testBuildPaymentPage() {
    return this._buildPaymentPage();
  }

  public buildDom() {
    return dom.domComputed(this._model.isUnauthorized, (isUnauthorized) => {
      if (isUnauthorized) {
        return createForbiddenPage(this._appModel,
          'Only billing plan managers may view billing account information. Plan managers may ' +
          'be added in the billing summary by existing plan managers.');
      } else {
        const panelOpen = Observable.create(this, false);
        return pagePanels({
          leftPanel: {
            panelWidth: Observable.create(this, 240),
            panelOpen,
            hideOpener: true,
            header: dom.create(AppHeader, this._appModel.currentOrgName, this._appModel),
            content: leftPanelBasic(this._appModel, panelOpen),
          },
          headerMain: this._createTopBarBilling(),
          contentTop: buildHomeBanners(this._appModel),
          contentMain: this._buildCurrentPageDom()
        });
      }
    });
  }

  /**
   * Builds the contentMain dom for the current billing page.
   */
  private _buildCurrentPageDom() {
    const page = css.billingWrapper(
      dom.domComputed(this._model.currentSubpage, (subpage) => {
        if (!subpage) {
          return this._buildSummaryPage();
        } else if (subpage === 'payment') {
          return this._buildPaymentPage();
        }
      })
    );
    if (this._model.currentTask.get() === 'upgraded') {
      urlState().pushUrl({params: {}}, { replace: true }).catch(() => {});
      showTeamUpgradeConfirmation(this);
    }
    return page;
  }

  private _buildSummaryPage() {
    const org = this._appModel.currentOrg;
    // Fetch plan and card data.
    this._model.fetchData(true).catch(reportError);
    return css.billingPage(
      dom.domComputed(this._model.currentTask, (task) => {
        const pageText = task ? billingTasksNames[task] : 'Account';
        return [
          css.cardBlock(
            css.billingHeader(pageText),
            task !== 'updateDomain' ? [
              dom.domComputed(this._model.subscription, () => [
                this._buildDomainSummary(org ?? {}),
              ]),
              // If this is not a personal org, create the plan manager list dom.
              org && !org.owner ? dom.frag(
                css.billingHeader('Plan Managers', { style: 'margin: 32px 0 16px 0;' }),
                css.billingHintText(
                  'You may add additional billing contacts (for example, your accounting department). ' +
                  'All billing-related emails will be sent to this list of contacts.'
                ),
                dom.create(BillingPlanManagers, this._model, org, this._appModel.currentValidUser)
              ) : null
            ] : dom.domComputed(this._showConfirmPage, (showConfirm) => {
              if (showConfirm) {
                return [
                  this._buildConfirm(this._formData),
                  this._buildButtons(pageText)
                ];
              } else {
                return this._buildForms(org, task);
              }
            })
          ),
          css.summaryBlock(
            css.billingHeader('Billing Summary'),
            this._buildSubscriptionSummary(),
          )
        ];
      })
    );
  }

  // PRIVATE - exposed for tests
  private _buildPaymentPage() {
    const org = this._appModel.currentOrg;
    // Fetch plan and card data if not already present.
    this._model.fetchData().catch(this._model.reportBlockingError);
    return css.billingPage(
      dom.maybe(this._model.currentTask, task => {
        const pageText = billingTasksNames[task];
        return [
          css.cardBlock(
            css.billingHeader(pageText),
            dom.domComputed((use) => {
              const err = use(this._model.error);
              if (err) {
                return css.errorBox(err, dom('br'), dom('br'), reportLink(this._appModel, "Report problem"));
              }
              const sub = use(this._model.subscription);
              if (!sub) {
                return css.spinnerBox(loadingSpinner());
              }
              if (task === 'cancelPlan') {
                // If the selected plan is free, the user is cancelling their subscription.
                return [
                  css.paymentBlock(
                    'On the subscription end date, your team site will remain available in ' +
                    'read-only mode for one month.',
                  ),
                  css.paymentBlock(
                    'After the one month grace period, your team site will be removed along ' +
                    'with all documents inside.'
                  ),
                  css.paymentBlock('Are you sure you would like to cancel the subscription?'),
                  this._buildButtons('Cancel Subscription')
                ];
              } else { // tasks - signUpLite
                return dom.domComputed(this._showConfirmPage, (showConfirm) => {
                  if (showConfirm) {
                    return [
                      this._buildConfirm(this._formData),
                      this._buildButtons(pageText)
                    ];
                  } else {
                    return this._buildForms(org, task);
                  }
                });
              }
            })
          ),
          css.summaryBlock(
            css.billingHeader('Summary'),
            css.summaryFeatures(
              this._buildPaymentSummary(task),
              testId('summary')
            )
          )
        ];
      })
    );
  }

  private _buildSubscriptionSummary() {
    return dom.domComputed(this._model.subscription, sub => {
      if (!sub) {
        return css.spinnerBox(loadingSpinner());
      } else {
        const moneyPlan = sub.upcomingPlan || sub.activePlan;
        const changingPlan = sub.upcomingPlan && sub.upcomingPlan.amount > 0;
        const cancellingPlan = sub.upcomingPlan && sub.upcomingPlan.amount === 0;
        const validPlan = sub.isValidPlan;
        const discountName = sub.discount && sub.discount.name;
        const discountEnd = sub.discount && sub.discount.end_timestamp_ms;
        const tier = discountName && discountName.includes(' Tier ');
        const activePlanName = sub.activePlan?.nickname ??
          displayPlanName[this._appModel.planName || ''] ?? this._appModel.planName;
        const planName = tier ? discountName : activePlanName;
        const appSumoInvoiced = this._appModel.currentOrg?.billingAccount?.externalOptions?.invoiceId;
        const isPaidPlan = sub.billable;
        // If subscription is canceled, we need to create a new one using Stripe Checkout.
        const canRenew = (sub.status === 'canceled' && isPaidPlan);
        // We can upgrade only free team plan at this moment.
        const canUpgrade = !canRenew && !isPaidPlan;
        // And we can manage team plan that is not canceled.
        const canManage = !canRenew && isPaidPlan;
        const isCanceled = sub.status === 'canceled';
        const wasTeam = this._appModel.planName === TEAM_PLAN && isCanceled && !validPlan;
        return [
          css.summaryFeatures(
            validPlan && planName ? [
              makeSummaryFeature(['You are subscribed to the ', planName, ' plan'])
            ] : [
                isCanceled ?
                makeSummaryFeature(['You were subscribed to the ', planName, ' plan'], { isBad: true }) :
                makeSummaryFeature(['This team site is not in good standing'], { isBad: true }),
              ],
            // If the plan is changing, include the date the current plan ends
            // and the plan that will be in effect afterwards.
            changingPlan && isPaidPlan ? [
              makeSummaryFeature(['Your current plan ends on ', dateFmt(sub.periodEnd)]),
              makeSummaryFeature(['On this date, you will be subscribed to the ',
                sub.upcomingPlan?.nickname ?? '-', ' plan'])
            ] : null,
            cancellingPlan && isPaidPlan ? [
              makeSummaryFeature(['Your subscription ends on ', dateFmt(sub.periodEnd)]),
              makeSummaryFeature(['On this date, your team site will become read-only'])
            ] : null,
            moneyPlan?.amount ? [
              makeSummaryFeature([`Your team site has `, `${sub.userCount}`,
                ` member${sub.userCount !== 1 ? 's' : ''}`]),
              tier ? this._makeAppSumoFeature(discountName) : null,
              // Currently the subtotal is misleading and scary when tiers are in effect.
              // In this case, for now, just report what will be invoiced.
              !tier ? makeSummaryFeature([`Your ${moneyPlan.interval}ly subtotal is `,
              getPriceString(moneyPlan.amount * sub.userCount)]) : null,
              (discountName && !tier) ?
                makeSummaryFeature([
                  `You receive the `,
                  discountName,
                  ...(discountEnd !== null ? [' (until ', dateFmtFull(discountEnd), ')'] : []),
                ]) :
                null,
              // When on a free trial, Stripe reports trialEnd time, but it seems to always
              // match periodEnd for a trialing subscription, so we just use that.
              sub.isInTrial ? makeSummaryFeature(['Your free trial ends on ', dateFmtFull(sub.periodEnd)]) : null,
              makeSummaryFeature([`Your next invoice is `, getPriceString(sub.nextTotal),
                ' on ', dateFmt(sub.periodEnd)]),
            ] : null,
            appSumoInvoiced ? makeAppSumoLink(appSumoInvoiced) : null,
            getSubscriptionProblem(sub),
            testId('summary')
          ),
          !canManage ? null :
            makeActionLink('Manage billing', 'Settings', this._model.getCustomerPortalUrl(), testId('portal-link')),
          !wasTeam ? null :
          makeActionButton('Downgrade plan', 'Settings',
            () => this._confirmDowngradeToTeamFree(), testId('downgrade-free-link')),
          !canRenew ? null :
            makeActionLink('Renew subscription', 'Settings', this._model.renewPlan(), testId('renew-link')),
          !canUpgrade ? null :
            makeActionButton('Upgrade subscription', 'Settings',
              () => this._appModel.showUpgradeModal(), testId('upgrade-link')),
          !(validPlan && planName && isPaidPlan && !cancellingPlan) ? null :
            makeActionLink(
              'Cancel subscription',
              'Settings',
              urlState().setLinkUrl({
                billing: 'payment',
                params: {
                  billingTask: 'cancelPlan'
                }
              }),
              testId('cancel-subscription')
            ),
          (sub.lastInvoiceUrl && sub.activeSubscription ?
            makeActionLink('View last invoice', 'Page', sub.lastInvoiceUrl, testId('invoice-link'))
            : null
          ),
        ];
      }
    });
  }

  private _confirmDowngradeToTeamFree() {
    confirmModal('Downgrade to Free Team Plan',
      'Downgrade',
      () => this._downgradeToTeamFree(),
      dom('div', {style: `color: ${colors.dark}`}, testId('downgrade-confirm-modal'),
        dom('div', 'Documents on free team plan are subject to the following limits. '
                  +'Any documents in excess of these limits will be put in read-only mode.'),
        dom('ul',
          dom('li', { style: 'margin-bottom: 0.6em'}, dom('strong', '5,000'), ' rows per document'),
          dom('li', { style: 'margin-bottom: 0.6em'}, dom('strong', '10MB'), ' max document size'),
          dom('li', 'API limit: ', dom('strong', '5k'), ' calls/day'),
        )
      ),
    );
  }

  private async _downgradeToTeamFree() {
    // Perform the downgrade operation.
    await this._model.downgradePlan(TEAM_FREE_PLAN);
    // Refresh app model
    this._appModel.topAppModel.initialize();
  }

  private _makeAppSumoFeature(name: string) {
    // TODO: move AppSumo plan knowledge elsewhere.
    let users = 0;
    switch (name) {
      case 'AppSumo Tier 1':
        users = 1;
        break;
      case 'AppSumo Tier 2':
        users = 3;
        break;
      case 'AppSumo Tier 3':
        users = 8;
        break;
    }
    if (users > 0) {
      return makeSummaryFeature([`Your AppSumo plan covers `,
        `${users}`,
        ` member${users > 1 ? 's' : ''}`]);
    }
    return null;
  }

  private _buildForms(org: Organization | null, task: BillingTask) {
    const isTeamSite = org && org.billingAccount && !org.billingAccount.individual;
    const currentSettings = this._formData.settings ?? {
      name: org!.name,
      domain: org?.domain?.startsWith('o-') ? undefined : org?.domain || undefined,
    };
    const pageText = billingTasksNames[task];
    // If there is an immediate charge required, require re-entering the card info.
    // Show all forms on sign up.
    this._form = new BillingForm(
      org,
      this._model,
      {
        settings: ['signUpLite', 'updateDomain'].includes(task),
        domain: ['signUpLite', 'updateDomain'].includes(task)
      },
      {
        settings: currentSettings,
      }
    );
    return dom('div',
      dom.onDispose(() => {
        if (this._form) {
          this._form.dispose();
          this._form = undefined;
        }
      }),
      isTeamSite ? this._buildDomainSummary(currentSettings ?? {}) : null,
      this._form.buildDom(),
      this._buildButtons(pageText)
    );
  }

  private _buildConfirm(formData: IFormData) {
    const settings = formData.settings || null;
    return [
      this._buildDomainConfirmation(settings ?? {}, false),
    ];
  }

  private _createTopBarBilling() {
    const org = this._appModel.currentOrg;
    return dom.frag(
      cssBreadcrumbs({ style: 'margin-left: 16px;' },
        cssBreadcrumbsLink(
          urlState().setLinkUrl({}),
          'Home',
          testId('home')
        ),
        separator(' / '),
        dom.domComputed(this._model.currentSubpage, (subpage) => {
          if (subpage) {
            return [
              // Prevent navigating to the summary page if these pages are not associated with an org.
              org && !org.owner ? cssBreadcrumbsLink(
                urlState().setLinkUrl({ billing: 'billing' }),
                'Billing',
                testId('billing')
              ) : dom('span', 'Billing'),
              separator(' / '),
              dom('span', capitalize(subpage))
            ];
          } else {
            return dom('span', 'Billing');
          }
        })
      ),
      createTopBarHome(this._appModel),
    );
  }

  private _buildDomainConfirmation(org: { name?: string | null, domain?: string | null }, showEdit: boolean = true) {
    return css.summaryItem(
      css.summaryHeader(
        css.billingBoldText('Team Info'),
      ),
      org?.name ? [
        css.summaryRow(
          { style: 'margin-bottom: 0.6em' },
          css.billingText(`Your team name: `,
            dom('span', { style: 'font-weight: bold' }, org?.name, testId('org-name')),
          ),
        )
      ] : null,
      org?.domain ? [
        css.summaryRow(
          css.billingText(`Your team site URL: `,
            dom('span', { style: 'font-weight: bold' }, org?.domain),
            `.getgrist.com`,
            testId('org-domain')
          ),
          showEdit ? css.billingTextBtn(css.billingIcon('Settings'), 'Change',
            urlState().setLinkUrl({
              billing: 'billing',
              params: { billingTask: 'updateDomain' }
            }),
            testId('update-domain')
          ) : null
        )
      ] : null
    );
  }

  private _buildDomainSummary(org: { name?: string | null, domain?: string | null }, showEdit: boolean = true) {
    const task = this._model.currentTask.get();
    if (task === 'signUpLite' || task === 'updateDomain') { return null; }
    return this._buildDomainConfirmation(org, showEdit);
  }

  // Summary panel for payment subpage.
  private _buildPaymentSummary(task: BillingTask) {
    if (task === 'signUpLite') {
      return this._buildSubscriptionSummary();
    } else if (task === 'updateDomain') {
      return makeSummaryFeature('You are updating the site name and domain');
    } else if (task === 'cancelPlan') {
      return dom.domComputed(this._model.subscription, sub => {
        return [
          makeSummaryFeature(['You are cancelling the subscription']),
          sub ? makeSummaryFeature(['Your subscription will end on ', dateFmt(sub.periodEnd)]) : null
        ];
      });
    } else {
      return null;
    }
  }

  private _buildButtons(submitText: string) {
    const task = this._model.currentTask.get();
    this._isSubmitting.set(false);  // Reset status on build.
    return css.paymentBtnRow(
      task !== 'signUpLite' ? bigBasicButton('Back',
        dom.on('click', () => window.history.back()),
        dom.show((use) => !use(this._showConfirmPage)),
        dom.boolAttr('disabled', this._isSubmitting),
        testId('back')
      ) : null,
      task !== 'cancelPlan' ? bigBasicButtonLink('Edit',
        dom.show(this._showConfirmPage),
        dom.on('click', () => this._showConfirmPage.set(false)),
        dom.boolAttr('disabled', this._isSubmitting),
        testId('edit')
      ) : null,
      bigPrimaryButton({ style: 'margin-left: 10px;' },
        dom.text(submitText),
        dom.boolAttr('disabled', this._isSubmitting),
        dom.on('click', () => this._doSubmit(task)),
        testId('submit')
      )
    );
  }

  // Submit the active form.
  private async _doSubmit(task?: BillingTask): Promise<void> {
    if (this._isSubmitting.get()) { return; }
    this._isSubmitting.set(true);
    try {
      if (task === 'cancelPlan') {
        await this._model.cancelCurrentPlan();
        this._showConfirmPage.set(false);
        this._formData = {};
        await urlState().pushUrl({ billing: 'billing', params: undefined });
        return;
      }
      // If the form is built, fetch the form data.
      if (this._form) {
        this._formData = await this._form.getFormData();
      }
      // In general, submit data to the server.
      if (task === 'updateDomain' || this._showConfirmPage.get()) {
        await this._model.submitPaymentPage(this._formData);
        // On submit, reset confirm page and form data.
        this._showConfirmPage.set(false);
        this._formData = {};
      } else {
        this._showConfirmPage.set(true);
        this._isSubmitting.set(false);
      }
    } catch (err) {
      // Note that submitPaymentPage are responsible for reporting errors.
      // On failure the submit button isSubmitting state should be returned to false.
      if (!this.isDisposed()) {
        this._isSubmitting.set(false);
        this._showConfirmPage.set(false);
        // Focus the first element with an error.
        this._form?.focusOnError();
      }
    }
  }
}

const statusText: { [key: string]: string } = {
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete',
  past_due: 'past due',
  canceled: 'canceled',
  unpaid: 'unpaid',
};

function getSubscriptionProblem(sub: ISubscriptionModel) {
  const text = sub.status && statusText[sub.status];
  if (!text) { return null; }
  const result = [['Your subscription is ', text]];
  if (sub.lastChargeError) {
    const when = sub.lastChargeTime ? `on ${timeFmt(sub.lastChargeTime)} ` : '';
    result.push([`Last charge attempt ${when} failed: ${sub.lastChargeError}`]);
  }
  return result.map(msg => makeSummaryFeature(msg, { isBad: true }));
}

interface PriceOptions {
  taxRate?: number;
  coupon?: IBillingCoupon;
  refund?: number;
}

const defaultPriceOptions: PriceOptions = {
  taxRate: 0,
  coupon: undefined,
  refund: 0,
};

function getPriceString(priceCents: number, options = defaultPriceOptions): string {
  const { taxRate = 0, coupon, refund } = options;
  if (coupon) {
    if (coupon.amount_off) {
      priceCents -= coupon.amount_off;
    } else if (coupon.percent_off) {
      priceCents -= (priceCents * (coupon.percent_off / 100));
    }
  }

  if (refund) {
    priceCents -= refund;
  }

  // Make sure we never display negative prices.
  priceCents = Math.max(0, priceCents);

  // TODO: Add functionality for other currencies.
  return ((priceCents / 100) * (taxRate + 1)).toLocaleString('en-US', {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  });
}

// Include a precise link back to AppSumo for changing plans.
function makeAppSumoLink(invoiceId: string) {
  return dom('div',
    css.billingTextBtn({ style: 'margin: 10px 0;' },
      cssBreadcrumbsLink(
        css.billingIcon('Plus'), 'Change your AppSumo plan',
        {
          href: `https://appsumo.com/account/redemption/${invoiceId}/#change-plan`,
          target: '_blank'
        },
        testId('appsumo-link')
      )
    ));
}

/**
 * Make summary feature to include in:
 * - Plan cards for describing features of the plan.
 * - Summary lists describing what is being paid for and how much will be charged.
 * - Summary lists describing the current subscription.
 *
 * Accepts text as an array where strings at every odd numbered index are bolded for emphasis.
 * If isMissingFeature is set, no text is bolded and the optional attribute object is not applied.
 * If isBad is set, a cross is used instead of a tick
 */
function makeSummaryFeature(
  text: string | string[],
  options: { isMissingFeature?: boolean, isBad?: boolean, attr?: IAttrObj } = {}
) {
  const textArray = Array.isArray(text) ? text : [text];
  if (options.isMissingFeature) {
    return css.summaryMissingFeature(
      textArray,
      testId('summary-line')
    );
  } else {
    return css.summaryFeature(options.attr,
      options.isBad ? css.billingBadIcon('CrossBig') : css.billingIcon('Tick'),
      textArray.map((str, i) => (i % 2) ? css.focusText(str) : css.summaryText(str)),
      testId('summary-line')
    );
  }
}

function makeActionLink(text: string, icon: IconName, url: DomArg<HTMLElement>, ...args: DomArg<HTMLElement>[]) {
  return dom('div',
    css.billingTextBtn(
      { style: 'margin: 10px 0;' },
      cssBreadcrumbsLink(
        css.billingIcon(icon), text,
        typeof url === 'string' ? { href: url } : url,
        ...args,
      )
    )
  );
}

function makeActionButton(text: string, icon: IconName, handler: () => any, ...args: DomArg<HTMLElement>[]) {
  return css.billingTextBtn(
    { style: 'margin: 10px 0;' },
    css.billingIcon(icon), text,
    dom.on('click', handler),
    ...args
  );
}

function reportLink(appModel: AppModel, text: string): HTMLElement {
  return dom('a', { href: '#' }, text,
    dom.on('click', (ev) => { ev.preventDefault(); beaconOpenMessage({ appModel }); })
  );
}

function dateFmt(timestamp: number | null): string {
  if (!timestamp) { return "unknown"; }
  const date = new Date(timestamp);
  if (date.getFullYear() !== new Date().getFullYear()) {
    return dateFmtFull(timestamp);
  }
  return new Date(timestamp).toLocaleDateString('default', { month: 'long', day: 'numeric' });
}

function dateFmtFull(timestamp: number | null): string {
  if (!timestamp) { return "unknown"; }
  return new Date(timestamp).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeFmt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('default',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' });
}
