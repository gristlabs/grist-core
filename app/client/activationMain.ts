import {ActivationPage} from 'app/client/ui/ActivationPage';
import {setupPage} from 'app/client/ui/setupPage';
import {dom} from 'grainjs';

setupPage((appModel) => dom.create(ActivationPage, appModel));
