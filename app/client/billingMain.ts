import {BillingPage} from 'app/client/ui/BillingPage';
import {setUpPage} from 'app/client/ui/setUpPage';
import {dom} from 'grainjs';

setUpPage((appModel) => dom.create(BillingPage, appModel));
