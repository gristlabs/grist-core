import {componentsCssMapping, tokensCssMapping} from 'app/common/ThemePrefs';
import {assert} from 'chai';

describe('ThemePrefs', function() {
  /**
   * A couple of theme variables are manually appended to the DOM outside of themes.
   * Make sure custom theme variables don't conflict with those.
   */
  it('should have theme variables not conflicting with app internal vars', function() {
    const tokensCssVars = Object.values(tokensCssMapping);
    const componentsCssVars = Object.values(componentsCssMapping);
    const hardcodedCssVars = ['theme-bg', 'theme-bg-color'];

    const conflictingVars = [...tokensCssVars, ...componentsCssVars].filter(cssVar =>
      hardcodedCssVars.includes(`theme-${cssVar}`)
    );
    if (conflictingVars.length) {
      assert.fail(
        'Found conflicting theme CSS variables.\n' +
        `Change these in ThemePrefs: ${conflictingVars.join(', ')}`
      );
    }
  });

  /**
   * Make sure css variable names are unique between tokens and components,
   * because the variables are appended to the DOM as a whole on the same lvl.
   */
  it('should have unique variable names between tokens and components', function() {
    const tokensCssVars = Object.values(tokensCssMapping);
    const componentsCssVars = Object.values(componentsCssMapping);
    const conflictingVars = tokensCssVars.filter(cssVar =>
      componentsCssVars.includes(cssVar as typeof componentsCssVars[number])
    );
    if (conflictingVars.length) {
      assert.fail(
        'Found duplicate CSS variables.\n' +
        `Change these in ThemePrefs: ${conflictingVars.join(', ')}`
      );
    }
  });

  /**
   * Make sure the variables don't start like "grist" or "theme",
   * because those prefixes are automatically added by the app when appending variables to the DOM.
   */
  it('should have all variable names avoid including any variable prefix', function() {
    const tokensCssVars = Object.values(tokensCssMapping);
    const componentsCssVars = Object.values(componentsCssMapping);
    const invalidVars = [...tokensCssVars, ...componentsCssVars].filter(cssVar =>
      cssVar.startsWith('grist-')
      || cssVar.startsWith('theme-')
      || cssVar.startsWith('--')
    );
    if (invalidVars.length) {
      assert.fail(
        'CSS variable names must not start with "grist-", "theme-" or "--".\n' +
        'Change these in ThemePrefs: ' + invalidVars.join(', ')
      );
    }
  });
});
