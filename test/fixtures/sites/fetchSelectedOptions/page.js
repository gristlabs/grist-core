/* global document, grist, window */

function setup() {
  const data = {
    shown: 0,
    default: {},
    options: {},
  };

  function showData() {
    data.shown += 1;
    document.getElementById('data').innerHTML = JSON.stringify(data, null, 2);
  }

  grist.onRecord(function (rec) {
    data.default.onRecord = rec;
    showData();
  });
  grist.onRecords(function (recs) {
    data.default.onRecords = recs;
    showData();
  });
  grist.fetchSelectedTable().then(function (table) {
    data.default.fetchSelectedTable = table;
    showData();
  });
  grist.fetchSelectedRecord(1).then(function (rec) {
    data.default.fetchSelectedRecord = rec;
    showData();
  });
  grist.viewApi.fetchSelectedTable().then(function (table) {
    data.default.viewApiFetchSelectedTable = table;
    showData();
  });
  grist.viewApi.fetchSelectedRecord(2).then(function (rec) {
    data.default.viewApiFetchSelectedRecord = rec;
    showData();
  });

  // NOTE: These cases will hit an access error when trying to trigger the callback
  // when access level isn't full, and we can't catch that error.
  grist.onRecord(function (rec) {
    data.options.onRecord = rec;
    showData();
  }, {keepEncoded: true, includeColumns: 'normal', format: 'columns'});
  grist.onRecords(function (recs) {
    data.options.onRecords = recs;
    showData();
  }, {keepEncoded: true, includeColumns: 'all', format: 'columns'});

  grist.fetchSelectedTable(
    {keepEncoded: true, includeColumns: 'all', format: 'rows'}
  ).then(function (table) {
    data.options.fetchSelectedTable = table;
    showData();
  }).catch(function (err) {
    data.options.fetchSelectedTable = String(err);
    showData();
  });
  grist.fetchSelectedRecord(1,
    {keepEncoded: true, includeColumns: 'normal', format: 'rows'}
  ).then(function (rec) {
    data.options.fetchSelectedRecord = rec;
    showData();
  }).catch(function (err) {
    data.options.fetchSelectedRecord = String(err);
    showData();
  });
  grist.viewApi.fetchSelectedTable(
    {keepEncoded: false, includeColumns: 'all', format: 'rows'}
  ).then(function (table) {
    data.options.viewApiFetchSelectedTable = table;
    showData();
  }).catch(function (err) {
    data.options.viewApiFetchSelectedTable = String(err);
    showData();
  });
  grist.viewApi.fetchSelectedRecord(2,
    {keepEncoded: false, includeColumns: 'normal', format: 'rows'}
  ).then(function (rec) {
    data.options.viewApiFetchSelectedRecord = rec;
    showData();
  }).catch(function (err) {
    data.options.viewApiFetchSelectedRecord = String(err);
    showData();
  });

  grist.ready();
}

window.onload = setup;
