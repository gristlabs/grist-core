import {localStorageObs} from 'app/client/lib/localStorageObs';
import {AppModel} from 'app/client/models/AppModel';
import {UserOrgPrefs, UserPrefs} from 'app/common/Prefs';
import {Computed, Observable} from 'grainjs';
import {CheckerT} from 'ts-interface-checker';

interface PrefsTypes {
  userOrgPrefs: UserOrgPrefs;
  userPrefs: UserPrefs;
}

function makePrefFunctions<P extends keyof PrefsTypes>(prefsTypeName: P) {
  type PrefsType = PrefsTypes[P];

  /**
   * Creates an observable that returns a PrefsType, and which stores changes when set.
   *
   * For anon user, the prefs live in localStorage. Note that the observable isn't actually watching
   * for changes on the server, it will only change when set.
   */
  function getPrefsObs(appModel: AppModel): Observable<PrefsType> {
    if (appModel.currentValidUser) {
      let prefs: PrefsType | undefined;
      if (prefsTypeName === 'userPrefs') {
        prefs = appModel.currentValidUser.prefs;
      } else {
        prefs = appModel.currentOrg?.[prefsTypeName];
      }
      const prefsObs = Observable.create<PrefsType>(null, prefs ?? {});
      return Computed.create(null, (use) => use(prefsObs))
        .onWrite(newPrefs => {
          prefsObs.set(newPrefs);
          return appModel.api.updateOrg('current', {[prefsTypeName]: newPrefs});
        });
    } else {
      const userId = appModel.currentUser?.id || 0;
      const jsonPrefsObs = localStorageObs(`${prefsTypeName}:u=${userId}`);
      return Computed.create(null, jsonPrefsObs, (use, p) => (p && JSON.parse(p) || {}) as PrefsType)
        .onWrite(newPrefs => {
          jsonPrefsObs.set(JSON.stringify(newPrefs));
        });
    }
  }

  /**
   * Creates an observable that returns a particular preference value from `prefsObs`, and which
   * stores it when set.
   */
  function getPrefObs<Name extends keyof PrefsType>(
    prefsObs: Observable<PrefsType>,
    prefName: Name,
    options: {
      defaultValue?: Exclude<PrefsType[Name], undefined>;
      checker?: CheckerT<PrefsType[Name]>;
    } = {}
  ): Observable<PrefsType[Name] | undefined> {
    const {defaultValue, checker} = options;
    return Computed.create(null, (use) => {
      const prefs = use(prefsObs);
      if (!(prefName in prefs)) { return defaultValue; }

      const value = prefs[prefName];
      if (checker) {
        try {
          checker.check(value);
        } catch (e) {
          console.error(`getPrefObs: preference ${prefName.toString()} has value of invalid type`, e);
          return defaultValue;
        }
      }

      return value;
    }).onWrite(value => prefsObs.set({...prefsObs.get(), [prefName]: value}));
  }

  return {getPrefsObs, getPrefObs};
}

// Functions actually exported are:
// - getUserOrgPrefsObs(appModel): Observable<UserOrgPrefs>
// - getUserOrgPrefObs(userOrgPrefsObs, prefName): Observable<PrefType[prefName]>
// - getUserPrefsObs(appModel): Observable<UserPrefs>
// - getUserPrefObs(userPrefsObs, prefName): Observable<PrefType[prefName]>

export const {getPrefsObs: getUserOrgPrefsObs, getPrefObs: getUserOrgPrefObs} = makePrefFunctions('userOrgPrefs');
export const {getPrefsObs: getUserPrefsObs, getPrefObs: getUserPrefObs} = makePrefFunctions('userPrefs');


// For preferences that store a list of items (such as seen docTours), this helper updates the
// preference to add itemId to it (e.g. to avoid auto-starting the docTour again in the future).
// prefKey is used only to log a more informative warning on error.
export function markAsSeen<T>(seenIdsObs: Observable<T[] | undefined>, itemId: T, isSeen = true) {
  const seenIds = seenIdsObs.get() || [];
  try {
    if (!seenIds.includes(itemId)) {
      const seen = new Set(seenIds);
      if (isSeen) {
        seen.add(itemId);
      } else {
        seen.delete(itemId);
      }
      seenIdsObs.set([...seen].sort());
    }
  } catch (e) {
    // If we fail to save this preference, it's probably not worth alerting the user about,
    // so just log to console.
    // tslint:disable-next-line:no-console
    console.warn("Failed to save preference in markAsSeen", e);
  }
}
