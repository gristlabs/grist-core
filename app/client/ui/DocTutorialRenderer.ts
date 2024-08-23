import {marked} from 'marked';

export const renderer = new marked.Renderer();

renderer.image = ({href, title}) => {
  let classes = 'doc-tutorial-popup-thumbnail';
  const hash = href?.split('#')?.[1];
  if (hash) {
    const extraClass = `doc-tutorial-popup-thumbnail-${hash}`;
    classes += ` ${extraClass}`;
  }
  return `<div class="${classes}">
  <img src="${href}" title="${title ?? ''}" />
  <div class="doc-tutorial-popup-thumbnail-icon-wrapper">
    <div class="doc-tutorial-popup-thumbnail-icon"></div>
  </div>
</div>`;
};

renderer.link = ({href, text}) => {
  return `<a href="${href}" target="_blank">${text}</a>`;
};
