/**
 * This module holds an evaluation scripts for AI assistance. It tests ai assistance on the formula
 * dataset. The formula dataset is made of an index file (formula-dataset-index.csv) and a list of
 * grist documents hosted on S3. A row in the index file, reference one column (doc_id, table_id,
 * col_id) amongst theses documents and a free-text description.
 *
 * For each entries of the data set, the scripts load the document, requests assistance based on the
 * description, and applies the suggested actions to the document. Then it compares the col values
 * before and after. Finally it reverts the modification.
 *
 * The list of grist documents for the formula dataset is a screenshot of all templates document
 * taken somewhere in the beginning of Feb 2023.
 *
 * The script maintains a simple cache of all request to AI to save on the ai requests.
 *
 * USAGE:
 *  OPENAI_API_KEY=<my_openai_api_key> node core/test/formula-dataset/runCompletion.js
 * or
 *  ASSISTANT_CHAT_COMPLETION_ENDPOINT=http.... node core/test/formula-dataset/runCompletion.js
 * (see Assistance.ts for more options).
 *
 *  # WITH VERBOSE:
 *  VERBOSE=1 OPENAI_API_KEY=<my_openai_api_key> node core/test/formula-dataset/runCompletion.js
 *
 *  # to reset cache
 *  rm core/test/formula-dataset/data/cache.json
 */


import { ActiveDoc, Deps as ActiveDocDeps } from "app/server/lib/ActiveDoc";
import { DEPS, sendForCompletion } from "app/server/lib/Assistance";
import log from 'app/server/lib/log';
import crypto from 'crypto';
import parse from 'csv-parse/lib/sync';
import fetch, {RequestInfo, RequestInit, Response} from 'node-fetch';
import * as fs from "fs";
import JSZip from "jszip";
import { isEqual, MapCache } from "lodash";
import path from 'path';
import * as os from 'os';
import { pipeline } from 'stream';
import { createDocTools } from "test/server/docTools";
import { promisify } from 'util';
import { AssistanceResponse, AssistanceState } from "app/common/AssistancePrompts";
import { CellValue } from "app/plugin/GristData";

const streamPipeline = promisify(pipeline);

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data');
const PATH_TO_DOC = path.join(DATA_PATH, 'templates');
const PATH_TO_RESULTS = path.join(DATA_PATH, 'results');
const PATH_TO_CSV = path.join(DATA_PATH, 'formula-dataset-index.csv');
const PATH_TO_CACHE = path.join(DATA_PATH, 'cache');
const TEMPLATE_URL = "https://grist-static.com/datasets/grist_dataset_formulai_2023_02_20.zip";

const oldFetch = DEPS.fetch;

interface FormulaRec {
  no_formula: string;
  table_id: string;
  col_id: string;
  doc_id: string;
  Description: string;
}

const _stats = {
  callCount: 0,
};

const SIMULATE_CONVERSATION = true;
const FOLLOWUP_EVALUATE = false;

