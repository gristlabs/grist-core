/**
 * Minimal i18next bootstrap for client unit tests. Imported for its side
 * effect by tests that pull in modules which call `t(...)` at import time
 * (e.g. via `makeT(...)` in app/client/lib/localization). Without this,
 * the lazy `i18next.cloneInstance(...)` triggered by the first `t()` call
 * blows up because the global instance was never initialized.
 */
import i18next from "i18next";

void i18next.init({ lng: "en", resources: { en: { translation: {} } } });
