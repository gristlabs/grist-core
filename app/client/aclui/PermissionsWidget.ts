/**
 * Implements a widget showing 3-state boxes for permissions
 * (for Allow / Deny / Pass-Through).
 */
import {colors, testId, theme} from 'app/client/ui2018/cssVars';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {menu, menuIcon, menuItem} from 'app/client/ui2018/menus';
import {PartialPermissionSet, PartialPermissionValue} from 'app/common/ACLPermissions';
import {ALL_PERMISSION_PROPS, emptyPermissionSet, PermissionKey} from 'app/common/ACLPermissions';
import {capitalize} from 'app/common/gutil';
import {dom, DomElementArg, Observable, styled} from 'grainjs';
import isEqual = require('lodash/isEqual');
import {makeT} from 'app/client/lib/localization';

// Canonical order of permission bits when rendered in a permissionsWidget.
const PERMISSION_BIT_ORDER = 'RUCDS';

const t = makeT('PermissionsWidget');

/**
 * Renders a box for each of availableBits, and a dropdown with a description and some shortcuts.
 */
export function permissionsWidget(
  availableBits: PermissionKey[],
  pset: Observable<PartialPermissionSet>,
  options: {disabled: boolean, sanityCheck?: (p: PartialPermissionSet) => void},
  ...args: DomElementArg[]
) {
  availableBits = sortBits(availableBits);
  // These are the permission sets available to set via the dropdown.
  const empty: PartialPermissionSet = emptyPermissionSet();
  const allowAll: PartialPermissionSet = makePermissionSet(availableBits, () => 'allow');
  const denyAll: PartialPermissionSet = makePermissionSet(availableBits, () => 'deny');
  const readOnly: PartialPermissionSet = makePermissionSet(availableBits, (b) => b === 'read' ? 'allow' : 'deny');
  const setPermissions = (p: PartialPermissionSet) => {
    options.sanityCheck?.(p);
    pset.set(p);
  };

  return cssPermissions(
    dom.forEach(availableBits, (bit) => {
      return cssBit(
        bit.slice(0, 1).toUpperCase(),              // Show the first letter of the property (e.g. "R" for "read")
        cssBit.cls((use) => '-' + use(pset)[bit]),  // -allow, -deny class suffixes.
        dom.attr('title', (use) => capitalize(`${use(pset)[bit]} ${bit}`.trim())),    // Explanation on hover
        dom.cls('disabled', options.disabled),
        // Cycle the bit's value on click, unless disabled.
        (options.disabled ? null :
          dom.on('click', () => setPermissions({...pset.get(), [bit]: next(pset.get()[bit])}))
        )
      );
    }),
    cssIconButton(icon('Dropdown'), testId('permissions-dropdown'), menu(() => {
      // Show a disabled "Custom" menu item if the permission set isn't a recognized one, for
      // information purposes.
      const isCustom = [allowAll, denyAll, readOnly, empty].every(ps => !isEqual(ps, pset.get()));
      return [
        (isCustom ?
          cssMenuItem(() => null, dom.cls('disabled'), menuIcon('Tick'),
            cssMenuItemContent(
              'Custom',
              cssMenuItemDetails(dom.text((use) => psetDescription(use(pset))))
            ),
          ) :
          null
        ),
        // If the set matches any recognized pattern, mark that item with a tick (checkmark).
        cssMenuItem(() => setPermissions(allowAll), tick(isEqual(pset.get(), allowAll)), t("Allow All"),
          dom.cls('disabled', options.disabled)
        ),
        cssMenuItem(() => setPermissions(denyAll), tick(isEqual(pset.get(), denyAll)), t("Deny All"),
          dom.cls('disabled', options.disabled)
        ),
        cssMenuItem(() => setPermissions(readOnly), tick(isEqual(pset.get(), readOnly)), t("Read Only"),
          dom.cls('disabled', options.disabled)
        ),
        cssMenuItem(() => setPermissions(empty),
          // For the empty permission set, it seems clearer to describe it as "No Effect", but to
          // all it "Clear" when offering to the user as the action.
          isEqual(pset.get(), empty) ? [tick(true), 'No Effect'] : [tick(false), 'Clear'],
          dom.cls('disabled', options.disabled),
        ),
      ];
    })),
    ...args
  );
}

function next(pvalue: PartialPermissionValue): PartialPermissionValue {
  switch (pvalue) {
    case 'allow': return '';
    case 'deny': return 'allow';
  }
  return 'deny';
}

// Helper to build up permission sets.
function makePermissionSet(bits: PermissionKey[], makeValue: (bit: PermissionKey) => PartialPermissionValue) {
  const pset = emptyPermissionSet();
  for (const bit of bits) {
    pset[bit] = makeValue(bit);
  }
  return pset;
}

// Helper for a tick (checkmark) icon, replacing it with an equivalent space when not shown.
function tick(show: boolean) {
  return show ? menuIcon('Tick') : cssMenuIconSpace();
}

// Human-readable summary of the permission set. E.g. "Allow Read. Deny Update, Create.".
function psetDescription(permissionSet: PartialPermissionSet): string {
  const allow: string[] = [];
  const deny: string[] = [];
  for (const prop of ALL_PERMISSION_PROPS) {
    const value = permissionSet[prop];
    if (value === "allow") {
      allow.push(capitalize(prop));
    } else if (value === "deny") {
      deny.push(capitalize(prop));
    }
  }
  const parts: string[] = [];
  if (allow.length) { parts.push(`Allow ${allow.join(", ")}.`); }
  if (deny.length) { parts.push(`Deny ${deny.join(", ")}.`); }
  return parts.join(' ');
}

/**
 * Sort the bits in a standard way for viewing, since they could be in any order
 * in the underlying rule store. And in fact ACLPermissions.permissionSetToText
 * uses an order (CRUDS) that is different from how things have been historically
 * rendered in the UI (RUCDS).
 */
function sortBits(bits: PermissionKey[]) {
  return bits.sort((a, b) => {
    const aIndex = PERMISSION_BIT_ORDER.indexOf(a.slice(0, 1).toUpperCase());
    const bIndex = PERMISSION_BIT_ORDER.indexOf(b.slice(0, 1).toUpperCase());
    return aIndex - bIndex;
  });
}

const cssPermissions = styled('div', `
  display: flex;
  gap: 4px;
`);

const cssBit = styled('div', `
  flex: none;
  height: 24px;
  width: 24px;
  border-radius: 2px;
  font-size: 13px;
  font-weight: 500;
  border: 1px dashed ${theme.accessRulesTableBodyLightFg};
  color: ${theme.accessRulesTableBodyLightFg};
  cursor: pointer;

  display: flex;
  align-items: center;
  justify-content: center;

  &-allow {
    background-color: ${colors.lightGreen};
    border: 1px solid ${colors.lightGreen};
    color: white;
  }
  &-deny {
    background-image: linear-gradient(-45deg, ${colors.error} 14px, white 15px 16px, ${colors.error} 16px);
    border: 1px solid ${colors.error};
    color: white;
  }
  &.disabled {
    opacity: 0.5;
  }
`);

const cssMenuIconSpace = styled('div', `
  width: 24px;
`);

// Don't make disabled item too hard to see here.
const cssMenuItem = styled(menuItem, `
  align-items: start;
  &.disabled {
    opacity: unset;
  }
`);

const cssMenuItemContent = styled('div', `
  display: flex;
  flex-direction: column;
`);

const cssMenuItemDetails = styled('div', `
  font-size: 12px;
`);
