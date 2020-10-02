import {localStorageObs} from 'app/client/lib/localStorageObs';
import {AppModel} from 'app/client/models/AppModel';
import {UserOrgPrefs} from 'app/common/Prefs';
import {Computed, Observable} from 'grainjs';

/**
 * Creates an observable that returns UserOrgPrefs, and which stores them when set.
 *
 * For anon user, the prefs live in localStorage. Note that the observable isn't actually watching
 * for changes on the server, it will only change when set.
 */
export function getUserOrgPrefsObs(appModel: AppModel): Observable<UserOrgPrefs> {
  const savedPrefs = appModel.currentValidUser ? appModel.currentOrg?.userOrgPrefs : undefined;
  if (savedPrefs) {
    const prefsObs = Observable.create<UserOrgPrefs>(null, savedPrefs);
    return Computed.create(null, (use) => use(prefsObs))
      .onWrite(userOrgPrefs => {
        prefsObs.set(userOrgPrefs);
        return appModel.api.updateOrg('current', {userOrgPrefs});
      });
  } else {
    const userId = appModel.currentUser?.id || 0;
    const jsonPrefsObs = localStorageObs(`userOrgPrefs:u=${userId}`);
    return Computed.create(null, jsonPrefsObs, (use, p) => (p && JSON.parse(p) || {}) as UserOrgPrefs)
      .onWrite(userOrgPrefs => {
        jsonPrefsObs.set(JSON.stringify(userOrgPrefs));
      });
  }
}

/**
 * Creates an observable that returns a particular preference value from UserOrgPrefs, and which
 * stores it when set.
 */
export function getUserOrgPrefObs<Name extends keyof UserOrgPrefs>(
  appModel: AppModel, prefName: Name
): Observable<UserOrgPrefs[Name]> {
  const prefsObs = getUserOrgPrefsObs(appModel);
  return Computed.create(null, (use) => use(prefsObs)[prefName])
  .onWrite(value => prefsObs.set({...prefsObs.get(), [prefName]: value}));
}
