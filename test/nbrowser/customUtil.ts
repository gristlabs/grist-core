export * from 'test/server/customUtil';
import {driver} from "mocha-webdriver";

export async function setAccess(option: "none"|"read table"|"full") {
  const text = {
    "none" : "No document access",
    "read table": "Read selected table",
    "full": "Full document access"
  };
  await driver.find(`.test-config-widget-access .test-select-open`).click();
  await gu.findOpenMenuItem('li', text[option]).click();
}