export async function runCompletion() {
  // This could take a long time for LLMs running on underpowered hardware >:)
  ActiveDocDeps.ACTIVEDOC_TIMEOUT = 500000;

  // if template directory not exists, make it
  if (!fs.existsSync(path.join(PATH_TO_DOC))) {
    fs.mkdirSync(path.join(PATH_TO_DOC), {recursive: true});

    // create tempdir
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grist-templates-'));
    const destPath = path.join(dir, 'template.zip');

    // start downloading
    console.log(
      `source url: ${TEMPLATE_URL}\n` +
        `destination: ${destPath}\n` +
        `download...`
    );
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) { throw new Error(`unexpected response ${response.statusText}`); }
    await streamPipeline(response.body, fs.createWriteStream(destPath));
    console.log('done!\n\n' +
                'start extraction...');

    // unzip to directory
    const data = fs.readFileSync(destPath);
    const zip = await JSZip.loadAsync(data);
    let count = 0;
    for (const filename of Object.keys(zip.files)) {
      if (filename.includes('/')) { continue; }
      const fileBuffer = await zip.files[filename].async('nodebuffer');
      fs.writeFileSync(path.join(PATH_TO_DOC, filename), fileBuffer);
      count++;
    }
    console.log(
      `Successfully extracted ${count} template files to ${PATH_TO_DOC}`
    );
  }

  const content = fs.readFileSync(PATH_TO_CSV, {encoding: 'utf8'});
  const records = parse(content, {columns: true}) as FormulaRec[];

  // let's group by doc id to save on document loading time
  records.sort((a, b) => a.doc_id.localeCompare(b.doc_id));

  if (!process.env.VERBOSE) {
    log.transports.file.level = 'error';  // Suppress most of log output.
  }
  const docTools = createDocTools();
  const session = docTools.createFakeSession('owners');
  await docTools.before();
  let successCount = 0;
  let caseCount = 0;
  fs.mkdirSync(path.join(PATH_TO_RESULTS), {recursive: true});

  console.log('Testing AI assistance: ');

  try {

    DEPS.fetch = fetchWithCache;

    let activeDoc: ActiveDoc|undefined;
    for (const rec of records) {
      let success: boolean = false;
      let suggestedActions: AssistanceResponse['suggestedActions'] | undefined;
      let newValues: CellValue[] | undefined;
      let formula: string | undefined;
      let history: AssistanceState = {messages: []};
      let lastFollowUp: string | undefined;

      // load new document
      if (!activeDoc || activeDoc.docName !== rec.doc_id) {
        const docPath = path.join(PATH_TO_DOC, rec.doc_id + '.grist');
        activeDoc = await docTools.loadLocalDoc(docPath);
        await activeDoc.waitForInitialization();
      }

      // get values
      await activeDoc.docData!.fetchTable(rec.table_id);
      const expected = activeDoc.docData!.getTable(rec.table_id)!.getColValues(rec.col_id)!.slice();

      async function sendMessage(followUp?: string, rowId?: number) {
        if (!activeDoc) {
          throw new Error("No doc");
        }

        // send prompt
        const tableId = rec.table_id;
        const colId = rec.col_id;
        const description = rec.Description;
        const colInfo = await activeDoc.docStorage.get(`
          select *
          from _grist_Tables_column as c
                 left join _grist_Tables as t on t.id = c.parentId
          where c.colId = ?
            and t.tableId = ?
        `, rec.col_id, rec.table_id);
          formula = colInfo?.formula;

          const result = await sendForCompletion(session, activeDoc, {
            conversationId: 'conversationId',
            context: {
              type: 'formula',
              tableId,
              colId,
              evaluateCurrentFormula: Boolean(followUp) && FOLLOWUP_EVALUATE,
              rowId,
            },
            state: history,
            text: followUp || description,
          });
          if (result.state) {
            history = result.state;
          }
          if (rec.no_formula == "1") {
            success = result.suggestedActions.length === 0;
            return;
          }
          suggestedActions = result.suggestedActions;
          if (!suggestedActions.length) {
            success = false;
            return;
          }

          // apply modification
          const {actionNum} = await activeDoc.applyUserActions(session, suggestedActions);

          // get new values
          newValues = activeDoc.docData!.getTable(rec.table_id)!.getColValues(rec.col_id)!.slice();

          // compare values
          success = isEqual(expected, newValues);

          if (!success && SIMULATE_CONVERSATION) {
            for (let i = 0; i < expected.length; i++) {
              const e = expected[i];
              const v = newValues[i];
              if (String(e) !== String(v)) {
                const txt = `I got \`${v}\` where I expected \`${e}\`\n` +
                  'Please answer with the code block you (the assistant) just gave, ' +
                  'revised based on this information. Your answer must include a code ' +
                  'block. If you have to explain anything, do it after.\n';
                const rowIds = activeDoc.docData!.getTable(rec.table_id)!.getRowIds();
                const rowId = rowIds[i];
                if (followUp) {
                  lastFollowUp = txt;
                } else {
                  await sendMessage(txt, rowId);
                }
                break;
              }
            }
          }
        // revert modification
        const [bundle] = await activeDoc.getActions([actionNum]);
        await activeDoc.applyUserActionsById(session, [bundle!.actionNum], [bundle!.actionHash!], true);
      }

      try {
        await sendMessage();
      } catch (e) {
        console.error(e);
      }

      console.log(` ${success ? 'Successfully' : 'Failed to'} complete formula ` +
        `for column ${rec.table_id}.${rec.col_id} (doc=${rec.doc_id})`);

      if (success) {
        successCount++;
      } else {
        // TODO: log the difference between expected and actual, similar to what mocha does on
        // failure.
        // console.log('expected=', expected);
        // console.log('actual=', newValues);
      }
      const suggestedFormula = suggestedActions?.length === 1 &&
        suggestedActions[0][0] === 'ModifyColumn' &&
        suggestedActions[0][3].formula || suggestedActions;
      fs.writeFileSync(
        path.join(
          PATH_TO_RESULTS,
          `${rec.table_id}_${rec.col_id}_` +
            caseCount.toLocaleString('en', {minimumIntegerDigits: 8, useGrouping: false}) + '.json'),
        JSON.stringify({
          formula,
          suggestedFormula, success,
          expectedValues: expected,
          suggestedValues: newValues,
          history,
          lastFollowUp,
        }, null, 2));
      caseCount++;
    }
  } finally {
    await docTools.after();
    log.transports.file.level = 'debug';
    printStats();
    DEPS.fetch = oldFetch;
    console.log(
      `AI Assistance completed ${successCount} successful prompt on a total of ${records.length};`
    );
    console.log(JSON.stringify(
      {
        hit: successCount,
        total: records.length,
        percentage: (100.0 * successCount) / Math.max(records.length, 1),
      }
    ));
  }
}

