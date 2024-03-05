import {BillingPage} from 'app/client/ui/BillingPage';
import {createAppPage} from 'app/client/ui/createAppPage';
import {dom} from 'grainjs';

createAppPage((appModel) => dom.create(BillingPage, appModel));
