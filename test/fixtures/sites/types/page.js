/* global document, grist, window */

function formatValue(value, indent='') {
  let basic = `${value} [typeof=${typeof value}]`;
  if (value && typeof value === 'object') {
    basic += ` [name=${value.constructor.name}]`;
  }
  if (value instanceof Date) {
    // For moment, use moment(value) or moment(value).tz(value.timezone), it's just hard to
    // include moment into this test fixture.
    basic += ` [date=${value.toISOString()}]`;
  }
  if (value && typeof value === 'object' && value.constructor.name === 'Object') {
    basic += "\n" + formatObject(value);
  }
  return basic;
}

function formatObject(obj) {
  const keys = Object.keys(obj).sort();
  const rows = keys.map(k => `${k}: ${formatValue(obj[k])}`.replace(/\n/g, '\n  '));
  return rows.join("\n");
}

function setup() {
  let lastRecords = [];
  grist.ready();
  grist.onRecords(function(records) { lastRecords = records; });
  grist.onRecord(function(rec) {
    const formatted = formatObject(rec);
    document.getElementById('record').innerHTML = formatted;

    // Check that there is an identical object in lastRecords, to ensure that onRecords() returns
    // the same kind of representation.
    const rowInRecords = lastRecords.find(r => (r.id === rec.id));
    const match = (formatObject(rowInRecords) === formatted);
    document.getElementById('match').textContent = String(match);

  });
}

window.onload = setup;
