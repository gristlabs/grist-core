import {constructUrl} from 'app/client/models/gristUrlState';
import {gristIconLink} from 'app/client/ui2018/links';
import {marked} from 'marked';

export const renderer = new marked.Renderer();

renderer.link = ({href, text}) =>
  gristIconLink(constructUrl(href), text).outerHTML;
