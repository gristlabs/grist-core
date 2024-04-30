import {ACLRulesReader} from 'app/common/ACLRulesReader';
import {DocData} from 'app/common/DocData';
import {MetaRowRecord} from 'app/common/TableData';
import {CellValue} from 'app/plugin/GristData';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {assert} from 'chai';
import * as sinon from 'sinon';
import {createDocTools} from 'test/server/docTools';

describe('ACLRulesReader', function() {
  this.timeout(10000);

  const docTools = createDocTools({persistAcrossCases: true});
  const fakeSession = makeExceptionalDocSession('system');

  let activeDoc: ActiveDoc;
  let docData: DocData;

  before(async function () {
    activeDoc = await docTools.createDoc('ACLRulesReader');
    docData = activeDoc.docData!;
  });

  describe('without shares', function() {
    it('entries', async function() {
      // Check output of reading the resources and rules of an empty document.
      for (const options of [undefined, {addShareRules: true}]) {
        assertResourcesAndRules(new ACLRulesReader(docData, options), [
          DEFAULT_UNUSED_RESOURCE_AND_RULE,
        ]);
      }

      // Add some table and default rules and re-check output.
      await activeDoc.applyUserActions(fakeSession, [
        ['AddTable', 'Private', [{id: 'A'}]],
        ['AddTable', 'PartialPrivate', [{id: 'A'}]],
        ['AddRecord', 'PartialPrivate', null, { A: 0 }],
        ['AddRecord', 'PartialPrivate', null, { A: 1 }],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Private', colIds: '*'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLResources', -3, {tableId: 'PartialPrivate', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1,
          aclFormula: 'user.Access == "owners"',
          permissionsText: 'all',
          memo: 'owner check',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: '', permissionsText: 'none',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'user.Access != "owners"', permissionsText: '-S',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -3, aclFormula: 'user.Access != "owners" and rec.A > 0', permissionsText: 'none',
        }],
        ['AddTable', 'Public', [{id: 'A'}]],
      ]);
      for (const options of [undefined, {addShareRules: true}]) {
        assertResourcesAndRules(new ACLRulesReader(docData, options), [
          {
            resource: {id: 2, tableId: 'Private', colIds: '*'},
            rules: [
              {
                aclFormula: 'user.Access == "owners"',
                permissionsText: 'all',
              },
              {
                aclFormula: '',
                permissionsText: 'none',
              },
            ],
          },
          {
            resource: {id: 3, tableId: '*', colIds: '*'},
            rules: [
              {
                aclFormula: 'user.Access != "owners"',
                permissionsText: '-S',
              },
            ],
          },
          {
            resource: {id: 4, tableId: 'PartialPrivate', colIds: '*'},
            rules: [
              {
                aclFormula: 'user.Access != "owners" and rec.A > 0',
                permissionsText: 'none',
              },
            ],
          },
          DEFAULT_UNUSED_RESOURCE_AND_RULE,
        ]);
      }
    });

    it('getResourceById', async function() {
      for (const options of [undefined, {addShareRules: true}]) {
        // Check output of valid resource ids.
        assert.deepEqual(
          new ACLRulesReader(docData, options).getResourceById(1),
          {id: 1, tableId: '', colIds: ''}
        );
        assert.deepEqual(
          new ACLRulesReader(docData, options).getResourceById(2),
          {id: 2, tableId: 'Private', colIds: '*'}
        );
        assert.deepEqual(
          new ACLRulesReader(docData, options).getResourceById(3),
          {id: 3, tableId: '*', colIds: '*'}
        );
        assert.deepEqual(
          new ACLRulesReader(docData, options).getResourceById(4),
          {id: 4, tableId: 'PartialPrivate', colIds: '*'}
        );

        // Check output of non-existent resource ids.
        assert.isUndefined(new ACLRulesReader(docData, options).getResourceById(5));
        assert.isUndefined(new ACLRulesReader(docData, options).getResourceById(0));
        assert.isUndefined(new ACLRulesReader(docData, options).getResourceById(-1));
      }
    });
  });

  describe('with shares', function() {
    before(async function() {
      sinon.stub(ActiveDoc.prototype as any, '_getHomeDbManagerOrFail').returns({
        syncShares: () => Promise.resolve(),
      });
      activeDoc = await docTools.loadFixtureDoc('FilmsWithImages.grist');
      docData = activeDoc.docData!;
      await activeDoc.applyUserActions(fakeSession, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'x',
          options: '{"publish": true}'
        }],
      ]);
    });

    after(function() {
      sinon.restore();
    });

    it('entries', async function() {
      // Check output of reading the resources and rules of an empty document.
      assertResourcesAndRules(new ACLRulesReader(docData), [
        DEFAULT_UNUSED_RESOURCE_AND_RULE,
      ]);

      // Check output of reading the resources and rules of an empty document, with share rules.
      assertResourcesAndRules(new ACLRulesReader(docData, {addShareRules: true}), [
        {
          resource: {id: -1, tableId: 'Films', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
          ],
        },
        {
          resource: {id: -2, tableId: 'Friends', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
          ],
        },
        {
          resource: {id: -3, tableId: 'Performances', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
          ],
        },
        {
          resource: {id: -4, tableId: '*', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-S',
            },
          ],
        },
        {
          resource: {id: 1, tableId: '', colIds: ''},
          rules: [
            {
              aclFormula: 'user.ShareRef is None and (True)',
              permissionsText: '',
            },
          ],
        },
      ]);

      // Add some default, table, and column rules.
      await activeDoc.applyUserActions(fakeSession, [
        ['UpdateRecord', '_grist_Views_section', 7,
         {shareOptions: '{"publish": true, "form": true}'}],
        ['UpdateRecord', '_grist_Pages', 2, {shareRef: 1}],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Films', colIds: 'Title,Poster,PosterDup'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Films', colIds: '*'}],
        ['AddRecord', '_grist_ACLResources', -3, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.access != OWNER', permissionsText: '-R',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'True', permissionsText: 'all',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -3, aclFormula: 'True', permissionsText: 'all',
        }],
      ]);

      // Re-check output without share rules.
      assertResourcesAndRules(new ACLRulesReader(docData), [
        {
          resource: {id: 2, tableId: 'Films', colIds: 'Title,Poster,PosterDup'},
          rules: [
            {
              aclFormula: 'user.access != OWNER',
              permissionsText: '-R',
            },
          ],
        },
        {
          resource: {id: 3, tableId: 'Films', colIds: '*'},
          rules: [
            {
              aclFormula: 'True',
              permissionsText: 'all',
            },
          ],
        },
        {
          resource: {id: 4, tableId: '*', colIds: '*'},
          rules: [
            {
              aclFormula: 'True',
              permissionsText: 'all',
            },
          ],
        },
        DEFAULT_UNUSED_RESOURCE_AND_RULE,
      ]);

      // Re-check output with share rules.
      assertResourcesAndRules(new ACLRulesReader(docData, {addShareRules: true}), [
        {
          resource: {id: -1, tableId: 'Friends', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef == 1',
              permissionsText: '+C',
            },
            {
              aclFormula: 'user.ShareRef == 1 and rec.id == 0',
              permissionsText: '+R',
            },
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
          ],
        },
        // Resource -2, -3, and -4, were split from resource 2.
        {
          resource: {id: -2, tableId: 'Films', colIds: 'Title'},
          rules: [
            {
              aclFormula: 'user.ShareRef == 1',
              permissionsText: '+R',
            },
            {
              aclFormula: 'user.ShareRef is None and (user.access != OWNER)',
              permissionsText: '-R',
            },
          ],
        },
        {
          resource: {id: 3, tableId: 'Films', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
            {
              aclFormula: 'user.ShareRef is None and (True)',
              permissionsText: 'all',
            },
          ],
        },
        {
          resource: {id: -5, tableId: 'Performances', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-CRUDS',
            },
          ],
        },
        {
          resource: {id: 4, tableId: '*', colIds: '*'},
          rules: [
            {
              aclFormula: 'user.ShareRef is not None',
              permissionsText: '-S',
            },
            {
              aclFormula: 'user.ShareRef is None and (True)',
              permissionsText: 'all',
            },
          ],
        },
        // Resource -3 and -4 were split from resource 2.
        {
          resource: {id: -3, tableId: 'Films', colIds: 'Poster'},
          rules: [
            {
              aclFormula: 'user.ShareRef is None and (user.access != OWNER)',
              permissionsText: '-R',
            },
          ],
        },
        {
          resource: {id: -4, tableId: 'Films', colIds: 'PosterDup'},
          rules: [
            {
              aclFormula: 'user.ShareRef is None and (user.access != OWNER)',
              permissionsText: '-R',
            },
          ],
        },
        {
          resource: {id: 1, tableId: '', colIds: ''},
          rules: [
            {
              aclFormula: 'user.ShareRef is None and (True)',
              permissionsText: '',
            },
          ],
        },
      ]);
    });

    it('getResourceById', async function() {
      // Check output of valid resource ids.
      assert.deepEqual(
        new ACLRulesReader(docData).getResourceById(1),
        {id: 1, tableId: '', colIds: ''}
      );
      assert.deepEqual(
        new ACLRulesReader(docData).getResourceById(2),
        {id: 2, tableId: 'Films', colIds: 'Title,Poster,PosterDup'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData).getResourceById(3),
        {id: 3, tableId: 'Films', colIds: '*'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData).getResourceById(4),
        {id: 4, tableId: '*', colIds: '*'}
      );

      // Check output of non-existent resource ids.
      assert.isUndefined(new ACLRulesReader(docData).getResourceById(5));
      assert.isUndefined(new ACLRulesReader(docData).getResourceById(0));
      assert.isUndefined(new ACLRulesReader(docData).getResourceById(-1));

      // Check output of valid resource ids (with share rules).
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(1),
        {id: 1, tableId: '', colIds: ''}
      );
      assert.isUndefined(new ACLRulesReader(docData, {addShareRules: true}).getResourceById(2));
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(3),
        {id: 3, tableId: 'Films', colIds: '*'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(4),
        {id: 4, tableId: '*', colIds: '*'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-1),
        {id: -1, tableId: 'Friends', colIds: '*'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-2),
        {id: -2, tableId: 'Films', colIds: 'Title'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-3),
        {id: -3, tableId: 'Films', colIds: 'Poster'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-4),
        {id: -4, tableId: 'Films', colIds: 'PosterDup'}
      );
      assert.deepEqual(
        new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-5),
        {id: -5, tableId: 'Performances', colIds: '*'}
      );

      // Check output of non-existent resource ids (with share rules).
      assert.isUndefined(new ACLRulesReader(docData, {addShareRules: true}).getResourceById(5));
      assert.isUndefined(new ACLRulesReader(docData, {addShareRules: true}).getResourceById(0));
      assert.isUndefined(new ACLRulesReader(docData, {addShareRules: true}).getResourceById(-6));
    });
  });
});

interface ACLResourceAndRules {
  resource: MetaRowRecord<'_grist_ACLResources'>|undefined;
  rules: {aclFormula: CellValue, permissionsText: CellValue}[];
}

function assertResourcesAndRules(
  aclRulesReader: ACLRulesReader,
  expected: ACLResourceAndRules[]
) {
  const actual: ACLResourceAndRules[] = [...aclRulesReader.entries()].map(([resourceId, rules]) => {
    return {
      resource: aclRulesReader.getResourceById(resourceId),
      rules: rules.map(({aclFormula, permissionsText}) => ({aclFormula, permissionsText})),
    };
  });
  assert.deepEqual(actual, expected);
}

/**
 * An unused resource and rule that's automatically included in every Grist document.
 *
 * See comment in `UserActions.InitNewDoc` (from `useractions.py`) for context.
 */
const DEFAULT_UNUSED_RESOURCE_AND_RULE: ACLResourceAndRules = {
  resource: {id: 1, tableId: '', colIds: ''},
  rules: [{aclFormula: '', permissionsText: ''}],
};
