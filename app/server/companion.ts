import { Level, TelemetryContracts } from 'app/common/Telemetry';
import { version } from 'app/common/version';
import { synchronizeProducts } from 'app/gen-server/entity/Product';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { applyPatch } from 'app/gen-server/lib/TypeORMPatches';
import { getMigrations, getOrCreateConnection, getTypeORMSettings,
         undoLastMigration, updateDb } from 'app/server/lib/dbUtils';
import { getDatabaseUrl } from 'app/server/lib/serverUtils';
import { getTelemetryPrefs } from 'app/server/lib/Telemetry';
import { Gristifier } from 'app/server/utils/gristify';
import { pruneActionHistory } from 'app/server/utils/pruneActionHistory';
import * as commander from 'commander';
import { Connection } from 'typeorm';

/**
 * Main entrypoint for a cli toolbox for configuring aspects of Grist
 * and Grist documents.
 */
async function main() {
  // Tweak TypeORM support of SQLite a little bit to support transactions.
  applyPatch();
  const program = getProgram();
  await program.parseAsync(process.argv);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => {
    // tslint:disable-next-line:no-console
    console.error(e);
    process.exit(1);
  });
}

/**
 * Get the Grist companion client program as a commander object.
 * To actually run it, call parseAsync(argv), optionally after
 * adding any other commands that may be available.
 */
export function getProgram(): commander.Command {
  const program = commander.program;
  program
    .name('grist-toolbox')    // haven't really settled on a name yet.
                              // want to reserve "grist" for electron app?
    .description('a toolbox of handy Grist-related utilities');

  addDbCommand(program, {nested: true});
  addHistoryCommand(program, {nested: true});
  addSettingsCommand(program, {nested: true});
  addSiteCommand(program, {nested: true});
  addSqliteCommand(program);
  addVersionCommand(program);
  return program;
}

// Add commands related to document history:
//   history prune <docId> [N]
export function addHistoryCommand(program: commander.Command, options: CommandOptions) {
  const sub = section(program, {
    sectionName: 'history',
    sectionDescription: 'fiddle with history of a Grist document',
    ...options,
  });
  sub('prune <docId>')
    .description('remove all but last N actions from doc')
    .argument('[N]', 'number of actions to keep', parseIntForCommander, 1)
    .action(pruneActionHistory);
}

// Add commands for general configuration
export function addSettingsCommand(program: commander.Command,
                                   options: CommandOptions) {
  const sub = section(program, {
    sectionName: 'settings',
    sectionDescription: 'general configuration',
    ...options
  });
  sub('telemetry')
    .description('show telemetry settings')
    .option('--json', 'show telemetry levels as json')
    .option('--all', 'show all telemetry levels')
    .action(showTelemetry);
}

async function showTelemetry(options: {
  json?: boolean,
  all?: boolean,
}) {
  const contracts = TelemetryContracts;
  const db = await getHomeDBManager();
  const prefs = await getTelemetryPrefs(db);
  const levelName = prefs.telemetryLevel.value;
  const level = Level[levelName];
  if (options.json) {
    console.log(JSON.stringify({
      contracts,
      currentLevel: level,
      currentLevelName: levelName,
    }, null, 2));
  } else {
    if (options.all) {
      console.log("# All telemetry levels");
      console.log("");
      for (const iLevel of [Level.off, Level.limited, Level.full]) {
        describeTelemetryLevel(iLevel, '#');
        console.log("");
        showTelemetryAtLevel(iLevel, '##');
        console.log("");
      }
    } else {
      describeTelemetryLevel(level, '');
      console.log("");
      showTelemetryAtLevel(level, '#');
    }
  }
}

function describeTelemetryLevel(level: Level, nesting: ''|'#') {
  switch (level) {
    case Level.off:
      console.log(nesting + "# Telemetry level: off");
      console.log("No telemetry is recorded or transmitted.");
      break;
    case Level.limited:
      console.log(nesting + "# Telemetry level: limited");
      console.log("This is a telemetry level appropriate for self-hosting instances of Grist.");
      console.log("Data is transmitted to Grist Labs.");
      break;
    case Level.full:
      console.log(nesting + "# Telemetry level: full");
      console.log("This is a telemetry level appropriate for internal use by a hosted service, with");
      console.log("`GRIST_TELEMETRY_URL` set to an endpoint controlled by the operator of the service.");
      break;
  }
}

function showTelemetryAtLevel(level: Level, nesting: ''|'#'|'##') {
  const contracts = TelemetryContracts;
  for (const [name, contract] of Object.entries(contracts)) {
    if (contract.minimumTelemetryLevel > level) { continue; }
    console.log(nesting + "# " + name);
    console.log(contract.description);
    console.log("");
    console.log("| Field | Type | Description |");
    console.log("| ----- | ---- | ----------- |");
    for (const [fieldName, metadata] of Object.entries(contract.metadataContracts || {})) {
      if ((metadata.minimumTelemetryLevel || 0) > level) { continue; }
      console.log("| " + fieldName + " | " + metadata.dataType + " | " + metadata.description + " |");
    }
    console.log("");
  }
}