export function main() {
  runCompletion().catch(console.error);
}

function printStats() {
  console.log(`Ai assistance requests stats: ${_stats.callCount} calls`);
}

/**
 * Implements a simple cache that read/write from filesystem.
 */
class JsonCache implements MapCache {
  constructor() {
    if (!fs.existsSync(PATH_TO_CACHE)) {
      fs.mkdirSync(path.join(PATH_TO_CACHE), {recursive: true});
    }
  }

  public get(key: string): any {
    if (!this.has(key)) { return undefined; }
    const content = JSON.parse(fs.readFileSync(this._path(key), 'utf8'));
    return JSON.stringify(content.responseBody);
  }

  public has(key: string): boolean {
    return fs.existsSync(this._path(key));
  }

  public set(key: string, value: any): JsonCache {
    const content = {
      requestBody: key,
      responseBody: JSON.parse(value),
    };
    fs.writeFileSync(this._path(key), JSON.stringify(content));
    return this;
  }

  public clear(): void {
    throw new Error('not implemented');
  }

  public delete(_key: string): boolean {
    throw new Error('not implemented');
  }

  private _path(key: string) {
    return path.join(PATH_TO_CACHE, this._hash(key) + '.json');
  }

  private _hash(key: string) {
    return crypto.createHash('md5').update(key).digest('hex');
  }
}

/**
 * Calls fetch and uses caching.
 */
const _cache = new JsonCache();
const _queue = new Map<string, any>();
async function fetchWithCache(rinfo: RequestInfo, init?: RequestInit): Promise<Response>
async function fetchWithCache(rinfo: any, init?: RequestInit): Promise<Response> {
  const url: string = rinfo.url || rinfo.href || rinfo;
  const hash = JSON.stringify({url, body: init?.body});
  if (_cache.has(hash)) { return new Response(_cache.get(hash), {status: 200}); }
  if (_queue.has(hash)) { return new Response(await _queue.get(hash), {status: 200}); }
  _queue.set(hash, fetch(url, init));
  const response = await _queue.get(hash);
  _stats.callCount++;
  if (response.status === 200) {
    _cache.set(hash, await response.clone().text()); // response cannot be read twice, hence clone
  }
  return response;
}

// ts expect this function
fetchWithCache.isRedirect = fetch.isRedirect;
