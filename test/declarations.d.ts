declare module "test/nbrowser/gristUtil-nbrowser";

// Adds missing type declaration to chai
declare namespace Chai {
  interface AssertStatic {
    notIncludeMembers<T>(superset: T[], subset: T[], message?: string): void;
  }
}
