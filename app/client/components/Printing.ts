import {CustomView} from 'app/client/components/CustomView';
import {DataRowModel} from 'app/client/models/DataRowModel';
import DataTableModel from 'app/client/models/DataTableModel';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {prefersDarkMode, prefersDarkModeObs} from 'app/client/ui2018/cssVars';
import {dom} from 'grainjs';

type RowId = number|'new';

/**
 * Print the specified viewSection (aka page widget). We use the existing view instance rather
 * than render a new one, since it may have state local to this instance view, such as current
 * filters.
 *
 * Views get a chance to render things specially for printing (which is needed when they use
 * scrolly for normal rendering).
 *
 * To let an existing view print across multiple pages, we can't have it nested in a flexbox or a
 * div with 'height: 100%'. We achieve it by forcing all parents of our view to have a simple
 * layout. This is potentially fragile.
 */
export async function printViewSection(layout: any, viewSection: ViewSectionRec) {
  const viewInstance = viewSection.viewInstance.peek();
  const sectionElem = viewInstance?.viewPane?.closest('.viewsection_content');
  if (!sectionElem) {
    throw new Error("No page widget to print");
  }
  if (viewInstance instanceof CustomView) {
    try {
      await viewInstance.triggerPrint();
      return;
    } catch (e) {
      // tslint:disable-next-line:no-console
      console.warn(`Failed to trigger print in CustomView: ${e}`);
      // continue on to trying to print from outside, which should work OK for a single page.
    }
  }

  function prepareToPrint(onOff: boolean) {
    // window.print() is a blocking call, which means our listener for the
    // `prefers-color-scheme: dark` media feature will not receive any updates for the
    // duration that the print dialog is shown. This proves problematic since an event is
    // sent just before the blocking call containing a value of false, regardless of the
    // user agent's color scheme preference. It's not clear why this happens, but the result
    // is Grist temporarily reverting to the light theme until the print dialog is dismissed.
    // As a workaround, we'll temporarily pause our listener, and unpause after the print dialog
    // is dismissed.
    prefersDarkModeObs().pause();

    // Hide all layout boxes that do NOT contain the section to be printed.
    layout?.forEachBox((box: any) => {
      if (!box.dom.contains(sectionElem)) {
        box.dom.classList.toggle('print-hide', onOff);
      }
    });

    // Mark the section to be printed.
    sectionElem.classList.toggle('print-widget', onOff);

    // Let the view instance update its rendering, e.g. to render all rows when scrolly is in use.
    viewInstance?.prepareToPrint(onOff);

    // If .print-all-rows element is present (created for scrolly-based views), use it as the
    // start element for the loop below, to ensure it's rendered flexbox-free.
    const keyElem = sectionElem.querySelector('.print-all-rows') || sectionElem;

    // Go through all parents of the element to be printed. For @media print, we override their
    // layout in a heavy-handed way, forcing them all to be non-flexbox and sized to content,
    // since our normal flexbox-based layout is sized to screen and would not print multiple pages.
    let elem = keyElem.parentElement;
    while (elem) {
      elem.classList.toggle('print-parent', onOff);
      elem = elem.parentElement;
    }
  }

  const sub1 = dom.onElem(window, 'beforeprint', () => prepareToPrint(true));
  const sub2 = dom.onElem(window, 'afterprint', (window as any).afterPrintCallback = () => {
    sub1.dispose();
    sub2.dispose();
    // To debug printing, set window.debugPrinting=1 in the console, then print a section, dismiss
    // the print dialog, switch to "@media print" emulation, and you can explore the styles. You'd
    // need to call window.finishPrinting() or reload the page to do it again.
    if ((window as any).debugPrinting) {
      (window as any).finishPrinting = () => prepareToPrint(false);
    } else {
      prepareToPrint(false);
    }
    delete (window as any).afterPrintCallback;
    prefersDarkModeObs().pause(false);

    // This may have changed while window.print() was blocking.
    prefersDarkModeObs().set(prefersDarkMode());
  });

  // Running print on a timeout makes it possible to test printing using selenium, and doesn't
  // seem to affect normal printing.
  setTimeout(() => window.print(), 0);
}


/**
 * Produces a div with all requested rows using the same renderRow() function as used with scrolly
 * for dynamically rendered views. This is used for printing, so these rows do not subscribe to
 * data.
 *
 * To avoid creating a lot of subscriptions when rendering rows this way, we render one DOM row at
 * a time, copy the produced HTML, and dispose the produced DOM.
 */
export function renderAllRows(
  tableModel: DataTableModel, rowIds: RowId[], renderRow: (r: DataRowModel) => Element,
) {
  const rowModel = tableModel.createFloatingRowModel(null) as DataRowModel;
  const html: string[] = [];
  rowIds.forEach((rowId, index) => {
    if (rowId !== 'new') {
      rowModel._index(index);
      rowModel.assign(rowId);
      const elem = renderRow(rowModel);
      html.push(`<div class="print-row">${elem.outerHTML}</div>`);
      dom.domDispose(elem);
    }
  });
  rowModel.dispose();
  const result = dom('div.print-all-rows');
  result.innerHTML = html.join("\n");
  return result;
}
