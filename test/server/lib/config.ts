import { assert } from 'chai';
import * as sinon from 'sinon';
import { ConfigAccessors, createConfigValue, Deps, FileConfig } from "app/server/lib/config";

interface TestFileContents {
  myNum?: number
  myStr?: string
}

const testFileContentsExample: TestFileContents = {
  myNum: 1,
  myStr: "myStr",
};

const testFileContentsJSON = JSON.stringify(testFileContentsExample);

describe('FileConfig', () => {
  const useFakeConfigFile = (contents: string) => {
    const fakeFile = { contents };
    sinon.replace(Deps, 'pathExists', sinon.fake.resolves(true));
    sinon.replace(Deps, 'readFile', sinon.fake((path, encoding: string) => fakeFile.contents) as any);
    sinon.replace(Deps, 'writeFile', sinon.fake((path, newContents) => {
      fakeFile.contents = newContents;
      return Promise.resolve();
    }));

    return fakeFile;
  };

  afterEach(() => {
    sinon.restore();
  });

  it('throws an error from create if the validator does not return a value', () => {
    useFakeConfigFile(testFileContentsJSON);
    const validator = () => null;
    assert.throws(() => FileConfig.create<TestFileContents>("anypath.json", validator));
  });

  it('persists changes when values are assigned', async () => {
    const fakeFile = useFakeConfigFile(testFileContentsJSON);
    // Don't validate - this is guaranteed to be valid above.
    const validator = (input: any) => input as TestFileContents;
    const fileConfig = FileConfig.create("anypath.json", validator);
    await fileConfig.set("myNum", 999);

    assert.equal(fileConfig.get("myNum"), 999);
    assert.equal(JSON.parse(fakeFile.contents).myNum, 999);
  });

  // Avoid removing extra properties from the file, in case another edition of grist is doing something.
  it('does not remove extra values from the file', async () => {
    const configWithExtraProperties = {
      ...testFileContentsExample,
      someProperty: "isPresent",
    };

    const fakeFile = useFakeConfigFile(JSON.stringify(configWithExtraProperties));
    // It's entirely possible the validator can damage the extra properties, but that's not in scope for this test.
    const validator = (input: any) => input as TestFileContents;
    const fileConfig = FileConfig.create("anypath.json", validator);
    // Triggering a write to the file
    await fileConfig.set("myNum", 999);
    await fileConfig.set("myStr", "Something");

    const newContents = JSON.parse(fakeFile.contents);
    assert.equal(newContents.myNum, 999);
    assert.equal(newContents.myStr, "Something");
    assert.equal(newContents.someProperty, "isPresent");
  });
});

describe('createConfigValue', () => {
  const makeInMemoryAccessors = <T>(initialValue: T): ConfigAccessors<T> => {
    let value: T = initialValue;
    return {
      get: () => value,
      set: async (newValue: T) => { value = newValue; },
    };
  };

  it('works without persistence', async () => {
    const configValue = createConfigValue(1);
    assert.equal(configValue.get(), 1);
    await configValue.set(2);
    assert.equal(configValue.get(), 2);
  });

  it('writes to persistence when saved', async () => {
    const accessors = makeInMemoryAccessors(1);
    const configValue = createConfigValue(1, accessors);
    assert.equal(accessors.get(), 1);
    await configValue.set(2);
    assert.equal(accessors.get(), 2);
  });

  it('initialises with the persistent value if available', () => {
    const accessors = makeInMemoryAccessors(22);
    const configValue = createConfigValue(1, accessors);
    assert.equal(configValue.get(), 22);

    const accessorsWithUndefinedValue = makeInMemoryAccessors<number | undefined>(undefined);
    const configValueWithDefault = createConfigValue(333, accessorsWithUndefinedValue);
    assert.equal(configValueWithDefault.get(), 333);
  });
});

