import {marked} from 'marked';

export const renderer = new marked.Renderer();

renderer.image = (href: string, text: string) => {
  return `<div class="doc-tutorial-popup-thumbnail">
  <img src="${href}" title="${text ?? ''}" />
  <div class="doc-tutorial-popup-thumbnail-icon-wrapper">
    <div class="doc-tutorial-popup-thumbnail-icon"></div>
  </div>
</div>`;
};

renderer.link = (href: string, _title: string, text: string) => {
  return `<a href="${href}" target="_blank">${text}</a>`;
};
