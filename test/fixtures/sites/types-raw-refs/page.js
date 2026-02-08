/* global document, grist, window */

function setup() {
  let lastRecords = [];
  grist.ready();
  grist.onRecords(function(records) { lastRecords = records; });
  grist.onRecord(function(rec) {
    document.getElementById("record").innerHTML = JSON.stringify(rec);

    // Check that there is an identical object in lastRecords, to ensure that onRecords() returns
    // the same kind of representation.
    const rowInRecords = lastRecords.find(r => (r.id === rec.id));
    const match = JSON.stringify(rowInRecords) === JSON.stringify(rec);
    document.getElementById("match").textContent = JSON.stringify(match);

  }, {expandRefs: false});
}

window.onload = setup;
