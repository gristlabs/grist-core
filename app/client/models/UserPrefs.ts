import {localStorageObs} from 'app/client/lib/localStorageObs';
import {AppModel} from 'app/client/models/AppModel';
import {UserOrgPrefs, UserPrefs} from 'app/common/Prefs';
import {Computed, Observable} from 'grainjs';

interface PrefsTypes {
  userOrgPrefs: UserOrgPrefs;
  userPrefs: UserPrefs;
}

function makePrefFunctions<P extends keyof PrefsTypes>(prefsTypeName: P) {
  type PrefsType = PrefsTypes[P];

  /**
   * Creates an observable that returns UserOrgPrefs, and which stores them when set.
   *
   * For anon user, the prefs live in localStorage. Note that the observable isn't actually watching
   * for changes on the server, it will only change when set.
   */
  function getPrefsObs(appModel: AppModel): Observable<PrefsType> {
    const savedPrefs = appModel.currentValidUser ? appModel.currentOrg?.[prefsTypeName] : undefined;
    if (savedPrefs) {
      const prefsObs = Observable.create<PrefsType>(null, savedPrefs!);
      return Computed.create(null, (use) => use(prefsObs))
        .onWrite(prefs => {
          prefsObs.set(prefs);
          return appModel.api.updateOrg('current', {[prefsTypeName]: prefs});
        });
    } else {
      const userId = appModel.currentUser?.id || 0;
      const jsonPrefsObs = localStorageObs(`${prefsTypeName}:u=${userId}`);
      return Computed.create(null, jsonPrefsObs, (use, p) => (p && JSON.parse(p) || {}) as PrefsType)
        .onWrite(prefs => {
          jsonPrefsObs.set(JSON.stringify(prefs));
        });
    }
  }

  /**
   * Creates an observable that returns a particular preference value from `prefsObs`, and which
   * stores it when set.
   */
  function getPrefObs<Name extends keyof PrefsType>(
    prefsObs: Observable<PrefsType>, prefName: Name
  ): Observable<PrefsType[Name]> {
    return Computed.create(null, (use) => use(prefsObs)[prefName])
    .onWrite(value => prefsObs.set({...prefsObs.get(), [prefName]: value}));
  }

  return {getPrefsObs, getPrefObs};
}

// Functions actually exported are:
// - getUserOrgPrefsObs(appModel): Observsble<UserOrgPrefs>
// - getUserOrgPrefObs(userOrgPrefsObs, prefName): Observsble<PrefType[prefName]>
// - getUserPrefsObs(appModel): Observsble<UserPrefs>
// - getUserPrefObs(userPrefsObs, prefName): Observsble<PrefType[prefName]>

export const {getPrefsObs: getUserOrgPrefsObs, getPrefObs: getUserOrgPrefObs} = makePrefFunctions('userOrgPrefs');
export const {getPrefsObs: getUserPrefsObs, getPrefObs: getUserPrefObs} = makePrefFunctions('userPrefs');


// For preferences that store a list of items (such as seen docTours), this helper updates the
// preference to add itemId to it (e.g. to avoid auto-starting the docTour again in the future).
// prefKey is used only to log a more informative warning on error.
export function markAsSeen<T>(seenIdsObs: Observable<T[] | undefined>, itemId: T) {
  const seenIds = seenIdsObs.get() || [];
  try {
    if (!seenIds.includes(itemId)) {
      const seen = new Set(seenIds);
      seen.add(itemId);
      seenIdsObs.set([...seen].sort());
    }
  } catch (e) {
    // If we fail to save this preference, it's probably not worth alerting the user about,
    // so just log to console.
    // tslint:disable-next-line:no-console
    console.warn("Failed to save preference in markAsSeen", e);
  }
}
