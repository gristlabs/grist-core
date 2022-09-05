

/* global document, grist, window */

grist.ready();

function readDoc() {
  const api = grist.rpc.getStub("GristDocAPI@grist", grist.checkers.GristDocAPI);
  const placeholder = document.getElementById('placeholder');
  const fallback = setTimeout(() => {
    placeholder.innerHTML = '<div id="output">no joy</div>';
  }, 1000);
  api.listTables()
    .then(tables => {
      clearTimeout(fallback);
      placeholder.innerHTML = `<div id="output">${JSON.stringify(tables)}</div>`;
    });
}

window.onload = readDoc;
