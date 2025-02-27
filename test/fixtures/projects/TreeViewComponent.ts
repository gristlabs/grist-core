import { TreeItem } from "app/client/models/TreeModel";
import { TreeViewComponent } from "app/client/ui/TreeViewComponent";
import { cssRootVars } from 'app/client/ui2018/cssVars';
import { dom, MutableObsArray, obsArray, observable, styled } from "grainjs";
import constant = require('lodash/constant');
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

const modelCalls = obsArray<string>();
const disposed = obsArray<string>();
const selected = observable<TreeItem|null>(null);

function getLabel(item: TreeItem|null) {
  return item ? (item as any).label : "null";
}

function callbacks(label: string) {
  return {
    insertBefore: (newChild: TreeItem, nextChild: TreeItem|null) => modelCalls.push(
      `insert ${getLabel(newChild)} before ${getLabel(nextChild)} in ${label}`
    ),
    removeChild: (child: TreeItem) => modelCalls.push(
      `remove child ${getLabel(child)} from ${label}`
    )
  };
}

function treeItem(label: string, children: TreeItem[]|null = null) {
  let item: any;
  return item = {
    label,
    buildDom: () => dom('div',
      dom.text(label),
      dom.onDispose(() => disposed.push(label)),
      dom.on('click', () => selected.set(item))
    ),
    children: constant(children ? obsArray(children) : null),
    ...callbacks(label)
  };
}

function buildTreeModel() {
  return {
    children: constant(obsArray([
      treeItem('Page1', [
        treeItem('Page2'),
        treeItem('Page3', [
          treeItem('Page4')
        ])
      ]),
      treeItem('Page5', []),
      treeItem('Page6')
    ])),
    ...callbacks('Root')
  };
}

const treeModel = observable(buildTreeModel());

const subFolderChildren = () => treeModel.get().children().get()[0].children() as MutableObsArray<TreeItem>;

function setupTest() {
  const isOpen = observable(true);
  const isReadonly = observable(false);
  return [
    testBox(
      dom.style('width', '224px'),
      dom.create(TreeViewComponent, treeModel, {expanderDelay: 1100, isOpen, dragStartDelay: 500, selected, isReadonly})
    ),
    testBox(
      dom.style('float', 'right'),
      dom('input.insert', {type: 'button', value: 'top insert'},
        dom.on('click', () => treeModel.get().children().push(treeItem('New Page')))
      ),
      dom('input.subInsert', {type: 'button', value: 'sub insert'},
        dom.on('click', () => subFolderChildren().push(treeItem('New Page 5')))
      ),
      dom('input.clearLogs', {type: 'button', value: 'clear calls'},
        dom.on('click', () => {
          modelCalls.set([]);
          disposed.set([]);
        })
      ),
      dom('input.reset', {type: 'button', value: 'reset'},
        dom.on('click', () => treeModel.set(buildTreeModel()))),
      dom('input.move', {type: 'button', value: 'move'},
        dom.on('click', () => {
          const src = treeModel.get().children().get()[0]!;
          const dest = treeModel.get();
          const item = src.children()!.get()[1];
          // removeChild
          src.children()!.splice(1, 1);
          // insertBefore
          dest.children().splice(2, 0, item as any);
        })),
      dom('input.remove', {type: 'button', value: 'remove'},
        dom.on('click', () => {
          treeModel.get().children().splice(0, 1);
        })),
      dom('input.removePage4', {type: 'button', value: 'remove Page4'},
        dom.on('click', () => {
          const page1 = treeModel.get().children().get()[0];
          const page3 = page1.children()!.get()[1];
          // remove page4
          page3.children()!.get().splice(0, 1);
          // then resinsert page3 to update
          page1.children()!.splice(1, 1, page3);
        })),
      dom('h3', 'Options'),
      dom(
        'div',
        dom(
          'input.isOpen', {type: 'checkbox', value: 'isOpen', checked: true},
          dom.on('click', () => isOpen.set(!isOpen.get()))
        ),
        'isOpen option'
      ),
      dom(
        'div',
        dom(
          'input.isReadonly', {type: 'checkbox', value: 'isReadonly', checked: false},
          dom.on('click', () => isReadonly.set(!isReadonly.get()))
        ),
        'readonly mode'
      ),
    )
  ];
}

const testBox = styled('div', `
  width: 25rem;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  padding: 1rem;
  margin: 1rem;
`);

void withLocale(() => {
  dom.update(document.body, dom.cls(cssRootVars), setupTest(),
    dom('h3', "model calls"),
    dom.forEach(modelCalls, (log) => dom('div.model-calls', log)),
    dom('h3', "Disposed Items: "),
    dom.forEach(disposed, (log) => dom('div.disposed-items', log)));
});
