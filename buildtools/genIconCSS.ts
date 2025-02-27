import { fromCallback } from 'bluebird';
import {program} from 'commander';
import * as fse from 'fs-extra';
import glob from 'glob';
import { union } from 'lodash';
import * as path from 'path';
import { optimize } from 'svgo';

async function main() {
  program
  .description('Generate CSS library of icons')
  .usage('[options] <paths...>')
  .option('-t --tsfile [tsfile]', 'Output TypeScript type definition')
  .parse(process.argv);

  const inputPaths = program.args;

  if (inputPaths.length === 0) {
    program.outputHelp();
    process.exit(1);
    return;
  }

  // Create a unique list of file paths from command-line arguments, with globbing
  const files: string[] = union(...await Promise.all(inputPaths.map(p => fromCallback<string[]>(cb => glob(p, cb)))));

  // Iterate over the files, optimizing SVGs and storing them as base64 data URI root variables
  console.log(':root {');
  for (const file of files) {
    const filename = path.basename(file, '.svg');
    const result = optimize(await fse.readFile(file, { encoding: "utf8" }), {
      datauri: "base64",
      plugins: [
        {
          name: "preset-default",
          params: {
            overrides: {
              convertPathData: false,
            },
          },
        },
      ],
    });
    console.log(`  --icon-${filename}: url('${result.data}');`);
  }
  console.log('}');

  // Write out all the icon names as a TypeScript type
  if (program.opts().tsfile) {
    const baseNames = files.map(f => JSON.stringify(path.basename(f, '.svg')));
    await fse.writeFile(program.opts().tsfile,
      `export type IconName = ${baseNames.join(' |\n  ')};\n\n` +
      `export const IconList: IconName[] = [${baseNames.join(',\n  ')}];\n`
    );
  }
}

if (require.main === module) {
  main().catch((err) => console.error("Error", err));
}
