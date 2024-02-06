## grist-form-submit.js

File is taken from https://github.com/gristlabs/grist-form-submit. But it is modified to work with
forms, especially for:
- Ref and RefList columns, as by default it sends numbers as strings (FormData issue), and Grist
  doesn't know how to convert them back to numbers.
- Empty strings are not sent at all - otherwise Grist won't be able to fire trigger formulas
  correctly and provide default values for columns.
- By default it requires a redirect URL, now it is optional.


## purify.min.js

File taken from https://www.npmjs.com/package/dompurify. It is used to sanitize HTML. It wasn't
modified at all.

## form.html

This is handlebars template filled by DocApi.ts
