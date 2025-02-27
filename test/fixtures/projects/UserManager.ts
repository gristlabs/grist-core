import {UserManagerModelImpl} from "app/client/models/UserManagerModel";
import {UserManager} from "app/client/ui/UserManager";
import {PermissionData, PermissionDelta} from "app/common/UserAPI";
import {dom, observable, styled} from "grainjs";
import {withLocale} from "test/fixtures/projects/helpers/withLocale";

function getInitialData(): PermissionData {
  return {
    maxInheritedRole: null,
    users: [
      {
        id: 1,
        name: 'Foo Johnson',
        email: "foo@example.com",
        access: 'owners',
      },
      {
        id: 2,
        name: 'Bar Jackson',
        email: "bar@example.com",
        access: "editors",
      },
      {
        id: 3,
        name: 'Team Member',
        email: 'team@example.com',
        access: 'viewers',
        isMember: true,
      },
      {
        id: 4,
        name: 'Guest',
        email: 'guest@example.com',
        access: 'viewers',
        isMember: false,
      },
    ],
  };
}


function setupTest() {
  const lastDelta = observable<PermissionDelta>({});
  const activeUser = {id: 5, email: 'test-usermanager@getgrist.com', name: 'Test'};
  const model = new UserManagerModelImpl(getInitialData(), 'document', { activeUser });
  const um = observable(new UserManager(model, {}));
  return [
    testBox(
      dom.domComputed(um, _um => _um.buildDom()),
      dom('button.test-save', 'Save', dom.on('click', () => { lastDelta.set(model.getDelta()); })),
    ),
    testBox(
      dom('pre.test-result', dom.text((use) => JSON.stringify(use(lastDelta), null, 2))),
      dom('button.test-reset', 'Reset', dom.on('click', () => {
        lastDelta.set({});
        model.reset();
      })),
    ),
  ];
}

const testBox = styled('div', `
  float: left;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  padding: 1rem;
  margin: 1rem;
`);

void withLocale(() => dom.update(document.body, setupTest()));
