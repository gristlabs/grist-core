/**
 *
 * Can run standalone as:
 *   ts-node test/gen-server/seed.ts serve
 * By default, uses a landing.db database in current directory.
 * Can prefix with database overrides, e.g.
 *   TYPEORM_DATABASE=:memory:
 *   TYPEORM_DATABASE=/tmp/test.db
 * To connect to a postgres database, change ormconfig.env, or add a bunch of variables:
 *   export TYPEORM_CONNECTION=postgres
 *   export TYPEORM_HOST=localhost
 *   export TYPEORM_DATABASE=landing
 *   export TYPEORM_USERNAME=development
 *   export TYPEORM_PASSWORD=*****
 *
 * To just set up the database (migrate and add seed data), and then stop immediately, do:
 *   ts-node test/gen-server/seed.ts init
 * To apply all migrations to the db, do:
 *   ts-node test/gen-server/seed.ts migrate
 * To revert the last migration:
 *   ts-node test/gen-server/seed.ts revert
 *
 */

import {addPath} from 'app-module-path';
import {Context} from 'mocha';
import * as path from 'path';
import {Connection, getConnectionManager, Repository} from 'typeorm';

if (require.main === module) {
  addPath(path.dirname(path.dirname(__dirname)));
}

import {AclRuleDoc, AclRuleOrg, AclRuleWs} from "app/gen-server/entity/AclRule";
import {BillingAccount} from "app/gen-server/entity/BillingAccount";
import {Document} from "app/gen-server/entity/Document";
import {Group} from "app/gen-server/entity/Group";
import {Login} from "app/gen-server/entity/Login";
import {Organization} from "app/gen-server/entity/Organization";
import {Product, PRODUCTS, synchronizeProducts, testDailyApiLimitFeatures} from "app/gen-server/entity/Product";
import {User} from "app/gen-server/entity/User";
import {Workspace} from "app/gen-server/entity/Workspace";
import {EXAMPLE_WORKSPACE_NAME} from 'app/gen-server/lib/HomeDBManager';
import {Permissions} from 'app/gen-server/lib/Permissions';
import {getOrCreateConnection, runMigrations, undoLastMigration, updateDb} from 'app/server/lib/dbUtils';
import {FlexServer} from 'app/server/lib/FlexServer';
import * as fse from 'fs-extra';

const ACCESS_GROUPS = ['owners', 'editors', 'viewers', 'guests', 'members'];

const testProducts = [
  ...PRODUCTS,
    {
    name: 'testDailyApiLimit',
    features: testDailyApiLimitFeatures,
  },
];

