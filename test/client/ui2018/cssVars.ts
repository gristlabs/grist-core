import {assert} from "chai";
import {colors, vars} from 'app/client/ui2018/cssVars';
import { legacyVarsMapping } from "app/common/ThemePrefs";
import { CssCustomProp } from "app/common/CssCustomProp";

describe('cssVars', function() {
  describe('legacy variables', function() {
    it('should be mapped to theme tokens', () => {
      const toCssVarsMappingFormat = (varsObject: Record<string, CssCustomProp>) => {
        return Object.values(varsObject).reduce<Record<string, string>>((acc, item) => {
          acc[`--grist-${item.name}`] = item.value instanceof CssCustomProp ? item.value.var() : item.value || '';
          return acc;
        }, {});
      };

      const allVars = {...toCssVarsMappingFormat(colors), ...toCssVarsMappingFormat(vars)};

      const errors: string[] = [];
      legacyVarsMapping.forEach(({old, new: newVar}) => {
        if (!allVars[old]) {
          errors.push(`${old} is missing, it should be mapped to ${newVar} theme token.`);
        }
 else if (allVars[old] !== newVar) {
          errors.push(`${old} should be mapped to ${newVar} theme token, but is mapped to ${allVars[old]}.`);
        }
      });

      // assert only one time to show all errors on failure
      if (errors.length > 0) {
        assert.fail('Some tokens are not set correctly:\n' + errors.join('\n'));
      }
    });
  });
});
