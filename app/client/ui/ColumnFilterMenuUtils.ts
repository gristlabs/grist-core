import { Placement } from "@popperjs/core";
import { IRangeBoundType, isEquivalentBound } from "app/common/FilterState";
import { Disposable, dom, Observable } from "grainjs";
import { IOpenController, IPopupOptions, PopupControl } from "popweasel";
import { popupControl } from "app/client/lib/popupControl";
import { IOptionFull, SimpleList } from "app/client/lib/simpleList";
import { relativeDatesOptions } from "app/client/ui/RelativeDatesOptions";

export interface IOptionsDropdownOpt {
  placement: Placement;
  valueFormatter(val: any): string
}

// Create a popup control that show the relative dates options for obs in a popup attached to
// reference.
export function relativeDatesControl(
  reference: HTMLElement,
  obs: Observable<IRangeBoundType>,
  opt: {valueFormatter(val: any): string} & IPopupOptions): PopupControl {
  const popupCtl = popupControl(
    reference,
    ctl => RelativeDatesMenu.create(null, ctl, obs, opt).content,
    opt,
  );
  dom.autoDisposeElem(reference, popupCtl);
  return popupCtl;
}

// Builds the list of relatives dates to show in a popup next to the range inputs for date
// filtering. It does not still focus from the range input and takes care of keyboard navigation
// using arrow Up/Down, Escape to close the menu and enter to trigger select option.
class RelativeDatesMenu extends Disposable {

  public content: Element;
  private _dropdownList: SimpleList<IRangeBoundType>;
  private _items: Observable<Array<IOptionFull<IRangeBoundType>>> = Observable.create(this, []);
  constructor(ctl: IOpenController,
              private _obs: Observable<IRangeBoundType>,
              private _opt: {valueFormatter(val: any): string}) {
    super();
    this._dropdownList = SimpleList<IRangeBoundType>.create(this, ctl, this._items, this._action.bind(this));
    this._dropdownList.listenKeys(ctl.getTriggerElem() as HTMLElement);
    this.content = this._dropdownList.content;
    this.autoDispose(this._obs.addListener(() => this._update()));
    this._update();
  }

  private _getOptions() {
    const newItems = relativeDatesOptions(this._obs.get(), this._opt.valueFormatter);
    return newItems.map(item => ({label: item.label, value: item.spec}));
  }

  private _update() {
    this._items.set(this._getOptions());
    const index = this._items.get().findIndex(o => isEquivalentBound(o.value, this._obs.get()));
    this._dropdownList.setSelected(index ?? -1);
  }

  private _action(value: IRangeBoundType) {
    this._obs.set(value);
  }
}
