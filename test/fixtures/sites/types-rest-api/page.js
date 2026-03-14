/* global document, grist */

let _token = null;
const getToken = () => (_token || (_token = grist.getAccessToken({readOnly: true})));

grist.ready();
grist.onRecord(async function(rec) {
  const onRecordVersion = rec;

  const fetchSelectedVersion = await grist.docApi.fetchSelectedRecord(rec.id, {
    format: "rows",
    cellFormat: "typed",
    includeColumns: "normal",
  });

  // Also get record via /records?cellFormat=typed endpoint.
  const tokenResult = await getToken();
  const url = new URL(tokenResult.baseUrl + `/tables/Types/records`);
  url.searchParams.set("auth", tokenResult.token);
  url.searchParams.set("filter", JSON.stringify({ id: [rec.id] }));
  url.searchParams.set("cellFormat", "typed");
  const {records} = await (await fetch(url)).json();
  const r = records?.[0];
  const restApiVersion = r ? grist.mapValues({id: r.id, ...r.fields}, grist.decodeObject) : null;

  const result = { onRecordVersion, fetchSelectedVersion, restApiVersion };
  document.getElementById("record").innerHTML = JSON.stringify(result, null, 2);
}, {cellFormat: "typed"});