export const exampleOrgs = [
  {
    name: 'NASA',
    domain: 'nasa',
    workspaces: [
      {
        name: 'Horizon',
        docs: ['Jupiter', 'Pluto', 'Beyond']
      },
      {
        name: 'Rovers',
        docs: ['Curiosity', 'Apathy']
      }
    ]
  },
  {
    name: 'Primately',
    domain: 'pr',
    workspaces: [
      {
        name: 'Fruit',
        docs: ['Bananas', 'Apples']
      },
      {
        name: 'Trees',
        docs: ['Tall', 'Short']
      }
    ]
  },
  {
    name: 'Flightless',
    domain: 'fly',
    workspaces: [
      {
        name: 'Media',
        docs: ['Australia', 'Antartic']
      }
    ]
  },
  {
    name: 'Abyss',
    domain: 'deep',
    workspaces: [
      {
        name: 'Deep',
        docs: ['Unfathomable']
      }
    ]
  },
  {
    name: 'Charonland',
    workspaces: [
      {
        name: 'Home',
        docs: []
      }
    ],
    // Some tests check behavior on new free personal plans.
    product: 'personalFree',
  },
  {
    name: 'Chimpyland',
    workspaces: [
      {
        name: 'Private',
        docs: ['Timesheets', 'Appointments']
      },
      {
        name: 'Public',
        docs: []
      }
    ]
  },
  {
    name: 'Kiwiland',
    workspaces: []
  },
  {
    name: 'Hamland',
    workspaces: [
      {
        name: 'Home',
        docs: []
      },
    ],
    // Some tests check behavior on legacy free personal plans.
    product: 'starter',
  },
  {
    name: 'EmptyWsOrg',
    domain: 'blanky',
    workspaces: [
      {
        name: 'Vacuum',
        docs: []
      }
    ]
  },
  {
    name: 'EmptyOrg',
    domain: 'blankiest',
    workspaces: []
  },
  {
    name: 'Fish',
    domain: 'fish',
    workspaces: [
      {
        name: 'Big',
        docs: [
          'Shark'
        ]
      },
      {
        name: 'Small',
        docs: [
          'Anchovy',
          'Herring'
        ]
      }
    ]
  },
  {
    name: 'Supportland',
    workspaces: [
      {
        name: EXAMPLE_WORKSPACE_NAME,
        docs: ['Hello World', 'Sample Example']
      },
    ]
  },
  {
    name: 'Shiny',
    domain: 'shiny',
    host: 'www.shiny-grist.io',
    workspaces: [
      {
        name: 'Tailor Made',
        docs: ['Suits', 'Shoes']
      }
    ]
  },
  {
    name: 'FreeTeam',
    domain: 'freeteam',
    product: 'teamFree',
    workspaces: [
      {
        name: 'FreeTeamWs',
        docs: [],
      }
    ]
  },
  {
    name: 'TestDailyApiLimit',
    domain: 'testdailyapilimit',
    product: 'testDailyApiLimit',
    workspaces: [
      {
        name: 'TestDailyApiLimitWs',
        docs: [],
      }
    ]
  },
];


const exampleUsers: {[user: string]: {[org: string]: string}} = {
  Chimpy: {
    TestDailyApiLimit: 'owners',
    FreeTeam: 'owners',
    Chimpyland: 'owners',
    NASA: 'owners',
    Primately: 'guests',
    Fruit: 'viewers',
    Flightless: 'guests',
    Media: 'guests',
    Antartic: 'viewers',
    EmptyOrg: 'editors',
    EmptyWsOrg: 'editors',
    Fish: 'owners'
  },
  Kiwi: {
    Kiwiland: 'owners',
    Flightless: 'editors',
    Primately: 'viewers',
    Fish: 'editors'
  },
  Charon: {
    Charonland: 'owners',
    NASA: 'guests',
    Horizon: 'guests',
    Pluto: 'viewers',
    Chimpyland: 'viewers',
    Fish: 'viewers',
    Abyss: 'owners',
  },
  // User Ham has two-factor authentication enabled on staging/prod.
  Ham: {
    Hamland: 'owners',
  },
  // User support@ owns a workspace "Examples & Templates" in its personal org. It can be shared
  // with everyone@ to let all users see it (this is not done here to avoid impacting all tests).
  Support: { Supportland: 'owners' },
};

interface Groups {
  owners: Group;
  editors: Group;
  viewers: Group;
  guests: Group;
  members?: Group;
}

class Seed {
  public userRepository: Repository<User>;
  public groupRepository: Repository<Group>;
  public groups: {[key: string]: Groups};

  constructor(public connection: Connection) {
    this.userRepository = connection.getRepository(User);
    this.groupRepository = connection.getRepository(Group);
    this.groups = {};
  }

  public async createGroups(parent?: Organization|Workspace): Promise<Groups> {
    const owners = new Group();
    owners.name = 'owners';
    const editors = new Group();
    editors.name = 'editors';
    const viewers = new Group();
    viewers.name = 'viewers';
    const guests = new Group();
    guests.name = 'guests';

    if (parent) {
      // Nest the parent groups inside the new groups
      const parentGroups = this.groups[parent.name];
      owners.memberGroups = [parentGroups.owners];
      editors.memberGroups = [parentGroups.editors];
      viewers.memberGroups = [parentGroups.viewers];
    }

    await this.groupRepository.save([owners, editors, viewers, guests]);

    if (!parent) {
      // Add the members group for orgs.
      const members = new Group();
      members.name = 'members';
      await this.groupRepository.save(members);
      return {
        owners,
        editors,
        viewers,
        guests,
        members
      };
    } else {
      return {
        owners,
        editors,
        viewers,
        guests
      };
    }
  }

