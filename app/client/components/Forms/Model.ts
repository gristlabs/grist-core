import {FormLayoutNode, FormLayoutNodeType} from 'app/client/components/FormRenderer';
import * as elements from 'app/client/components/Forms/elements';
import {FormView} from 'app/client/components/Forms/FormView';
import {bundleChanges, Computed, Disposable, dom, IDomArgs, MutableObsArray, obsArray, Observable} from 'grainjs';

type Callback = () => Promise<void>;

/**
 * A place where to insert a box.
 */
export type Place = (box: FormLayoutNode) => BoxModel;

/**
 * View model constructed from a box JSON structure.
 */
export abstract class BoxModel extends Disposable {

  /**
   * A factory method that creates a new BoxModel from a Box JSON by picking the right class based on the type.
   */
  public static new(box: FormLayoutNode, parent: BoxModel | null, view: FormView | null = null): BoxModel {
    const subClassName = `${box.type.split(':')[0]}Model`;
    const factories = elements as any;
    const factory = factories[subClassName];
    if (!parent && !view) { throw new Error('Cannot create detached box'); }
    // If we have a factory, use it.
    if (factory) {
      return new factory(box, parent, view || parent!.view);
    }
    // Otherwise, use the default.
    return new DefaultBoxModel(box, parent, view || parent!.view);
  }

  /**
   * The unique id of the box.
   */
  public id: string;
  /**
   * Type of the box. As the type is bounded to the class that is used to render the box, it is possible
   * to change the type of the box just by changing this value. The box is then replaced in the parent.
   */
  public type: FormLayoutNodeType;
  /**
   * List of children boxes.
   */
  public children: MutableObsArray<BoxModel>;
  /**
   * Publicly exposed state if the element was just cut.
   * TODO: this should be moved to FormView, as this model doesn't care about that.
   */
  public cut = Observable.create(this, false);

  /**
   * Computed if this box is selected or not.
   */
  public selected: Computed<boolean>;

  /**
   * Any other dynamically added properties (that are not concrete fields in the derived classes)
   */
  private _props: Record<string, Observable<any>> = {};
  /**
   * Don't use it directly, use the BoxModel.new factory method instead.
   */
  constructor(box: FormLayoutNode, public parent: BoxModel | null, public view: FormView) {
    super();

    this.selected = Computed.create(this, (use) => use(view.selectedBox) === this && use(view.viewSection.hasFocus));

    this.children = this.autoDispose(obsArray([]));

    // We are owned by the parent children list.
    if (parent) {
      parent.children.autoDispose(this);
    }

    this.id = box.id;

    // Create observables for all properties.
    this.type = box.type;

    // And now update this and all children based on the box JSON.
    bundleChanges(() => {
      this.update(box);
    });

    // Some boxes need to do some work after initialization, so we call this method.
    // Of course, they also can override the constructor, but this is a bit easier.
    this.onCreate();
  }

  /**
   * The only method that derived classes need to implement. It should return a DOM element that
   * represents this box.
   */
  public abstract render(...args: IDomArgs<HTMLElement>): HTMLElement;


  public removeChild(box: BoxModel) {
    const myIndex = this.children.get().indexOf(box);
    if (myIndex < 0) { throw new Error('Cannot remove box that is not in parent'); }
    this.children.splice(myIndex, 1);
  }

  /**
   * Remove self from the parent without saving.
   */
  public removeSelf() {
    this.parent?.removeChild(this);
  }

  /**
   * Remove self from the parent and save. Use to bundle layout save with any other changes.
   * See Fields for the implementation.
   * TODO: this is needed as action bundling is very limited.
   */
  public async deleteSelf() {
    const parent = this.parent;
    this.removeSelf();
    await parent!.save();
  }

  /**
   * Copies self and puts it into clipboard.
   */
  public async copySelf() {
    [...this.root().traverse()].forEach(box => box?.cut.set(false));
    // Add this box as a json to clipboard.
    await navigator.clipboard.writeText(JSON.stringify(this.toJSON()));
  }

  /**
   * Cuts self and puts it into clipboard.
   */
  public async cutSelf() {
    await this.copySelf();
    this.cut.set(true);
  }

