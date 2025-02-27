import * as bluebird from 'bluebird';
import { dom, observable, styled } from "grainjs";

import { ApiKey } from 'app/client/ui/ApiKey';
import { cssRootVars } from 'app/client/ui2018/cssVars';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

const apiKeys = [
  '9204c0f1ea5928b31e4e21e55cf975e874281d8e',
  'e03ab513535137a7ec60978b40c9a896db6d8706'];
let i = 0;

// a delay below 200 was breaking test on dev environment.
const delay = () => bluebird.delay(300);

function newApiKey() {
  return apiKeys[++i % 2];
}

function setupTest() {
  const apiKey = observable('');

  async function onCreate() {
    await delay();
    apiKey.set(newApiKey());
  }

  async function onDelete() {
    await delay();
    apiKey.set('');
  }

  return [
    testBox(dom.create(ApiKey, {apiKey, onCreate, onDelete}))
  ];
}

const testBox = styled('div', `
  float: left;
  width: 25rem;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  padding: 1rem;
  margin: 1rem;
`);

void withLocale(() => dom.update(document.body, setupTest(), dom.cls(cssRootVars)));
