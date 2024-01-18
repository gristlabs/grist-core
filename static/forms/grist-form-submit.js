// If the script is loaded multiple times, only register the handlers once.
if (!window.gristFormSubmit) {
  (function() {

/**
 * gristFormSubmit(gristDocUrl, gristTableId, formData)
 *  - `gristDocUrl` should be the URL of the Grist document, from step 1 of the setup instructions.
 *  - `gristTableId` should be the table ID from step 2.
 *  - `formData` should be a [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData)
 *    object, typically obtained as `new FormData(formElement)`. Inside the `submit` event handler, it
 *    can be convenient to use `new FormData(event.target)`.
 *  - formElement is the form element that was submitted.
 *
 * This function sends values from `formData` to add a new record in the specified Grist table. It
 * returns a promise for the result of the add-record API call. In case of an error, the promise
 * will be rejected with an error message.
 */
async function gristFormSubmit(docUrl, tableId, formData, formElement) {
  // Pick out the server and docId from the docUrl.
  const match = /^(https?:\/\/[^\/]+(?:\/o\/[^\/]+)?)\/(?:doc\/([^\/?#]+)|([^\/?#]{12,})\/)/.exec(docUrl);
  if (!match) { throw new Error("Invalid Grist doc URL " + docUrl); }
  const server = match[1];
  const docId = match[2] || match[3];

  // Construct the URL to use for the add-record API endpoint.
  const destUrl = server + "/api/docs/" + docId + "/tables/" + tableId + "/records";

  const payload = {records: [{fields: formDataToJson(formData, formElement)}]};
  const options = {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  };

  const resp = await window.fetch(destUrl, options);
  if (resp.status !== 200) {
    // Try to report a helpful error.
    let body = '', error, match;
    try { body = await resp.json(); } catch (e) {}
    if (typeof body.error === 'string' && (match = /KeyError '(.*)'/.exec(body.error))) {
      error = 'No column "' + match[1] + '" in table "' + tableId + '". ' +
        'Be sure to use column ID rather than column label';
    } else {
      error = body.error || String(body);
    }
    throw new Error('Failed to add record: ' + error);
  }

  return await resp.json();
}


// Convert FormData into a mapping of Grist fields. Skips any keys starting with underscore.
// For fields with multiple values (such as to populate ChoiceList), use field names like `foo[]`
// (with the name ending in a pair of empty square brackets).
function formDataToJson(f) {
  const keys = Array.from(f.keys()).filter(k => !k.startsWith("_"));
  return Object.fromEntries(keys.map(k =>
    k.endsWith('[]') ? [k.slice(0, -2), ['L', ...f.getAll(k)]] : [k, f.get(k)]));
}

/**
 * TypedFormData is a wrapper around FormData that provides type information for the fields.
 */
class TypedFormData {
  constructor(formElement, formData) {
    if (!(formElement instanceof HTMLFormElement)) throw new Error("formElement must be a form");
    if (formData && !(formData instanceof FormData)) throw new Error("formData must be a FormData");
    this._formData = formData ?? new FormData(formElement);
    this._formElement = formElement;
  }
  keys() { return this._formData.keys(); }
  type(key) {
    return this._formElement?.querySelector(`[name="${key}"]`)?.getAttribute('data-grist-type');
  }
  get(key) {
    const value = this._formData.get(key);
    if (value === null) { return null; }
    const type = this.type(key);
    return type === 'Ref' || type === 'RefList' ? Number(value) : value;
  }
  getAll(key) {
    const values = Array.from(this._formData.getAll(key));
    if (['Ref', 'RefList'].includes(this.type(key))) {
      return values.map(v => Number(v));
    }
    return values;
  }
}


// Handle submissions for plain forms that include special data-grist-* attributes.
async function handleSubmitPlainForm(ev) {
  if (!['data-grist-doc', 'data-grist-table']
      .some(attr => ev.target.hasAttribute(attr))) {
    // This form isn't configured for Grist at all; don't interfere with it.
    return;
  }

  ev.preventDefault();
  try {
    const docUrl = ev.target.getAttribute('data-grist-doc');
    const tableId = ev.target.getAttribute('data-grist-table');
    if (!docUrl) { throw new Error("Missing attribute data-grist-doc='GRIST_DOC_URL'"); }
    if (!tableId) { throw new Error("Missing attribute data-grist-table='GRIST_TABLE_ID'"); }

    const successUrl = ev.target.getAttribute('data-grist-success-url');

    await gristFormSubmit(docUrl, tableId, new TypedFormData(ev.target));

    // On success, redirect to the requested URL.
    if (successUrl) {
      window.location.href = successUrl;
    }

  } catch (err) {
    reportSubmitError(ev, err);
  }
}

function reportSubmitError(ev, err) {
  console.warn("grist-form-submit error:", err.message);
  // Find an element to use for the validation message to alert the user.
  let scapegoat = null;
  (
    (scapegoat = ev.submitter)?.setCustomValidity ||
    (scapegoat = ev.target.querySelector('input[type=submit]'))?.setCustomValidity ||
    (scapegoat = ev.target.querySelector('button'))?.setCustomValidity ||
    (scapegoat = [...ev.target.querySelectorAll('input')].pop())?.setCustomValidity
  )
  scapegoat?.setCustomValidity("Form misconfigured: " + err.message);
  ev.target.reportValidity();
}

// Handle submissions for Contact Form 7 forms.
async function handleSubmitWPCF7(ev) {
  try {
    const formId = ev.detail.contactFormId;
    const docUrl = ev.target.querySelector('[data-grist-doc]')?.getAttribute('data-grist-doc');
    const tableId = ev.target.querySelector('[data-grist-table]')?.getAttribute('data-grist-table');
    if (!docUrl) { throw new Error("Missing attribute data-grist-doc='GRIST_DOC_URL'"); }
    if (!tableId) { throw new Error("Missing attribute data-grist-table='GRIST_TABLE_ID'"); }

    await gristFormSubmit(docUrl, tableId, new TypedFormData(ev.target));
    console.log("grist-form-submit WPCF7 Form %s: Added record", formId);

  } catch (err) {
    console.warn("grist-form-submit WPCF7 Form %s misconfigured:", formId, err.message);
  }
}

function setUpGravityForms(options) {
  // Use capture to get the event before GravityForms processes it.
  document.addEventListener('submit', ev => handleSubmitGravityForm(ev, options), true);
}
gristFormSubmit.setUpGravityForms = setUpGravityForms;

async function handleSubmitGravityForm(ev, options) {
  try {
    ev.preventDefault();
    ev.stopPropagation();

    const docUrl = options.docUrl;
    const tableId = options.tableId;
    if (!docUrl) { throw new Error("setUpGravityForm: missing docUrl option"); }
    if (!tableId) { throw new Error("setUpGravityForm: missing tableId option"); }

    const f = new TypedFormData(ev.target);
    for (const key of Array.from(f.keys())) {
      // Skip fields other than input fields.
      if (!key.startsWith("input_")) {
        f.delete(key);
        continue;
      }
      // Rename multiple fields to use "[]" convention rather than ".N" convention.
      const multi = key.split(".");
      if (multi.length > 1) {
        f.append(multi[0] + "[]", f.get(key));
        f.delete(key);
      }
    }
    console.warn("Processed FormData", f);
    await gristFormSubmit(docUrl, tableId, f);

    // Follow through by doing the form submission normally.
    ev.target.submit();

  } catch (err) {
    reportSubmitError(ev, err);
    return;
  }
}

window.gristFormSubmit = gristFormSubmit;
document.addEventListener('submit', handleSubmitPlainForm);
document.addEventListener('wpcf7mailsent', handleSubmitWPCF7);

  })();
}