  /**
   * The way this box will accept dropped content.
   * - sibling: it will add it as a sibling
   * - child: it will add it as a child.
   * - swap: swaps with the box
   */
  public willAccept(box?: FormLayoutNode|BoxModel|null): 'sibling' | 'child' | 'swap' | null {
    // If myself and the dropped element share the same parent, and the parent is a column
    // element, just swap us.
    if (this.parent && box instanceof BoxModel && this.parent === box?.parent && box.parent?.type === 'Columns') {
      return 'swap';
    }

    // If we are in column, we won't accept anything.
    if (this.parent?.type === 'Columns') { return null; }

    return 'sibling';
  }

  /**
   * Accepts box from clipboard and inserts it before this box or if this is a container box, then
   * as a first child. Default implementation is to insert before self.
   */
  public accept(dropped: FormLayoutNode, hint: 'above'|'below' = 'above') {
    // Get the box that was dropped.
    if (!dropped) { return null; }
    if (dropped.id === this.id) {
      return null;
    }
    // We need to remove it from the parent, so find it first.
    const droppedId = dropped.id;
    const droppedRef = droppedId ? this.root().find(droppedId) : null;
    if (droppedRef) {
      droppedRef.removeSelf();
    }
    return hint === 'above' ? this.placeBeforeMe()(dropped) : this.placeAfterMe()(dropped);
  }

  public prop(name: string, defaultValue?: any) {
    if (!this._props[name]) {
      this._props[name] = Observable.create(this, defaultValue ?? null);
    }
    return this._props[name];
  }

  public hasProp(name: string) {
    return this._props.hasOwnProperty(name);
  }

  public async save(before?: () => Promise<void>): Promise<void> {
    if (!this.parent) { throw new Error('Cannot save detached box'); }
    return this.parent.save(before);
  }

  /**
   * Replaces children at index.
   */
  public replaceAtIndex(box: FormLayoutNode, index: number) {
    const newOne = BoxModel.new(box, this);
    this.children.splice(index, 1, newOne);
    return newOne;
  }

  public swap(box1: BoxModel, box2: BoxModel) {
    const index1 = this.children.get().indexOf(box1);
    const index2 = this.children.get().indexOf(box2);
    if (index1 < 0 || index2 < 0) { throw new Error('Cannot swap boxes that are not in parent'); }
    const box1JSON = box1.toJSON();
    const box2JSON = box2.toJSON();
    this.replace(box1, box2JSON);
    this.replace(box2, box1JSON);
  }

  public append(box: FormLayoutNode) {
    const newOne = BoxModel.new(box, this);
    this.children.push(newOne);
    return newOne;
  }

  public insert(box: FormLayoutNode, index: number) {
    const newOne = BoxModel.new(box, this);
    this.children.splice(index, 0, newOne);
    return newOne;
  }


  /**
   * Replaces existing box with a new one, whenever it is found.
   */
  public replace(existing: BoxModel, newOne: FormLayoutNode|BoxModel) {
    const index = this.children.get().indexOf(existing);
    if (index < 0) { throw new Error('Cannot replace box that is not in parent'); }
    const model = newOne instanceof BoxModel ? newOne : BoxModel.new(newOne, this);
    model.parent = this;
    model.view = this.view;
    this.children.splice(index, 1, model);
    return model;
  }

  /**
   * Creates a place to insert a box before this box.
   */
  public placeBeforeFirstChild() {
    return (box: FormLayoutNode) => this.insert(box, 0);
  }

  // Some other places.
  public placeAfterListChild() {
    return (box: FormLayoutNode) => this.insert(box, this.children.get().length);
  }

  public placeAt(index: number) {
    return (box: FormLayoutNode) => this.insert(box, index);
  }

  public placeAfterChild(child: BoxModel) {
    return (box: FormLayoutNode) => this.insert(box, this.children.get().indexOf(child) + 1);
  }

  public placeAfterMe() {
    return this.parent!.placeAfterChild(this);
  }

  public placeBeforeMe() {
    return this.parent!.placeAt(this.parent!.children.get().indexOf(this));
  }

  public insertAfter(json: any) {
    return this.parent!.insert(json, this.parent!.children.get().indexOf(this) + 1);
  }

  public insertBefore(json: any) {
    return this.parent!.insert(json, this.parent!.children.get().indexOf(this));
  }

  public root() {
    let root: BoxModel = this;
    while (root.parent) { root = root.parent; }
    return root;
  }