  public async addOrgToGroups(groups: Groups, org: Organization) {
    const acl0 = new AclRuleOrg();
    acl0.group = groups.members!;
    acl0.permissions = Permissions.VIEW;
    acl0.organization = org;

    const acl1 = new AclRuleOrg();
    acl1.group = groups.guests;
    acl1.permissions = Permissions.VIEW;
    acl1.organization = org;

    const acl2 = new AclRuleOrg();
    acl2.group = groups.viewers;
    acl2.permissions = Permissions.VIEW;
    acl2.organization = org;

    const acl3 = new AclRuleOrg();
    acl3.group = groups.editors;
    acl3.permissions = Permissions.EDITOR;
    acl3.organization = org;

    const acl4 = new AclRuleOrg();
    acl4.group = groups.owners;
    acl4.permissions = Permissions.OWNER;
    acl4.organization = org;

    // should be able to save both together, but typeorm messes up on postgres.
    await acl0.save();
    await acl1.save();
    await acl2.save();
    await acl3.save();
    await acl4.save();
  }

  public async addWorkspaceToGroups(groups: Groups, ws: Workspace) {
    const acl1 = new AclRuleWs();
    acl1.group = groups.guests;
    acl1.permissions = Permissions.VIEW;
    acl1.workspace = ws;

    const acl2 = new AclRuleWs();
    acl2.group = groups.viewers;
    acl2.permissions = Permissions.VIEW;
    acl2.workspace = ws;

    const acl3 = new AclRuleWs();
    acl3.group = groups.editors;
    acl3.permissions = Permissions.EDITOR;
    acl3.workspace = ws;

    const acl4 = new AclRuleWs();
    acl4.group = groups.owners;
    acl4.permissions = Permissions.OWNER;
    acl4.workspace = ws;

    // should be able to save both together, but typeorm messes up on postgres.
    await acl1.save();
    await acl2.save();
    await acl3.save();
    await acl4.save();
  }

  public async addDocumentToGroups(groups: Groups, doc: Document) {
    const acl1 = new AclRuleDoc();
    acl1.group = groups.guests;
    acl1.permissions = Permissions.VIEW;
    acl1.document = doc;

    const acl2 = new AclRuleDoc();
    acl2.group = groups.viewers;
    acl2.permissions = Permissions.VIEW;
    acl2.document = doc;

    const acl3 = new AclRuleDoc();
    acl3.group = groups.editors;
    acl3.permissions = Permissions.EDITOR;
    acl3.document = doc;

    const acl4 = new AclRuleDoc();
    acl4.group = groups.owners;
    acl4.permissions = Permissions.OWNER;
    acl4.document = doc;

    await acl1.save();
    await acl2.save();
    await acl3.save();
    await acl4.save();
  }

  public async addUserToGroup(user: User, group: Group) {
    await this.connection.createQueryBuilder()
      .relation(Group, "memberUsers")
      .of(group)
      .add(user);
  }

  public async addDocs(orgs: Array<{name: string, domain?: string, host?: string, product?: string,
                                    workspaces: Array<{name: string, docs: string[]}>}>) {
    let docId = 1;
    for (const org of orgs) {
      const o = new Organization();
      o.name = org.name;
      const ba = new BillingAccount();
      ba.individual = false;
      const productName = org.product || 'Free';
      ba.product = (await Product.findOne({where: {name: productName}}))!;
      o.billingAccount = ba;
      if (org.domain) { o.domain = org.domain; }
      if (org.host) { o.host = org.host; }
      await ba.save();
      await o.save();
      const grps = await this.createGroups();
      this.groups[o.name] = grps;
      await this.addOrgToGroups(grps, o);
      for (const workspace of org.workspaces) {
        const w = new Workspace();
        w.name = workspace.name;
        w.org = o;
        await w.save();
        const wgrps = await this.createGroups(o);
        this.groups[w.name] = wgrps;
        await this.addWorkspaceToGroups(wgrps, w);
        for (const doc of workspace.docs) {
          const d = new Document();
          d.name = doc;
          d.workspace = w;
          d.id = `sampledocid_${docId}`;
          docId++;
          await d.save();
          const dgrps = await this.createGroups(w);
          this.groups[d.name] = dgrps;
          await this.addDocumentToGroups(dgrps, d);
        }
      }
    }
  }

