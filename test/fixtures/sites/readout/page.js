

/* global document, grist, window */

function readDoc() {
  const fetchTable = grist.docApi.fetchSelectedTable();
  const placeholder = document.getElementById('placeholder');
  const fallback = setTimeout(() => {
    placeholder.innerHTML = '<div id="output">no joy</div>';
  }, 1000);
  fetchTable
    .then(table => {
      clearTimeout(fallback);
      placeholder.innerHTML = `<div id="output">${JSON.stringify(table)}</div>`;
    });
}

function setup() {
  grist.ready();
  grist.on('message', function(e) {
    if ('options' in e) return;
    document.getElementById('rowId').innerHTML = e.rowId || '';
    document.getElementById('tableId').innerHTML = e.tableId || '';
    readDoc();
  });
  grist.onRecord(function(rec) {
    document.getElementById('record').innerHTML = JSON.stringify(rec);
  });
  grist.onRecords(function(recs) {
    document.getElementById('records').innerHTML = JSON.stringify(recs);
  });
  grist.onNewRecord(function(rec) {
    document.getElementById('record').innerHTML = 'new';
  });
  grist.enableKeyboardShortcuts();
}

window.onload = setup;
