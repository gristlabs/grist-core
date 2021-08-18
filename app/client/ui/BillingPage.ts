import {beaconOpenMessage} from 'app/client/lib/helpScout';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {BillingModel, BillingModelImpl, ISubscriptionModel} from 'app/client/models/BillingModel';
import {getLoginUrl, getMainOrgUrl, urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {BillingForm, IFormData} from 'app/client/ui/BillingForm';
import * as css from 'app/client/ui/BillingPageCss';
import {BillingPlanManagers} from 'app/client/ui/BillingPlanManagers';
import {createForbiddenPage} from 'app/client/ui/errorPages';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, cssBreadcrumbsLink, separator} from 'app/client/ui2018/breadcrumbs';
import {bigBasicButton, bigBasicButtonLink, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {confirmModal} from 'app/client/ui2018/modals';
import {BillingSubPage, BillingTask, IBillingAddress, IBillingCard, IBillingPlan} from 'app/common/BillingAPI';
import {capitalize} from 'app/common/gutil';
import {Organization} from 'app/common/UserAPI';
import {Disposable, dom, IAttrObj, IDomArgs, makeTestId, Observable} from 'grainjs';

const testId = makeTestId('test-bp-');
const taskActions = {
  signUp:        'Sign Up',
  updatePlan:    'Update Plan',
  addCard:       'Add Payment Method',
  updateCard:    'Update Payment Method',
  updateAddress: 'Update Address',
  signUpLite:    'Complete Sign Up',
  updateDomain:  'Update Name',
};

/**
 * Creates the billing page where a user can manager their subscription and payment card.
 */
export class BillingPage extends Disposable {

  private readonly _model: BillingModel = new BillingModelImpl(this._appModel);

  private _form: BillingForm|undefined = undefined;
  private _formData: IFormData = {};

  // Indicates whether the payment page is showing the confirmation page or the data entry form.
  // If _showConfirmation includes the entered form data, the confirmation page is shown.
  // A null value indicates the data entry form is being shown.
  private readonly _showConfirmPage: Observable<boolean> = Observable.create(this, false);

  // Indicates that the payment page submit button has been clicked to prevent repeat requests.
  private readonly _isSubmitting: Observable<boolean> = Observable.create(this, false);

  constructor(private _appModel: AppModel) {
    super();
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
          contentMain: this.buildCurrentPageDom()
        });
      }
    });
  }

  /**
   * Builds the contentMain dom for the current billing page.
   */
  public buildCurrentPageDom() {
    return css.billingWrapper(
      dom.domComputed(this._model.currentSubpage, (subpage) => {
        if (!subpage) {
          return this.buildSummaryPage();
        } else if (subpage === 'payment') {
          return this.buildPaymentPage();
        } else if (subpage === 'plans') {
          return this.buildPlansPage();
        }
      })
    );
  }

  public buildSummaryPage() {
    const org = this._appModel.currentOrg;
    // Fetch plan and card data.
    this._model.fetchData(true).catch(reportError);
    return css.billingPage(
      css.cardBlock(
        css.billingHeader('Account'),
        dom.domComputed(this._model.subscription, sub => [
          this._buildDomainSummary(org && org.domain),
          this._buildCompanySummary(org && org.name, sub ? (sub.address || {}) : null),
          dom.domComputed(this._model.card, card =>
            this._buildCardSummary(card, !sub, [
              css.billingTextBtn(css.billingIcon('Settings'), 'Change',
                urlState().setLinkUrl({
                  billing: 'payment',
                  params: { billingTask: 'updateCard' }
                }),
                testId('update-card')
              ),
              css.billingTextBtn(css.billingIcon('Remove'), 'Remove',
                dom.on('click', () => this._showRemoveCardModal()),
                testId('remove-card')
              )
            ])
          )
        ]),
        // If this is not a personal org, create the plan manager list dom.
        org && !org.owner ? dom.frag(
          css.billingHeader('Plan Managers', {style: 'margin: 32px 0 16px 0;'}),
          css.billingHintText(
            'You may add additional billing contacts (for example, your accounting department). ' +
            'All billing-related emails will be sent to this list of contacts.'
          ),
          dom.create(BillingPlanManagers, this._model, org, this._appModel.currentValidUser)
        ) : null
      ),
      css.summaryBlock(
        css.billingHeader('Billing Summary'),
        this.buildSubscriptionSummary(),
      )
    );
  }

  public buildSubscriptionSummary() {
    return dom.maybe(this._model.subscription, sub => {
      const plans = this._model.plans.get();
      const moneyPlan = sub.upcomingPlan || sub.activePlan;
      const changingPlan = sub.upcomingPlan && sub.upcomingPlan.amount > 0;
      const cancellingPlan = sub.upcomingPlan && sub.upcomingPlan.amount === 0;
      const validPlan = sub.isValidPlan;
      const planId = validPlan ? sub.activePlan.id : sub.lastPlanId;
      // If on a "Tier" coupon, present information differently, emphasizing the coupon
      // name and minimizing the plan.
      const tier = sub.discountName && sub.discountName.includes(' Tier ');
      const planName = tier ? sub.discountName! : sub.activePlan.nickname;
      const invoiceId = this._appModel.currentOrg?.billingAccount?.externalOptions?.invoiceId;
      return [
        css.summaryFeatures(
          validPlan ? [
            makeSummaryFeature(['You are subscribed to the ', planName, ' plan']),
          ] : [
            makeSummaryFeature(['This team site is not in good standing'],
                               {isBad: true}),
          ],

          // If the plan is changing, include the date the current plan ends
          // and the plan that will be in effect afterwards.
          changingPlan ? [
            makeSummaryFeature(['Your current plan ends on ', dateFmt(sub.periodEnd)]),
            makeSummaryFeature(['On this date, you will be subscribed to the ',
                                sub.upcomingPlan!.nickname, ' plan'])
          ] : null,
          cancellingPlan ? [
            makeSummaryFeature(['Your subscription ends on ', dateFmt(sub.periodEnd)]),
            makeSummaryFeature(['On this date, your team site will become ',  'read-only',
                                ' for one month, then removed'])
          ] : null,
          moneyPlan.amount ? [
            makeSummaryFeature([`Your team site has `, `${sub.userCount}`,
                                ` member${sub.userCount > 1 ? 's' : ''}`]),
            tier ? this.buildAppSumoPlanNotes(sub.discountName!) : null,
            // Currently the subtotal is misleading and scary when tiers are in effect.
            // In this case, for now, just report what will be invoiced.
            !tier ? makeSummaryFeature([`Your ${moneyPlan.interval}ly subtotal is `,
                                        getPriceString(moneyPlan.amount * sub.userCount)]) : null,
            (sub.discountName && !tier) ? makeSummaryFeature([`You receive the `, sub.discountName]) : null,
            // When on a free trial, Stripe reports trialEnd time, but it seems to always
            // match periodEnd for a trialing subscription, so we just use that.
            sub.isInTrial ? makeSummaryFeature(['Your free trial ends on ', dateFmtFull(sub.periodEnd)]) : null,
            makeSummaryFeature([`Your next invoice is `, getPriceString(sub.nextTotal),
                                ' on ', dateFmt(sub.periodEnd)]),
          ] : null,
          invoiceId ? this.buildAppSumoLink(invoiceId) : null,
          getSubscriptionProblem(sub),
          testId('summary')
        ),
        (sub.lastInvoiceUrl ?
         dom('div',
             css.billingTextBtn({ style: 'margin: 10px 0;' },
                                cssBreadcrumbsLink(
                                  css.billingIcon('Page'), 'View last invoice',
                                  { href: sub.lastInvoiceUrl, target: '_blank' },
                                  testId('invoice-link')
                                )
                               )
            ) :
         null
        ),
        (moneyPlan.amount === 0 && planId) ? css.billingTextBtn(
          { style: 'margin: 10px 0;' },
          // If the plan was cancellled, make the text indicate that changing the plan will
          // renew the subscription (abort the cancellation).
          css.billingIcon('Settings'), 'Renew subscription',
          urlState().setLinkUrl({
            billing: 'payment',
            params: {
              billingTask: 'updatePlan',
              billingPlan: planId
            }
          }),
          testId('update-plan')
        ) : null,
        // Do not show the cancel subscription option if it was already cancelled.
        plans.length > 0 && moneyPlan.amount > 0 ? css.billingTextBtn(
          { style: 'margin: 10px 0;' },
          css.billingIcon('Settings'), 'Cancel subscription',
          urlState().setLinkUrl({
            billing: 'payment',
            params: {
              billingTask: 'updatePlan',
              billingPlan: plans[0].id
            }
          }),
          testId('cancel-subscription')
        ) : null
      ];
    });
  }

  public buildAppSumoPlanNotes(name: string) {
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

  // Include a precise link back to AppSumo for changing plans.
  public buildAppSumoLink(invoiceId: string) {
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

  public buildPlansPage() {
    // Fetch plan and card data if not already present.
    this._model.fetchData().catch(reportError);
    return css.plansPage(
      css.billingHeader('Choose a plan'),
      css.billingText('Give your team the features they need to succeed'),
      this._buildPlanCards()
    );
  }

  public buildPaymentPage() {
    const org = this._appModel.currentOrg;
    const isSharedOrg = org && org.billingAccount && !org.billingAccount.individual;
    // Fetch plan and card data if not already present.
    this._model.fetchData().catch(this._model.reportBlockingError);
    return css.billingPage(
      dom.maybe(this._model.currentTask, task => {
        const pageText = taskActions[task];
        return [
          css.cardBlock(
            css.billingHeader(pageText),
            dom.domComputed((use) => {
              const err = use(this._model.error);
              if (err) {
                return css.errorBox(err, dom('br'), dom('br'), reportLink(this._appModel, "Report problem"));
              }
              const sub = use(this._model.subscription);
              const card = use(this._model.card);
              const newPlan = use(this._model.signupPlan);
              if (newPlan && newPlan.amount === 0) {
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
                  this._buildPaymentBtns('Cancel Subscription')
                ];
              } else if (sub && card && newPlan && sub.activePlan && newPlan.amount <= sub.activePlan.amount) {
                // If the user already has a card entered and the plan costs less money than
                // the current plan, show the card summary only (no payment required yet)
                return [
                  isSharedOrg ? this._buildDomainSummary(org && org.domain) : null,
                  this._buildCardSummary(card, !sub, [
                    css.billingTextBtn(css.billingIcon('Settings'), 'Update Card',
                      // Clear the fetched card to display the card input form.
                      dom.on('click', () => this._model.card.set(null)),
                      testId('update-card')
                    )
                  ]),
                  this._buildPaymentBtns(pageText)
                ];
              } else {
                return dom.domComputed(this._showConfirmPage, (showConfirm) => {
                  if (showConfirm) {
                    return [
                      this._buildPaymentConfirmation(this._formData),
                      this._buildPaymentBtns(pageText)
                    ];
                  } else if (!sub) {
                    return css.spinnerBox(loadingSpinner());
                  } else if (!newPlan && (task === 'signUp' || task === 'updatePlan')) {
                    return css.errorBox('Unknown plan selected. Please check the URL, or ',
                      reportLink(this._appModel, 'report this issue'), '.');
                  } else {
                    return this._buildBillingForm(org, sub.address, task);
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

  private _buildBillingForm(org: Organization|null, address: IBillingAddress|null, task: BillingTask) {
    const isSharedOrg = org && org.billingAccount && !org.billingAccount.individual;
    const currentSettings = isSharedOrg ? {
      name: org!.name,
      domain: org?.domain?.startsWith('o-') ? undefined : org?.domain || undefined,
    } : this._formData.settings;
    const currentAddress = address || this._formData.address;
    const pageText = taskActions[task];
    // If there is an immediate charge required, require re-entering the card info.
    // Show all forms on sign up.
    this._form = new BillingForm(org, (...args) => this._model.isDomainAvailable(...args), {
      payment: ['signUp', 'updatePlan', 'addCard', 'updateCard'].includes(task),
      address: ['signUp', 'updateAddress'].includes(task),
      settings: ['signUp', 'signUpLite', 'updateAddress', 'updateDomain'].includes(task),
      domain: ['signUp', 'signUpLite', 'updateDomain'].includes(task)
    }, { address: currentAddress, settings: currentSettings, card: this._formData.card });
    return dom('div',
      dom.onDispose(() => {
        if (this._form) {
          this._form.dispose();
          this._form = undefined;
        }
      }),
      isSharedOrg ? this._buildDomainSummary(org && org.domain) : null,
      this._form.buildDom(),
      this._buildPaymentBtns(pageText)
    );
  }

  private _buildPaymentConfirmation(formData: IFormData) {
    const settings = formData.settings || null;
    return [
      this._buildDomainSummary(settings && settings.domain, false),
      this._buildCompanySummary(settings && settings.name, formData.address || null, false),
      this._buildCardSummary(formData.card || null)
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

  private _buildPlanCards() {
    const org = this._appModel.currentOrg;
    const isSharedOrg = org && org.billingAccount && !org.billingAccount.individual;
    const attr = {style: 'margin: 12px 0 12px 0;'};  // Feature attributes
    return css.plansContainer(
      dom.maybe(this._model.plans, (plans) => {
        // Do not show the free plan inside the paid org plan options.
        return plans.filter(plan => !isSharedOrg || plan.amount > 0).map(plan => {
          const priceStr = plan.amount === 0 ? 'Free' : getPriceString(plan.amount);
          const meta = plan.metadata;
          const maxDocs = meta.maxDocs ? `up to ${meta.maxDocs}` : `unlimited`;
          const maxUsers = meta.maxUsersPerDoc ?
            `Share with ${meta.maxUsersPerDoc} collaborators per doc` :
            `Share and collaborate with any number of team members`;
          return css.planBox(
            css.billingHeader(priceStr, { style: `display: inline-block;` }),
            css.planInterval(plan.amount === 0 ? '' : `/ user / ${plan.interval}`),
            css.billingSubHeader(plan.nickname),
            makeSummaryFeature(`Create ${maxDocs} docs`, {attr}),
            makeSummaryFeature(maxUsers, {attr}),
            makeSummaryFeature('Workspaces to organize docs and users', {
              isMissingFeature: !meta.workspaces,
              attr
            }),
            makeSummaryFeature(`Access to support`, {
              isMissingFeature: !meta.supportAvailable,
              attr
            }),
            makeSummaryFeature(`Unthrottled API access`, {
              isMissingFeature: !meta.unthrottledApi,
              attr
            }),
            makeSummaryFeature(`Custom Grist subdomain`, {
              isMissingFeature: !meta.customSubdomain,
              attr
            }),
            plan.trial_period_days ? makeSummaryFeature(['', `${plan.trial_period_days} day free trial`],
              {attr}) : css.summarySpacer(),
            // Add the upgrade buttons once the user plan information has loaded
            dom.domComputed(this._model.subscription, sub => {
              const activePrice = sub ? sub.activePlan.amount : 0;
              const selectedPlan = sub && (sub.upcomingPlan || sub.activePlan);
              // URL state for the payment page to update the plan or sign up.
              const payUrlState = {
                billing: 'payment' as BillingSubPage,
                params: {
                  billingTask: activePrice > 0 ? 'updatePlan' : 'signUp' as BillingTask,
                  billingPlan: plan.id
                }
              };
              if (!this._appModel.currentValidUser && plan.amount === 0) {
                // If the user is not logged in and selects the free plan, provide a login link that
                // redirects back to the free org.
                return css.upgradeBtn('Sign up',
                  {href: getLoginUrl(getMainOrgUrl())},
                  testId('plan-btn')
                );
              } else if ((!selectedPlan && plan.amount === 0) || (selectedPlan && plan.id === selectedPlan.id)) {
                return css.currentBtn('Current plan',
                  testId('plan-btn')
                );
              } else {
                // Sign up / update plan.
                // Show 'Create' if this is not a paid org to indicate that an org will be created.
                const upgradeText = isSharedOrg ? 'Upgrade' : 'Create team site';
                return css.upgradeBtn(plan.amount > activePrice ? upgradeText : 'Select',
                  urlState().setLinkUrl(payUrlState),
                  testId('plan-btn')
                );
              }
            }),
            testId('plan')
          );
        });
      })
    );
  }

  private _buildDomainSummary(domain: string|null, showEdit: boolean = true) {
    const task = this._model.currentTask.get();
    if (task === 'signUpLite' || task === 'updateDomain') { return null; }
    return css.summaryItem(
      css.summaryHeader(
        css.billingBoldText('Billing Info'),
      ),
      domain ? [
        css.summaryRow(
          css.billingText(`Your team site URL: `,
            dom('span', {style: 'font-weight: bold'}, domain),
            `.getgrist.com`,
            testId('org-domain')
          ),
          showEdit ? css.billingTextBtn(css.billingIcon('Settings'), 'Change',
            urlState().setLinkUrl({
              billing: 'payment',
              params: { billingTask: 'updateDomain' }
            }),
            testId('update-domain')
          ) : null
        )
      ] : null
    );
  }

  private _buildCompanySummary(orgName: string|null, address: Partial<IBillingAddress>|null, showEdit: boolean = true) {
    return css.summaryItem({style: 'min-height: 118px;'},
      css.summaryHeader(
        css.billingBoldText(`Company Name & Address`),
        showEdit ? css.billingTextBtn(css.billingIcon('Settings'), 'Change',
          urlState().setLinkUrl({
            billing: 'payment',
            params: { billingTask: 'updateAddress' }
          }),
          testId('update-address')
        ) : null
      ),
      orgName && css.summaryRow(
        css.billingText(orgName,
          testId('org-name')
        )
      ),
      address ? [
        css.summaryRow(
          css.billingText(address.line1,
            testId('company-address-1')
          )
        ),
        address.line2 ? css.summaryRow(
          css.billingText(address.line2,
            testId('company-address-2')
          )
        ) : null,
        css.summaryRow(
          css.billingText(formatCityStateZip(address),
            testId('company-address-3')
          )
        ),
        address.country ? css.summaryRow(
          // This show a 2-letter country code (e.g. "US" or "DE"). This seems fine.
          css.billingText(address.country,
            testId('company-address-country')
          )
        ) : null,
      ] : css.billingHintText('Fetching address...')
    );
  }

  private _buildCardSummary(card: IBillingCard|null, fetching?: boolean, btns?: IDomArgs) {
    if (fetching) {
      // If the subscription data has not yet been fetched.
      return css.summaryItem({style: 'min-height: 102px;'},
        css.summaryHeader(
          css.billingBoldText(`Payment Card`),
        ),
        css.billingHintText('Fetching card preview...')
      );
    } else if (card) {
      // There is a card attached to the account.
      const brand = card.brand ? `${card.brand.toUpperCase()} ` : '';
      return css.summaryItem(
        css.summaryHeader(
          css.billingBoldText(
            // The header indicates the card type (Credit/Debit/Prepaid/Unknown)
            `${capitalize(card.funding || 'payment')} Card`,
            testId('card-funding')
          ),
          btns
        ),
        css.billingText(card.name,
          testId('card-name')
        ),
        css.billingText(`${brand}**** **** **** ${card.last4}`,
          testId('card-preview')
        )
      );
    } else {
      return css.summaryItem(
        css.summaryHeader(
          css.billingBoldText(`Payment Card`),
          css.billingTextBtn(css.billingIcon('Settings'), 'Add',
            urlState().setLinkUrl({
              billing: 'payment',
              params: { billingTask: 'addCard' }
            }),
            testId('add-card')
          ),
        ),
        // TODO: Warn user when a payment method will be required and decide
        // what happens if it is not added.
        css.billingText('Your account has no payment method', testId('card-preview'))
      );
    }
  }

  // Builds the list of summary items indicating why the user is being prompted with
  // the payment method page and what will happen when the card information is submitted.
  private _buildPaymentSummary(task: BillingTask) {
    if (task === 'signUp' || task === 'updatePlan') {
      return dom.maybe(this._model.signupPlan, _plan => this._buildPlanPaymentSummary(_plan, task));
    } else if (task === 'signUpLite') {
      return this.buildSubscriptionSummary();
    } else if (task === 'addCard' || task === 'updateCard') {
      return makeSummaryFeature('You are updating the default payment method');
    } else if (task === 'updateAddress') {
      return makeSummaryFeature('You are updating the company name and address');
    } else if (task === 'updateDomain') {
      return makeSummaryFeature('You are updating the company name and domain');
    } else {
      return null;
    }
  }

  private _buildPlanPaymentSummary(plan: IBillingPlan, task: BillingTask) {
    return dom.domComputed(this._model.subscription, sub => {
      let stubSub: ISubscriptionModel|undefined;
      if (sub && !sub.periodEnd) {
        // Stripe subscriptions have a defined end.
        // If the periodEnd is unknown, that means there is as yet no stripe subscription,
        // and the user is signing up or renewing an expired subscription as opposed to upgrading.
        stubSub = sub;
        sub = undefined;
      }
      if (plan.amount === 0) {
        // User is cancelling their subscription.
        return [
          makeSummaryFeature(['You are cancelling the subscription']),
          sub ? makeSummaryFeature(['Your subscription will end on ', dateFmt(sub.periodEnd)]) : null
        ];
      } else if (sub && sub.activePlan && plan.amount < sub.activePlan.amount) {
        // User is downgrading their plan.
        return [
          makeSummaryFeature(['You are changing to the ', plan.nickname, ' plan']),
          makeSummaryFeature(['Your plan will change on ', dateFmt(sub.periodEnd)]),
          makeSummaryFeature('You will not be charged until the plan changes'),
          makeSummaryFeature([`Your new ${plan.interval}ly subtotal is `,
            getPriceString(plan.amount * sub.userCount)])
        ];
      } else if (!sub) {
        const planPriceStr = getPriceString(plan.amount);
        const subtotal = plan.amount * (stubSub?.userCount || 1);
        const subTotalPriceStr = getPriceString(subtotal);
        const totalPriceStr = getPriceString(subtotal, stubSub?.taxRate || 0);
        // This is a new subscription, either a fresh sign ups, or renewal after cancellation.
        // The server will allow the trial period only for fresh sign ups.
        const trialSummary = (plan.trial_period_days && task === 'signUp') ?
          makeSummaryFeature([`The plan is free for `, `${plan.trial_period_days} days`]) : null;
        return [
          makeSummaryFeature(['You are changing to the ', plan.nickname, ' plan']),
          dom.domComputed(this._showConfirmPage, confirmPage => {
            if (confirmPage) {
              return [
                makeSummaryFeature([`Your ${plan.interval}ly subtotal is `, subTotalPriceStr]),
                // Note that on sign up, the number of users in the new org is always one.
                trialSummary || makeSummaryFeature(['You will be charged ', totalPriceStr, ' to start'])
              ];
            } else {
              return [
                // Note that on sign up, the number of users in the new org is always one.
                makeSummaryFeature([`Your price is `, planPriceStr, ` per user per ${plan.interval}`]),
                makeSummaryFeature([`Your ${plan.interval}ly subtotal is `, subTotalPriceStr]),
                trialSummary
              ];
            }
          })
        ];
      } else if (plan.amount > sub.activePlan.amount) {
        const refund = sub.valueRemaining || 0;
        // User is upgrading their plan.
        return [
          makeSummaryFeature(['You are changing to the ', plan.nickname, ' plan']),
          makeSummaryFeature([`Your ${plan.interval}ly subtotal is `,
            getPriceString(plan.amount * sub.userCount)]),
          makeSummaryFeature(['You will be charged ',
            getPriceString((plan.amount * sub.userCount) - refund, sub.taxRate), ' to start']),
          refund > 0 ? makeSummaryFeature(['Your charge is prorated based on the remaining plan time']) : null,
        ];
      } else {
        // User is cancelling their decision to downgrade their plan.
        return [
          makeSummaryFeature(['You will remain subscribed to the ', plan.nickname, ' plan']),
          makeSummaryFeature([`Your ${plan.interval}ly subtotal is `,
            getPriceString(plan.amount * sub.userCount)]),
          makeSummaryFeature(['Your next payment will be on ', dateFmt(sub.periodEnd)])
        ];
      }
    });
  }

  private _buildPaymentBtns(submitText: string) {
    const task = this._model.currentTask.get();
    this._isSubmitting.set(false);  // Reset status on build.
    return css.paymentBtnRow(
      bigBasicButton('Back',
        dom.on('click', () => window.history.back()),
        dom.show((use) => task !== 'signUp' || !use(this._showConfirmPage)),
        dom.boolAttr('disabled', this._isSubmitting),
        testId('back')
      ),
      bigBasicButtonLink('Edit',
        dom.show(this._showConfirmPage),
        dom.on('click', () => this._showConfirmPage.set(false)),
        dom.boolAttr('disabled', this._isSubmitting),
        testId('edit')
      ),
      bigPrimaryButton({style: 'margin-left: 10px;'},
        dom.text((use) => (task !== 'signUp' || use(this._showConfirmPage)) ? submitText : 'Continue'),
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
      // If the form is built, fetch the form data.
      if (this._form) {
        this._formData = await this._form.getFormData();
      }
      // In general, submit data to the server. In the case of signup, get the tax rate
      // and show confirmation data before submitting.
      if (task !== 'signUp' || this._showConfirmPage.get()) {
        await this._model.submitPaymentPage(this._formData);
        // On submit, reset confirm page and form data.
        this._showConfirmPage.set(false);
        this._formData = {};
      } else {
        if (this._model.signupTaxRate === undefined) {
          await this._model.fetchSignupTaxRate(this._formData);
        }
        this._showConfirmPage.set(true);
        this._isSubmitting.set(false);
      }
    } catch (err) {
      // Note that submitPaymentPage/fetchSignupTaxRate are responsible for reporting errors.
      // On failure the submit button isSubmitting state should be returned to false.
      if (!this.isDisposed()) {
        this._isSubmitting.set(false);
        this._showConfirmPage.set(false);
      }
    }
  }

  private _showRemoveCardModal(): void {
    confirmModal(`Remove Payment Card`, 'Remove',
      () => this._model.removeCard(),
      `This is the only payment method associated with the account.\n\n` +
      `If removed, another payment method will need to be added before the ` +
      `next payment is due.`);
  }
}

const statusText: {[key: string]: string} = {
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
  return result.map(msg => makeSummaryFeature(msg, {isBad: true}));
}

function getPriceString(priceCents: number, taxRate: number = 0): string {
  // TODO: Add functionality for other currencies.
  return ((priceCents / 100) * (taxRate + 1)).toLocaleString('en-US', {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  });
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
  text: string|string[],
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

function reportLink(appModel: AppModel, text: string): HTMLElement {
  return dom('a', {href: '#'}, text,
    dom.on('click', (ev) => { ev.preventDefault(); beaconOpenMessage({appModel}); })
  );
}

function dateFmt(timestamp: number|null): string {
  if (!timestamp) { return "unknown"; }
  return new Date(timestamp).toLocaleDateString('default', {month: 'long', day: 'numeric'});
}

function dateFmtFull(timestamp: number|null): string {
  if (!timestamp) { return "unknown"; }
  return new Date(timestamp).toLocaleDateString('default', {month: 'short', day: 'numeric', year: 'numeric'});
}

function timeFmt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('default',
    {month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric'});
}

function formatCityStateZip(address: Partial<IBillingAddress>) {
  const cityState = [address.city, address.state].filter(Boolean).join(', ');
  return [cityState, address.postal_code].filter(Boolean).join(' ');
}
