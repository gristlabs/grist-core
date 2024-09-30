import {constructUrl} from 'app/client/models/gristUrlState';
import {gristIconLink} from 'app/client/ui2018/links';
import escape from 'lodash/escape';
import {marked} from 'marked';

export const renderer = new marked.Renderer();

renderer.link = ({href, text}) => gristIconLink(constructUrl(href), text).outerHTML;

// Disable Markdown features that we aren't ready to support yet.
renderer.hr = ({raw}) => raw;
renderer.html = ({raw}) => escape(raw);
renderer.image = ({raw}) => raw;
