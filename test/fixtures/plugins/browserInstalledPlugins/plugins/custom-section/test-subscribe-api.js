

/* global grist, window, $, document */
let tableId = 'Table1';

grist.ready();
grist.api.subscribe(tableId);

window.onload = () => {
  showColumn('A');
};

grist.rpc.on("message", (msg) => {
  if (msg.type === "docAction") {
    // There could by many doc actions and fetching table is expensive, in practice this call would
    // be be throttle
    if (msg.action[0] === 'RenameTable') {
      tableId = msg.action[2];
    }
    showColumn('A');
  }
});

// fetch table and call the view with values of coldId
function showColumn(colId) {
  grist.docApi.fetchTable(tableId).then(cols => updateView(cols[colId]));
}

// show the first column
function updateView(values) {
  $("#panel").empty();
  const res = $('<div class="result"></div>');
  const text = document.createTextNode(JSON.stringify(values));
  res.append(text);
  $("#panel").append(res);
}