// Add commands related to sites:
//   site create <domain> <owner-email>
export function addSiteCommand(program: commander.Command,
                               options: CommandOptions) {
  const sub = section(program, {
    sectionName: 'site',
    sectionDescription: 'set up sites',
    ...options
  });
  sub('create <domain> <owner-email>')
    .description('create a site')
    .action(async (domain, email) => {
      console.log("create a site");
      const profile = {email, name: email};
      const db = await getHomeDBManager();
      const user = await db.getUserByLogin(email, {profile});
      if (!user) {
        // This should not happen.
        throw new Error('failed to create user');
      }
      db.unwrapQueryResult(await db.addOrg(user, {
        name: domain,
        domain,
      }, {
        setUserAsOwner: false,
        useNewPlan: true,
        planType: 'teamFree'
      }));
    });
}

// Add commands related to home/landing database:
//   db migrate
//   db revert
//   db check
//   db url
export function addDbCommand(program: commander.Command,
                             options: CommandOptions,
                             reuseConnection?: Connection) {
  function withConnection(op: (connection: Connection) => Promise<number>) {
    return async () => {
      if (!process.env.TYPEORM_LOGGING) {
        process.env.TYPEORM_LOGGING = 'true';
      }
      const connection = reuseConnection || await getOrCreateConnection();
      const exitCode = await op(connection);
      if (exitCode !== 0) {
        program.error('db command failed', {exitCode});
      }
    };
  }
  const sub = section(program, {
    sectionName: 'db',
    sectionDescription: 'maintain the database of users, sites, workspaces, and docs',
    ...options,
  });

  sub('migrate')
    .description('run all pending migrations on database')
    .action(withConnection(async (connection) => {
      await updateDb(connection);
      return 0;
    }));

  sub('revert')
    .description('revert last migration on database')
    .action(withConnection(async (connection) => {
      await undoLastMigration(connection);
      return 0;
    }));

  sub('check')
    .description('check that there are no pending migrations on database')
    .action(withConnection(dbCheck));

  sub('url')
    .description('construct a url for the database (for psql, catsql etc)')
    .action(withConnection(async () => {
      console.log(getDatabaseUrl(getTypeORMSettings(), true));
      return 0;
    }));
}

// Add command related to sqlite:
//   sqlite gristify <sqlite-file>
//   sqlite clean <sqlite-file>
export function addSqliteCommand(program: commander.Command) {
  const sub = program.command('sqlite')
    .description('commands for accessing sqlite files');

  sub.command('gristify <sqlite-file>')
    .description('add grist metadata to an sqlite file')
    .option('--add-sort', 'add a manualSort column, important for adding/removing rows')
    .action((filename, options) => new Gristifier(filename).gristify(options));

  sub.command('clean <sqlite-file>')
    .description('remove grist metadata from an sqlite file')
    .action(filename => new Gristifier(filename).degristify());
}

export function addVersionCommand(program: commander.Command) {
  program.command('version')
    .description('show Grist version')
    .action(() => console.log(version));
}

// Report the status of the database. Migrations appied, migrations pending,
// product information applied, product changes pending.
export async function dbCheck(connection: Connection) {
  const migrations = await getMigrations(connection);
  const changingProducts = await synchronizeProducts(connection, false);
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const log = process.env.TYPEORM_LOGGING === 'true' ? console.log : (...args: any[]) => null;
  const options = getTypeORMSettings();
  log("database url:", getDatabaseUrl(options, false));
  log("migration files:", options.migrations);
  log("migrations applied to db:", migrations.migrationsInDb);
  log("migrations listed in code:", migrations.migrationsInCode);
  let exitCode: number = 0;
  if (migrations.pendingMigrations.length) {
    log(`Migration(s) need to be applied: ${migrations.pendingMigrations}`);
    exitCode = 1;
  } else {
    log("No migrations need to be applied");
  }
  log("");
  if (changingProducts.length) {
    log("Products need updating:", changingProducts);
    log(`   (to revert a product change, run an older version of the code)`);
    log(`   (db:revert will not undo product changes)`);
    exitCode = 1;
  } else {
    log(`Products unchanged`);
  }
  return exitCode;
}

// Get an interface to the home db.
export async function getHomeDBManager() {
  const dbManager = new HomeDBManager();
  await dbManager.connect();
  await dbManager.initializeSpecialIds();
  return dbManager;
}

// Get a function for adding a command to a section of related commands.
// There is a "nested" option that uses commander's nested command feature.
// Older cli code may use an older unnested style.
function section(program: commander.Command, options: {
  sectionName: string,
  sectionDescription: string,
  nested: boolean
}) {
  // If unnested, we'll return a function that adds commands directly to the
  // program (section description is ignored in this case). If nested, we make
  // a command to represent the section, and return a function that adds to that.
  const sub = options.nested ?
    program.command(options.sectionName).description(options.sectionDescription) :
    program;
  return (name: string) => {
    if (options.nested) {
      return sub.command(name);
    } else {
      return sub.command(`${options.sectionName}:${name}`);
    }
  };
}

// Options for command style.
export interface CommandOptions {
  nested: boolean,
  sectionName?: string,
}

// This is based on the recommended way to parse integers for commander.
export function parseIntForCommander(value: string, prev: number) {
  const pvalue = parseInt(value, 10);
  if (isNaN(pvalue)) {
    throw new Error('Not a number.');
  }
  return pvalue;
}
