import {constructUrl} from 'app/client/models/gristUrlState';
import {gristIconLink} from 'app/client/ui2018/links';
import {marked} from 'marked';
import escape from "lodash/escape";

export const renderer = new marked.Renderer();

renderer.link = ({href, text}) =>
  gristIconLink(constructUrl(href), text).outerHTML;

renderer.html = ({raw}) => escape(raw);
