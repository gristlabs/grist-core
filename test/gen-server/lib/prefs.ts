import {UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('prefs', function() {
  this.timeout(60000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');
  let owner: UserAPIImpl;
  let guest: UserAPI;
  let stranger: UserAPI;

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await home.createHomeApi('chimpy', 'testy', true);
    const ws = await owner.newWorkspace({name: 'ws'}, 'current');
    await owner.updateWorkspacePermissions(ws, { users: { 'charon@getgrist.com': 'viewers' } });
    guest = await home.createHomeApi('charon', 'testy', true);
    stranger = await home.createHomeApi('support', 'testy', true, false);
  });

  after(async function() {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await home.stop();
  });

  it('can be set as combo orgUserPrefs when owner or guest', async function() {
    await owner.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for owner'},
    });
    await guest.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for guest'},
    });
    await assert.isRejected(stranger.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for stranger'},
    }), /access denied/);
    assert.equal((await owner.getOrg('current')).userOrgPrefs?.placeholder, 'for owner');
    assert.equal((await guest.getOrg('current')).userOrgPrefs?.placeholder, 'for guest');
    await assert.isRejected(stranger.getOrg('current'), /access denied/);
  });

  it('can be updated as combo orgUserPrefs when owner or guest', async function() {
    await owner.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for owner2'},
    });
    await guest.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for guest2'},
    });
    await assert.isRejected(stranger.updateOrg('current', {
      userOrgPrefs: {placeholder: 'for stranger2'},
    }), /access denied/);
    assert.equal((await owner.getOrg('current')).userOrgPrefs?.placeholder, 'for owner2');
    assert.equal((await guest.getOrg('current')).userOrgPrefs?.placeholder, 'for guest2');
    await assert.isRejected(stranger.getOrg('current'), /access denied/);
  });

  it('can be set as orgPrefs when owner', async function() {
    await owner.updateOrg('current', {
      orgPrefs: {placeholder: 'general'},
    });
    await assert.isRejected(guest.updateOrg('current', {
      orgPrefs: {placeholder: 'general!'},
    }), /access denied/);
    await assert.isRejected(stranger.updateOrg('current', {
      orgPrefs: {placeholder: 'general!'},
    }), /access denied/);
    assert.equal((await owner.getOrg('current')).orgPrefs?.placeholder, 'general');
    assert.equal((await guest.getOrg('current')).orgPrefs?.placeholder, 'general');
    await assert.isRejected(stranger.getOrg('current'), /access denied/);
  });

  it('can be updated as orgPrefs when owner', async function() {
    await owner.updateOrg('current', {
      orgPrefs: {placeholder: 'general2'},
    });
    await assert.isRejected(guest.updateOrg('current', {
      orgPrefs: {placeholder: 'general2!'},
    }), /access denied/);
    await assert.isRejected(stranger.updateOrg('current', {
      orgPrefs: {placeholder: 'general2!'},
    }), /access denied/);
    assert.equal((await owner.getOrg('current')).orgPrefs?.placeholder, 'general2');
    assert.equal((await guest.getOrg('current')).orgPrefs?.placeholder, 'general2');
    await assert.isRejected(stranger.getOrg('current'), /access denied/);
  });

  it('can set as userPrefs when owner or guest', async function() {
    await owner.updateOrg('current', {
      userPrefs: {placeholder: 'userPrefs for owner'},
    });
    await guest.updateOrg('current', {
      userPrefs: {placeholder: 'userPrefs for guest'},
    });
    await assert.isRejected(stranger.updateOrg('current', {
      userPrefs: {placeholder: 'for stranger'},
    }), /access denied/);
    assert.equal((await owner.getOrg('current')).userPrefs?.placeholder, 'userPrefs for owner');
    assert.equal((await guest.getOrg('current')).userPrefs?.placeholder, 'userPrefs for guest');
    await assert.isRejected(stranger.getOrg('current'), /access denied/);
  });

  it('can be accessed as userPrefs on other orgs', async function() {
    const owner2 = await home.createHomeApi('chimpy', 'docs', true);
    const guest2 = await home.createHomeApi('charon', 'docs', true);
    const stranger2 = await home.createHomeApi('support', 'docs', true);
    assert.equal((await owner2.getOrg('current')).userPrefs?.placeholder, 'userPrefs for owner');
    assert.equal((await owner2.getOrg('current')).userOrgPrefs?.placeholder, undefined);
    assert.equal((await owner2.getOrg('current')).orgPrefs?.placeholder, undefined);

    assert.equal((await guest2.getOrg('current')).userPrefs?.placeholder, 'userPrefs for guest');
    assert.equal((await guest2.getOrg('current')).userOrgPrefs?.placeholder, undefined);
    assert.equal((await guest2.getOrg('current')).orgPrefs?.placeholder, undefined);

    assert.equal((await stranger2.getOrg('current')).userPrefs?.placeholder, undefined);
    assert.equal((await stranger2.getOrg('current')).userOrgPrefs?.placeholder, undefined);
    assert.equal((await stranger2.getOrg('current')).orgPrefs?.placeholder, undefined);
  });

  it('can be accessed as prefs from active session', async function() {
    const owner3 = await home.createHomeApi('chimpy', 'docs', true);
    const guest3 = await home.createHomeApi('charon', 'docs', true);
    const stranger3 = await home.createHomeApi('support', 'docs', true);
    assert.equal((await owner3.getSessionActive()).user.prefs?.placeholder, 'userPrefs for owner');
    assert.equal((await guest3.getSessionActive()).user.prefs?.placeholder, 'userPrefs for guest');
    assert.equal((await stranger3.getSessionActive()).user.prefs?.placeholder, undefined);
  });
});
