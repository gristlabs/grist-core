import {marked} from 'marked';

export const renderer = new marked.Renderer();

renderer.link = ({href, text}) => {
  return `<a href="${href}" target="_blank">${text}</a>`;
};
