import {StringUnion} from 'app/common/StringUnion';

export const SortPref = StringUnion("name", "date");
export type SortPref = typeof SortPref.type;

export const ViewPref = StringUnion("list", "icons");
export type ViewPref = typeof ViewPref.type;


// A collection of preferences related to a user or org (or combination).
export interface Prefs {
  // TODO replace this with real preferences.
  placeholder?: string;
}

export type UserPrefs = Prefs;

export interface UserOrgPrefs extends Prefs {
  docMenuSort?: SortPref;
  docMenuView?: ViewPref;
}

export type OrgPrefs = Prefs;