  public async run() {
    if (await this.userRepository.findOne({where: {}})) {
      // we already have a user - skip seeding database
      return;
    }

    await this.addDocs(exampleOrgs);
    await this._buildUsers(exampleUsers);
  }

  // Creates benchmark data with 10 orgs, 50 workspaces per org and 20 docs per workspace.
  public async runBenchmark() {
    if (await this.userRepository.findOne({where: {}})) {
      // we already have a user - skip seeding database
      return;
    }

    await this.connection.runMigrations();

    const benchmarkOrgs = _generateData(100, 50, 20);
    // Create an access object giving Chimpy random access to the orgs.
    const chimpyAccess: {[name: string]: string} = {};
    benchmarkOrgs.forEach((_org: any) => {
      const zeroToThree = Math.floor(Math.random() * 4);
      chimpyAccess[_org.name] = ACCESS_GROUPS[zeroToThree];
    });

    await this.addDocs(benchmarkOrgs);
    await this._buildUsers({ Chimpy: chimpyAccess });
  }

  private async _buildUsers(userAccessMap: {[user: string]: {[org: string]: string}}) {
    for (const name of Object.keys(userAccessMap)) {
      const user = new User();
      user.name = name;
      user.apiKey = "api_key_for_" + name.toLowerCase();
      await user.save();
      const login = new Login();
      login.displayEmail = login.email = name.toLowerCase() + "@getgrist.com";
      login.user = user;
      await login.save();
      const personal = await Organization.findOne({where: {name: name + "land"}});
      if (personal) {
        personal.owner = user;
        await personal.save();
      }
      for (const org of Object.keys(userAccessMap[name])) {
        await this.addUserToGroup(user, (this.groups[org] as any)[userAccessMap[name][org]]);
      }
    }
  }
}

// When running mocha on several test files at once, we need to reset our database connection
// if it exists.  This is a little ugly since it is stored globally.
export async function removeConnection() {
  if (getConnectionManager().connections.length > 0) {
    if (getConnectionManager().connections.length > 1) {
      throw new Error("unexpected number of connections");
    }
    await getConnectionManager().connections[0].close();
    // There is still no official way to delete connections that I've found.
    (getConnectionManager() as any).connectionMap = new Map();
  }
}

export async function createInitialDb(connection?: Connection, migrateAndSeedData: boolean = true) {
  // In jenkins tests, we may want to reset the database to a clean
  // state.  If so, TEST_CLEAN_DATABASE will have been set.  How to
  // clean the database depends on what kind of database it is.  With
  // postgres, it suffices to recreate our schema ("public", the
  // default).  With sqlite, it suffices to delete the file -- but we
  // are only allowed to do this if there is no connection open to it
  // (so we fail if a connection has already been made).  If the
  // sqlite db is in memory (":memory:") there's nothing to delete.
  const uncommitted = !connection;  // has user already created a connection?
                                    // if so we won't be able to delete sqlite db
  connection = connection || await getOrCreateConnection();
  const opt = connection.driver.options;
  if (process.env.TEST_CLEAN_DATABASE) {
    if (opt.type === 'sqlite') {
      const database = (opt as any).database;
      // Only dbs on disk need to be deleted
      if (database !== ':memory:') {
        // We can only delete on-file dbs if no connection is open to them
        if (!uncommitted) {
          throw Error("too late to clean sqlite db");
        }
        await removeConnection();
        if (await fse.pathExists(database)) {
          await fse.unlink(database);
        }
        connection = await getOrCreateConnection();
      }
    } else if (opt.type === 'postgres') {
      // recreate schema, destroying everything that was inside it
      await connection.query("DROP SCHEMA public CASCADE;");
      await connection.query("CREATE SCHEMA public;");
    } else {
      throw new Error(`do not know how to clean a ${opt.type} db`);
    }
  }

  // Finally - actually initialize the database.
  if (migrateAndSeedData) {
    await updateDb(connection);
    await addSeedData(connection);
  }
}

