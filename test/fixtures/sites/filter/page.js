
/* global document, grist, window */

function setup() {
  grist.ready();
  grist.allowSelectBy();
  document.querySelector('#rowIds').addEventListener('change', (ev) => {
    const rowIds = ev.target.value.split(',').map(Number);
    grist.setSelectedRows(rowIds);
  });
}

window.onload = setup;
