import { BaseItem, MultiItemSelector } from "app/client/ui/MultiSelector";
import { dom, MutableObsArray, obsArray, styled } from "grainjs";
import { States } from "test/fixtures/projects/helpers/States";
import { withLocale } from "test/fixtures/projects/helpers/withLocale";

// Sample data
class StateSelector extends MultiItemSelector<{ label: string, value: string }> {

  protected static defaultItem: BaseItem;

  constructor(_myStates: MutableObsArray<BaseItem> = obsArray([])) {
    super(_myStates, obsArray(States), {
      addItemText: "Add new state",
      addItemLabel: "Select state"
    });
  }
}

function setupTest() {
  const _myStates = obsArray([]);
  return cssTestBox(
    dom.create(StateSelector, _myStates),
    dom('pre', dom.text(use => JSON.stringify(use(_myStates), null, 2)))
  );
}

const cssTestBox = styled('div', `
  display: flex;
`);

void withLocale(() => dom.update(document.body, setupTest()));
