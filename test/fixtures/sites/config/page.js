/* global document, grist, window */

// Ready message can be configured from url
const urlParams = new URLSearchParams(window.location.search);
const ready = urlParams.get('ready') ? JSON.parse(urlParams.get('ready')) : undefined;

function setup() {
  if (ready && ready.onEditOptions) {
    ready.onEditOptions = () => {
      document.getElementById('configure').innerHTML = 'called';
    };
  }

  grist.ready(ready);

  grist.onOptions(data => {
    document.getElementById('onOptions').innerHTML = JSON.stringify(data);
  });

  grist.onRecord((data, mappings) => {
    document.getElementById('onRecord').innerHTML = JSON.stringify(data);
    document.getElementById('onRecordMappings').innerHTML = JSON.stringify(mappings);
  });

  grist.onRecords((data, mappings) => {
    document.getElementById('onRecords').innerHTML = JSON.stringify(data);
    document.getElementById('onRecordsMappings').innerHTML = JSON.stringify(mappings);
  });

  grist.on('message', event => {
    const existing = document.getElementById('log').textContent || '';
    const newContent = `${existing}\n${JSON.stringify(event)}`.trim();
    document.getElementById('log').innerHTML = newContent;
  });
}

async function run(handler) {
  try {
    document.getElementById('output').innerText = 'waiting...';
    const result = await handler(JSON.parse(document.getElementById('input').value || '[]'));
    document.getElementById('output').innerText = result === undefined ? 'undefined' : JSON.stringify(result);
  } catch (err) {
    document.getElementById('output').innerText = JSON.stringify({error: err.message || String(err)});
  }
}

// eslint-disable-next-line no-unused-vars
async function getOptions() {
  return run(() => grist.widgetApi.getOptions());
}
// eslint-disable-next-line no-unused-vars
async function setOptions() {
  return run(options => grist.widgetApi.setOptions(...options));
}
// eslint-disable-next-line no-unused-vars
async function setOption() {
  return run(options => grist.widgetApi.setOption(...options));
}
// eslint-disable-next-line no-unused-vars
async function getOption() {
  return run(options => grist.widgetApi.getOption(...options));
}
// eslint-disable-next-line no-unused-vars
async function clearOptions() {
  return run(() => grist.widgetApi.clearOptions());
}
// eslint-disable-next-line no-unused-vars
async function mappings() {
  return run(() => grist.sectionApi.mappings());
}
// eslint-disable-next-line no-unused-vars
async function configure() {
  return run((options) => grist.sectionApi.configure(...options));
}

// eslint-disable-next-line no-unused-vars
async function clearLog() {
  return run(() => document.getElementById('log').textContent = '');
}

window.onload = () => {
  setup();
  document.getElementById('ready').innerText = 'ready';
  document.getElementById('access').innerHTML = urlParams.get('access');
  document.getElementById('readonly').innerHTML = urlParams.get('readonly');
};
