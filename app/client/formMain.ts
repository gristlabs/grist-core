import {createPage} from 'app/client/ui/createPage';
import {FormPage} from 'app/client/ui/FormPage';
import {dom} from 'grainjs';

createPage(() => dom.create(FormPage), {disableTheme: true});