  /**
   * Finds a box with a given id in the tree.
   */
  public find(droppedId: string|undefined|null): BoxModel | null {
    if (!droppedId) { return null; }
    for (const child of this.kids()) {
      if (child.id === droppedId) { return child; }
      const found = child.find(droppedId);
      if (found) { return found; }
    }
    return null;
  }

  public* filter(filter: (box: BoxModel) => boolean): Iterable<BoxModel> {
    for (const child of this.kids()) {
      if (filter(child)) { yield child; }
      yield* child.filter(filter);
    }
  }

  public includes(box: BoxModel) {
    for (const child of this.kids()) {
      if (child === box) { return true; }
      if (child.includes(box)) { return true; }
    }
  }

  public kids() {
    return this.children.get().filter(Boolean);
  }

  /**
   * The core responsibility of this method is to update this box and all children based on the box JSON.
   * This is counterpart of the FloatingRowModel, that enables this instance to point to a different box.
   */
  public update(boxDef: FormLayoutNode) {
    // If we have a type and the type is changed, then we need to replace the box.
    if (this.type && boxDef.type !== this.type) {
      if (!this.parent) { throw new Error('Cannot replace detached box'); }
      this.parent.replace(this, BoxModel.new(boxDef, this.parent));
      return;
    }

    // Update all properties of self.
    for (const someKey in boxDef) {
      const key = someKey as keyof FormLayoutNode;
      // Skip some keys.
      if (key === 'id' || key === 'type' || key === 'children') { continue; }
      // Skip any inherited properties.
      if (!boxDef.hasOwnProperty(key)) { continue; }
      // Skip if the value is the same.
      if (this.prop(key).get() === boxDef[key]) { continue; }
      this.prop(key).set(boxDef[key]);
    }

    // First remove any children from the model that aren't in `boxDef`.
    const boxDefChildren = boxDef.children ?? [];
    const boxDefChildrenIds = new Set(boxDefChildren.map(c => c.id));
    for (const child of this.children.get()) {
      if (!boxDefChildrenIds.has(child.id)) {
        child.removeSelf();
      }
    }

    // Then add or update the children from `boxDef` to the model.
    const newChildren: BoxModel[] = [];
    const modelChildrenById = new Map(this.children.get().map(c => [c.id, c]));
    for (const boxDefChild of boxDefChildren) {
      if (!boxDefChild.id || !modelChildrenById.has(boxDefChild.id)) {
        newChildren.push(BoxModel.new(boxDefChild, this));
      } else {
        const existingChild = modelChildrenById.get(boxDefChild.id)!;
        existingChild.update(boxDefChild);
        newChildren.push(existingChild);
      }
    }
    this.children.set(newChildren);
  }

  /**
   * Serialize this box to JSON.
   */
  public toJSON(): FormLayoutNode {
    return {
      id: this.id,
      type: this.type,
      children: this.children.get().map(child => child?.toJSON() || null),
      ...(Object.fromEntries(Object.entries(this._props).map(([key, val]) => [key, val.get()]))),
    };
  }

  public * traverse(): IterableIterator<BoxModel> {
    for (const child of this.kids()) {
      yield child;
      yield* child.traverse();
    }
  }

  public canRemove() {
    return true;
  }

  protected onCreate() {

  }
}

export class LayoutModel extends BoxModel {
  public disableDeleteSection: Computed<boolean>;

  constructor(
    box: FormLayoutNode,
    public parent: BoxModel | null,
    public _save: (clb?: Callback) => Promise<void>,
    public view: FormView
  ) {
    super(box, parent, view);
    this.disableDeleteSection = Computed.create(this, use => {
      return use(this.children).filter(c => c.type === 'Section').length === 1;
    });
  }

  public async save(clb?: Callback) {
    return await this._save(clb);
  }

  public override render(): HTMLElement {
    throw new Error('Method not implemented.');
  }
}

class DefaultBoxModel extends BoxModel {
  public render(): HTMLElement {
    return dom('div', `Unknown box type ${this.type}`);
  }
}

export const ignoreClick = dom.on('click', (ev) => {
  ev.stopPropagation();
  ev.preventDefault();
});

export function unwrap<T>(val: T | Computed<T>): T {
  return val instanceof Computed ? val.get() : val;
}

export function parseBox(text: string): FormLayoutNode|null {
  try {
    const json = JSON.parse(text);
    return json && typeof json === 'object' && json.type ? json : null;
  } catch (e) {
    return null;
  }
}
