/**
 * This script converts the timezone data from moment-timezone to marshalled format, for fast
 * loading by Python.
 */
const marshal = require('app/common/marshal');
const fse = require('fs-extra');
const moment = require('moment-timezone');
const DEST_FILE = 'sandbox/grist/tzdata.data';

function main() {
  const zones = moment.tz.names().map((name) => {
    const z = moment.tz.zone(name);
    return marshal.wrap('TUPLE', [z.name, z.abbrs, z.offsets, z.untils]);
  });
  const marshaller = new marshal.Marshaller({version: 2});
  marshaller.marshal(zones);
  const contents = marshaller.dumpAsBuffer();

  return fse.writeFile(DEST_FILE, contents);
}

if (require.main === module) {
  main().catch((e) => {
    console.log("ERROR", e.message);
    process.exit(1);
  });
}
