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

  // List of example docs that the user has seen and dismissed the welcome card for.
  // The numbers are the `id` from IExampleInfo in app/client/ui/ExampleInfo.
  // By living in UserOrgPrefs, this applies only to the examples-containing org.
  seenExamples?: number[];

  // List of document IDs where the user has seen and dismissed the document tour.
  seenDocTours?: string[];
}

export type OrgPrefs = Prefs;
