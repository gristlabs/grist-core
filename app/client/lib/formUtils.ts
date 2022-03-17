import {reportError} from 'app/client/models/errors';
import {ApiError} from 'app/common/ApiError';
import {BaseAPI} from 'app/common/BaseAPI';
import {dom, Observable} from 'grainjs';

/**
 * Handles submission of an HTML form element.
 *
 * When the form is submitted, `onSubmit` will be called, followed by
 * either `onSuccess` or `onError`, depending on whether `onSubmit` threw any
 * unhandled errors. The `pending` observable is set to true until `onSubmit`
 * resolves.
 */
export function handleSubmit<T>(
  pending: Observable<boolean>,
  onSubmit: (fields: { [key: string]: string }, form: HTMLFormElement) => Promise<T> = submitForm,
  onSuccess: (v: T) => void = () => { /* noop */ },
  onError: (e: unknown) => void = (e) => reportError(e as string | Error)
): (elem: HTMLFormElement) => void {
  return dom.on('submit', async (e, form) => {
    e.preventDefault();
    try {
      if (pending.get()) { return; }

      pending.set(true);
      const result = await onSubmit(formDataToObj(form), form).finally(() => pending.set(false));
      onSuccess(result);
    } catch (err) {
      onError(err);
    }
  });
}

/**
 * Convert a form to a JSON-stringifiable object, ignoring any File fields.
 */
export function formDataToObj(formElem: HTMLFormElement): { [key: string]: string } {
  // Use FormData to collect values (rather than e.g. finding <input> elements) to ensure we get
  // values from all form items correctly (e.g. checkboxes and textareas).
  const formData = new FormData(formElem);
  const data: { [key: string]: string } = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      data[name] = value;
    }
  }
  return data;
}

/**
 * Submit a form using BaseAPI. Send inputs as JSON, and interpret any reply as JSON.
 */
export async function submitForm(fields: { [key: string]: string }, form: HTMLFormElement): Promise<any> {
  return BaseAPI.requestJson(form.action, {method: 'POST', body: JSON.stringify(fields)});
}

/**
 * Sets the error details on `errObs` if `err` is a 4XX error (except 401). Otherwise, reports the
 * error via the Notifier instance.
 */
export function handleFormError(err: unknown, errObs: Observable<string|null>) {
  if (
    err instanceof ApiError &&
    err.status !== 401 &&
    err.status >= 400 &&
    err.status < 500
  ) {
    errObs.set(err.details?.userError ?? err.message);
  } else {
    reportError(err as Error|string);
  }
}