// add some test data to the database.
export async function addSeedData(connection: Connection) {
  await synchronizeProducts(connection, true, testProducts);
  await connection.transaction(async tr => {
    const seed = new Seed(tr.connection);
    await seed.run();
  });
}

export async function createBenchmarkDb(connection?: Connection) {
  connection = connection || await getOrCreateConnection();
  await updateDb(connection);
  await connection.transaction(async tr => {
    const seed = new Seed(tr.connection);
    await seed.runBenchmark();
  });
}

export async function createServer(port: number, initDb = createInitialDb): Promise<FlexServer> {
  const flexServer = new FlexServer(port);
  flexServer.addJsonSupport();
  await flexServer.start();
  await flexServer.initHomeDBManager();
  flexServer.addDocWorkerMap();
  await flexServer.loadConfig();
  flexServer.addHosts();
  flexServer.addAccessMiddleware();
  flexServer.addApiMiddleware();
  flexServer.addHomeApi();
  flexServer.addApiErrorHandlers();
  await initDb(flexServer.getHomeDBManager().connection);
  flexServer.summary();
  return flexServer;
}

export async function createBenchmarkServer(port: number): Promise<FlexServer> {
  return createServer(port, createBenchmarkDb);
}

// Generates a random dataset of orgs, workspaces and docs. The number of workspaces
// given is per org, and the number of docs given is per workspace.
function _generateData(numOrgs: number, numWorkspaces: number, numDocs: number) {
  if (numOrgs < 1 || numWorkspaces < 1 || numDocs < 0) {
    throw new Error('_generateData error: Invalid arguments');
  }
  const example = [];
  for (let i = 0; i < numOrgs; i++) {
    const workspaces = [];
    for (let j = 0; j < numWorkspaces; j++) {
      const docs = [];
      for (let k = 0; k < numDocs; k++) {
        const docIndex = (i * numWorkspaces * numDocs) + (j * numDocs) + k;
        docs.push(`doc-${docIndex}`);
      }
      const workspaceIndex = (i * numWorkspaces) + j;
      workspaces.push({
        name: `ws-${workspaceIndex}`,
        docs
      });
    }
    example.push({
      name: `org-${i}`,
      domain: `org-${i}`,
      workspaces
    });
  }
  return example;
}

/**
 * To set up TYPEORM_* environment variables for testing, call this in a before() call of a test
 * suite, using setUpDB(this);
 */
export function setUpDB(context?: Context) {
  if (!process.env.TYPEORM_DATABASE) {
    process.env.TYPEORM_DATABASE = ":memory:";
  } else {
    if (context) { context.timeout(60000); }
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'init') {
    await createInitialDb();
    return;
  } else if (cmd === 'benchmark') {
    const connection = await getOrCreateConnection();
    await createInitialDb(connection, false);
    await createBenchmarkDb(connection);
    return;
  } else if (cmd === 'migrate') {
    process.env.TYPEORM_LOGGING = 'true';
    const connection = await getOrCreateConnection();
    await runMigrations(connection);
    return;
  } else if (cmd === 'revert') {
    process.env.TYPEORM_LOGGING = 'true';
    const connection = await getOrCreateConnection();
    await undoLastMigration(connection);
    return;
  } else if (cmd === 'serve') {
    const home = await createServer(3000);
    // tslint:disable-next-line:no-console
    console.log(`Home API demo available at ${home.getOwnUrl()}`);
    return;
  }
  // tslint:disable-next-line:no-console
  console.log("Call with: init | migrate | revert | serve | benchmark");
}

if (require.main === module) {
  main().catch(e => {
    // tslint:disable-next-line:no-console
    console.log(e);
  });
}
