import { getAppRoot } from 'app/server/lib/places';
import { createTmpDir } from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

import { assert } from 'chai';
import * as childProcess from 'child_process';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as util from 'util';

const execFile = util.promisify(childProcess.execFile);

describe('generateInitialDocSql', function() {
  this.timeout(10000);

  let tmpDir: string;

  testUtils.setTmpLogLevel('fatal');

  before(async function() {
    tmpDir = await createTmpDir();
  });

  it('confirms schema and sql files are up to date (run "yarn run generate:schema:ts" on failure)', async function() {
    let root = getAppRoot();
    if (await fse.pathExists(path.join(root, 'core'))) {
      root = path.join(root, 'core');
    }
    const newSchemaTs = path.join(tmpDir, 'schema.ts');
    const newSqlTs = path.join(tmpDir, 'sql.ts');
    const currentSchemaTs = path.join(root, 'app/common/schema.ts');
    const currentSqlTs = path.join(root, 'app/server/lib/initialDocSql.ts');
    await execFile(path.join(getAppRoot(), 'buildtools/update_schema.sh'), [
      newSchemaTs, newSqlTs,
    ], { env: process.env });
    assert.equal((await fse.readFile(newSchemaTs)).toString(),
                 (await fse.readFile(currentSchemaTs)).toString());
    assert.equal((await fse.readFile(newSqlTs)).toString(),
                 (await fse.readFile(currentSqlTs)).toString());
  });
});
