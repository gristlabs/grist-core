import {HomeModel} from 'app/client/models/HomeModel';

export function attachAddNewTip(home: HomeModel): (el: Element) => void {
  return () => {
    if (shouldShowAddNewTip(home)) {
      showAddNewTip(home);
    }
  };
}

function shouldShowAddNewTip(home: HomeModel): boolean {
  return (
    // Only show if the user is an owner or editor.
    home.app.isOwnerOrEditor() &&
    // And the tip hasn't been shown before.
    home.shouldShowAddNewTip.get() &&
    // And the site isn't empty.
    !home.empty.get() &&
    // And home page cards aren't being shown.
    !(home.currentPage.get() === 'all' && !home.onlyShowDocuments.get()) &&
    // And the workspace loaded correctly.
    home.available.get() &&
    // And the current page isn't /p/trash; the Add New button is limited there.
    home.currentPage.get() !== 'trash'
  );
}

function showAddNewTip(home: HomeModel): void {
  const addNewButton = document.querySelector('.behavioral-prompt-add-new');
  if (!addNewButton) {
    console.warn('AddNewTip failed to find Add New button');
    return;
  }
  if (!isVisible(addNewButton as HTMLElement)) {
    return;
  }

  home.app.behavioralPromptsManager.showPopup(addNewButton, 'addNew', {
    popupOptions: {
      placement: 'right-start',
    },
    onDispose: () => home.shouldShowAddNewTip.set(false),
  });
}

function isVisible(element: HTMLElement): boolean {
  // From https://github.com/jquery/jquery/blob/c66d4700dcf98efccb04061d575e242d28741223/src/css/hiddenVisibleSelectors.js.
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}
