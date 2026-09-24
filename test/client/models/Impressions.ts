import { AppModel } from "app/client/models/AppModel";
import { Impressions } from "app/client/models/Impressions";
import { UserPrefs } from "app/common/Prefs";

import { assert } from "chai";
import { Disposable, Observable } from "grainjs";

class TestOwner extends Disposable {}

describe("Impressions", function() {
  let owner: TestOwner;

  beforeEach(() => {
    owner = TestOwner.create(null);
  });

  afterEach(() => {
    owner.dispose();
  });

  function createAppModel(prefs: UserPrefs): AppModel {
    const userPrefsObs = Observable.create<UserPrefs>(owner, prefs);
    return { userPrefsObs } as Partial<AppModel> as AppModel;
  }

  it("reports a count of 0 for a key with no impressions", function() {
    const impressions = Impressions.create(owner, createAppModel({}));

    assert.equal(impressions.getCount("assistantIntro"), 0);
  });

  it("reports the persisted count", function() {
    const impressions = Impressions.create(owner,
      createAppModel({ impressions: { assistantIntro: 3 } }));

    assert.equal(impressions.getCount("assistantIntro"), 3);
  });

  it("persists an incremented count", function() {
    const appModel = createAppModel({ impressions: { assistantIntro: 3 } });
    const impressions = Impressions.create(owner, appModel);

    impressions.incrementCount("assistantIntro", 10);

    assert.deepEqual(appModel.userPrefsObs.get().impressions, { assistantIntro: 4 });
  });

  it("preserves unrelated preferences when incrementing", function() {
    const appModel = createAppModel({ locale: "fr", onlyShowDocuments: true });
    const impressions = Impressions.create(owner, appModel);

    impressions.incrementCount("assistantIntro", 10);

    assert.deepInclude(appModel.userPrefsObs.get(), { locale: "fr", onlyShowDocuments: true });
  });

  it("counts at most one impression per key", function() {
    const appModel = createAppModel({});
    const impressions = Impressions.create(owner, appModel);

    impressions.incrementCount("assistantIntro", 10);
    impressions.incrementCount("assistantIntro", 10);

    assert.equal(appModel.userPrefsObs.get().impressions?.assistantIntro, 1);
  });

  it("saves preferences at most once per key", function() {
    const appModel = createAppModel({});
    const impressions = Impressions.create(owner, appModel);
    let saves = 0;
    owner.autoDispose(appModel.userPrefsObs.addListener(() => { saves += 1; }));

    impressions.incrementCount("assistantIntro", 10);
    impressions.incrementCount("assistantIntro", 10);
    impressions.incrementCount("assistantIntro", 10);

    assert.equal(saves, 1);
  });

  it("does not increment past the maximum", function() {
    const appModel = createAppModel({ impressions: { assistantIntro: 10 } });
    const impressions = Impressions.create(owner, appModel);

    impressions.incrementCount("assistantIntro", 10);

    assert.equal(appModel.userPrefsObs.get().impressions?.assistantIntro, 10);
  });

  it("keeps reporting the count from the start of the session", function() {
    const impressions = Impressions.create(owner,
      createAppModel({ impressions: { assistantIntro: 3 } }));

    impressions.incrementCount("assistantIntro", 10);

    assert.equal(impressions.getCount("assistantIntro"), 3);
  });

  it("picks up counts persisted by an earlier session", function() {
    const appModel = createAppModel({ impressions: { assistantIntro: 3 } });

    Impressions.create(owner, appModel).incrementCount("assistantIntro", 10);

    assert.equal(Impressions.create(owner, appModel).getCount("assistantIntro"), 4);
  });
});
