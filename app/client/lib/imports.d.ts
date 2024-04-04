import * as AccountPageModule from 'app/client/ui/AccountPage';
import * as ActivationPageModule from 'app/client/ui/ActivationPage';
import * as BillingPageModule from 'app/client/ui/BillingPage';
import * as AdminPanelModule from 'app/client/ui/AdminPanel';
import * as GristDocModule from 'app/client/components/GristDoc';
import * as ViewPane from 'app/client/components/ViewPane';
import * as UserManagerModule from 'app/client/ui/UserManager';
import * as searchModule from 'app/client/ui2018/search';
import * as momentTimezone from 'moment-timezone';
import * as plotly from 'plotly.js';

export type PlotlyType = typeof plotly;
export type MomentTimezone = typeof momentTimezone;

export function loadAccountPage(): Promise<typeof AccountPageModule>;
export function loadActivationPage(): Promise<typeof ActivationPageModule>;
export function loadBillingPage(): Promise<typeof BillingPageModule>;
export function loadAdminPanel(): Promise<typeof AdminPanelModule>;
export function loadGristDoc(): Promise<typeof GristDocModule>;
export function loadMomentTimezone(): Promise<MomentTimezone>;
export function loadPlotly(): Promise<PlotlyType>;
export function loadSearch(): Promise<typeof searchModule>;
export function loadUserManager(): Promise<typeof UserManagerModule>;
export function loadViewPane(): Promise<typeof ViewPane>;
