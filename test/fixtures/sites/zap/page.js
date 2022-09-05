/* global document, grist, window */

/**
 * This widget connects to the document, gets a list of all user tables in it,
 * and then tries to replace all cells with the text 'zap'.  It requires full
 * access to do this.
 */

let failures = 0;
function problem(err) {
  // Trying to zap formula columns will fail, but that's ok.
  if (String(err).includes("formula column")) { return; }
  console.error(err);
  document.getElementById('placeholder').innerHTML = 'zap failed';
  failures++;
}

async function zap() {
  grist.ready();
  try {
    // If no access is granted, listTables will hang.  Detect this condition with
    // a timeout.
    const timeout = setTimeout(() => problem(new Error('cannot connect')), 1000);
    const tables = await grist.docApi.listTables();
    clearTimeout(timeout);
    // Iterate through user tables.
    for (const tableId of tables) {
      // Read table content.
      const data = await grist.docApi.fetchTable(tableId);
      const ids = data.id;
      // Prepare to zap all columns except id and manualSort.
      delete data.id;
      delete data.manualSort;
      for (const key of Object.keys(data)) {
        const column = data[key];
        for (let i = 0; i < ids.length; i++) {
          column[i] = 'zap';
        }
        // Zap columns one by one since if they are a formula column they will fail.
        await grist.docApi.applyUserActions([[
          'BulkUpdateRecord',
          tableId,
          ids,
          {[key]: column},
        ]]).catch(problem);
      }
    }
  } catch(err) {
    problem(err);
  }
  if (failures === 0) {
    document.getElementById('placeholder').innerHTML = 'zap succeeded';
  }
}

window.onload = zap;
