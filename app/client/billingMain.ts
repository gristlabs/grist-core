import {BillingPage} from 'app/client/ui/BillingPage';
import {setupPage} from 'app/client/ui/setupPage';
import {dom} from 'grainjs';

setupPage((appModel) => dom.create(BillingPage, appModel));
