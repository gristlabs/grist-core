import {ThemeColors} from 'app/common/ThemePrefs';

export const GristLight: ThemeColors = {
  /* Text */
  'text': '#262633',
  'text-light': '#929299',
  'text-dark': 'black',
  'text-error': '#D0021B',
  'text-danger': '#FFA500',
  'text-disabled': '#929299',

  /* Page */
  'page-bg': '#F7F7F7',
  'page-backdrop': 'grey',

  /* Page Panels */
  'page-panels-main-panel-bg': 'white',
  'page-panels-left-panel-bg': '#F7F7F7',
  'page-panels-right-panel-bg': '#F7F7F7',
  'page-panels-top-header-bg': 'white',
  'page-panels-bottom-footer-bg': 'white',
  'page-panels-border': 'rgba(217,217,217,0.6)',
  'page-panels-border-resizing': '#16B378',
  'page-panels-side-panel-opener-fg': '#929299',
  'page-panels-side-panel-opener-active-fg': 'white',
  'page-panels-side-panel-opener-active-bg': '#16B378',

  /* Add New */
  'add-new-circle-fg': '#FFFFFF',
  'add-new-circle-bg': '#009058',
  'add-new-circle-hover-bg': '#007548',
  'add-new-circle-small-fg': '#FFFFFF',
  'add-new-circle-small-bg': '#16B378',
  'add-new-circle-small-hover-bg': '#009058',

  /* Top Bar */
  'top-bar-button-primary-fg': '#16B378',
  'top-bar-button-secondary-fg': '#929299',
  'top-bar-button-disabled-fg': '#D9D9D9',
  'top-bar-button-error-fg': '#D0021B',

  /* Notifications */
  'notifications-panel-header-bg': '#F7F7F7',
  'notifications-panel-body-bg': 'white',
  'notifications-panel-border': '#D9D9D9',

  /* Toasts */
  'toast-text': '#FFFFFF',
  'toast-text-light': '#929299',
  'toast-bg': '#040404',
  'toast-memo-text': '#FFFFFF',
  'toast-memo-bg': '#262633',
  'toast-error-icon': '#D0021B',
  'toast-error-bg': '#D0021B',
  'toast-success-icon': '#009058',
  'toast-success-bg': '#009058',
  'toast-warning-icon': '#F9AE41',
  'toast-warning-bg': '#DD962C',
  'toast-info-icon': '#3B82F6',
  'toast-info-bg': '#3B82F6',
  'toast-control-fg': '#16B378',
  'toast-control-info-fg': '#87B2F9',

  /* Tooltips */
  'tooltip-fg': 'white',
  'tooltip-bg': 'rgba(0, 0, 0, 0.75)',
  'tooltip-icon': '#929299',
  'tooltip-close-button-fg': 'white',
  'tooltip-close-button-hover-fg': 'black',
  'tooltip-close-button-hover-bg': 'white',
  'tooltip-popup-header-fg': 'white',
  'tooltip-popup-header-bg': '#16B378',

  /* Modals */
  'modal-bg': 'white',
  'modal-backdrop': 'rgba(38,38,51,0.9)',
  'modal-border': '#E8E8E8',
  'modal-border-dark': '#D9D9D9',
  'modal-border-hover': '#929299',
  'modal-shadow-inner': 'rgba(31,37,50,0.31)',
  'modal-shadow-outer': 'rgba(76,86,103,0.24)',
  'modal-close-button-fg': '#929299',
  'modal-backdrop-close-button-fg': '#16B378',
  'modal-backdrop-close-button-hover-fg': '#B1FFE2',

  /* Popups */
  'popup-bg': 'white',
  'popup-shadow-inner': 'rgba(31, 37, 50, 0.31)',
  'popup-shadow-outer': 'rgba(76, 86, 103, 0.24)',
  'popup-close-button-fg': '#929299',

  /* Prompts */
  'prompt-fg': '#606060',

  /* Progress Bars */
  'progress-bar-fg': '#16B378',
  'progress-bar-error-fg': '#D0021B',
  'progress-bar-bg': '#D9D9D9',

  /* Links */
  'link': '#16B378',
  'link-hover': '#16B378',

  /* Hover */
  'hover': 'rgba(217,217,217,0.6)',
  'hover-light': '#F7F7F7',

  /* Cell Editor */
  'cell-editor-fg': '#262633',
  'cell-editor-bg': '#FFFFFF',

  /* Cursor */
  'cursor': '#16B378',
  'cursor-inactive': '#A2E1C9',
  'cursor-readonly': '#929299',

  /* Tables */
  'table-header-fg': 'unset',
  'table-header-selected-fg': 'unset',
  'table-header-bg': '#F7F7F7',
  'table-header-selected-bg': '#E8E8E8',
  'table-header-border': 'lightgray',
  'table-header-border-dark': '#D9D9D9',
  'table-body-bg': 'white',
  'table-body-border': '#D9D9D9',
  'table-add-new-bg': 'inherit',
  'table-scroll-shadow': '#444444',
  'table-frozen-columns-border': '#999999',
  'table-drag-drop-indicator': 'gray',
  'table-drag-drop-shadow': '#F0F0F0',

  /* Cards */
  'card-compact-widget-bg': 'rgba(217,217,217,0.6)',
  'card-compact-record-bg': 'white',
  'card-blocks-bg': 'rgba(217,217,217,0.6)',
  'card-form-label': '#929299',
  'card-compact-label': '#929299',
  'card-blocks-label': '#929299',
  'card-form-border': 'lightgrey',
  'card-compact-border': '#D9D9D9',
  'card-editing-layout-bg': 'rgba(192, 192, 192, 0.2)',
  'card-editing-layout-border': '#D9D9D9',

  /* Card Lists */
  'card-list-form-border': '#D9D9D9',
  'card-list-blocks-border': '#D9D9D9',

  /* Selection */
  'selection': 'rgba(22,179,120,0.15)',
  'selection-opaque-fg': 'black',
  'selection-opaque-bg': '#DCF4EB',
  'selection-opaque-dark-bg': '#D6EEE5',

  /* Widgets */
  'widget-bg': 'white',
  'widget-border': '#D9D9D9',
  'widget-active-border': '#16B378',
  'widget-inactive-stripes-light': '#F7F7F7',
  'widget-inactive-stripes-dark': '#E8E8E8',

  /* Pinned Docs */
  'pinned-doc-footer-bg': 'white',
  'pinned-doc-border': 'rgba(217,217,217,0.6)',
  'pinned-doc-border-hover': '#929299',
  'pinned-doc-editor-bg': 'rgba(217,217,217,0.6)',

  /* Raw Data */
  'raw-data-table-border': 'rgba(217,217,217,0.6)',
  'raw-data-table-border-hover': '#929299',

  /* Controls */
  'control-fg': '#16B378',
  'control-primary-fg': '#FFFFFF',
  'control-primary-bg': '#16B378',
  'control-secondary-fg': '#929299',
  'control-hover-fg': '#009058',
  'control-primary-hover-bg': '#009058',
  'control-secondary-hover-fg': '#262633',
  'control-secondary-hover-bg': '#D9D9D9',
  'control-disabled-fg': '#FFFFFF',
  'control-disabled-bg': '#929299',
  'control-primary-disabled': '#A2E1C9',
  'control-border': '1px solid #11B683',

  /* Checkboxes */
  'checkbox-bg': '#FFFFFF',
  'checkbox-disabled-bg': '#D9D9D9',
  'checkbox-border': '#D9D9D9',
  'checkbox-border-hover': '#BFBFBF',

  /* Move Docs */
  'move-docs-selected-fg': 'white',
  'move-docs-selected-bg': '#16B378',
  'move-docs-disabled-bg': '#D9D9D9',

  /* Filter Bar */
  'filter-bar-button-saved-fg': '#FFFFFF',
  'filter-bar-button-saved-bg': '#929299',
  'filter-bar-button-saved-hover-bg': '#D9D9D9',

  /* Icons */
  'icon-disabled': '#929299',
  'icon-error': '#D0021B',

  /* Icon Buttons */
  'icon-button-fg': '#FFFFFF',
  'icon-button-primary-bg': '#16B378',
  'icon-button-primary-hover-bg': '#009058',
  'icon-button-secondary-bg': '#D9D9D9',
  'icon-button-secondary-hover-bg': '#929299',

  /* Left Panel */
  'left-panel-page-hover-bg': 'rgba(217,217,217,0.6)',
  'left-panel-active-page-fg': '#FFFFFF',
  'left-panel-active-page-bg': '#262633',
  'left-panel-disabled-page-fg': '#BDBDBD',
  'left-panel-page-options-fg': '#929299',
  'left-panel-page-options-hover-fg': 'white',
  'left-panel-page-options-hover-bg': '#D9D9D9',
  'left-panel-page-options-selected-hover-bg': '#929299',
  'left-panel-page-initials-fg': 'white',
  'left-panel-page-initials-bg': '#929299',

  /* Right Panel */
  'right-panel-tab-fg': '#262633',
  'right-panel-tab-bg': '#F7F7F7',
  'right-panel-tab-icon': '#929299',
  'right-panel-tab-icon-hover': '#16B378',
  'right-panel-tab-hover-bg': 'rgba(217,217,217,0.6)',
  'right-panel-tab-selected-fg': '#FFFFFF',
  'right-panel-tab-selected-bg': '#16B378',
  'right-panel-tab-button-hover-bg': '#009058',
  'right-panel-subtab-fg': '#16B378',
  'right-panel-subtab-selected-fg': '#262633',
  'right-panel-subtab-selected-underline': '#16B378',
  'right-panel-subtab-hover-fg': '#009058',
  'right-panel-subtab-hover-underline': '#16B378',
  'right-panel-disabled-overlay': '#F7F7F7',
  'right-panel-toggle-button-enabled-fg': '#FFFFFF',
  'right-panel-toggle-button-enabled-bg': '#262633',
  'right-panel-toggle-button-enabled-hover-fg': '#D9D9D9',
  'right-panel-toggle-button-disabled-fg': '#FFFFFF',
  'right-panel-toggle-button-disabled-bg': '#E8E8E8',
  'right-panel-field-settings-bg': '#E8E8E8',
  'right-panel-field-settings-button-bg': 'lightgrey',

  /* Document History */
  'document-history-snapshot-fg': '#262633',
  'document-history-snapshot-selected-fg': '#FFFFFF',
  'document-history-snapshot-bg': 'white',
  'document-history-snapshot-selected-bg': '#262633',
  'document-history-snapshot-border': 'rgba(217,217,217,0.6)',
  'document-history-activity-text': '#000000',
  'document-history-activity-text-light': '#333333',

  /* Accents */
  'accent-icon': '#16B378',
  'accent-border': '#16B378',
  'accent-text': '#16B378',

  /* Inputs */
  'input-fg': 'black',
  'input-bg': 'white',
  'input-disabled-fg': '#929299',
  'input-disabled-bg': '#F7F7F7',
  'input-placeholder-fg': '#929299',
  'input-border': '#D9D9D9',
  'input-valid': '#16B378',
  'input-invalid': '#D0021B',
  'input-focus': '#5E9ED6',
  'input-readonly-bg': '#F7F7F7',
  'input-readonly-border': '#E8E8E8',

  /* Choice Entry */
  'choice-entry-bg': 'white',
  'choice-entry-border': '#D9D9D9',
  'choice-entry-border-hover': '#BFBFBF',

  /* Select Buttons */
  'select-button-fg': '#262633',
  'select-button-placeholder-fg': '#929299',
  'select-button-disabled-fg': 'grey',
  'select-button-bg': 'white',
  'select-button-border': '#D9D9D9',
  'select-button-border-invalid': '#D0021B',

  /* Menus */
  'menu-text': '#929299',
  'menu-light-text': '#929299',
  'menu-bg': 'white',
  'menu-subheader-fg': 'unset',
  'menu-border': '#E8E8E8',
  'menu-shadow': 'rgba(38, 38, 51, 0.6)',

  /* Menu Items */
  'menu-item-fg': 'black',
  'menu-item-selected-fg': '#FFFFFF',
  'menu-item-selected-bg': '#16B378',
  'menu-item-disabled-fg': '#D9D9D9',
  'menu-item-icon-fg': '#929299',
  'menu-item-icon-selected-fg': 'white',
  'menu-item-link-fg': '#16B378',
  'menu-item-link-selected-fg': '#009058',
  'menu-item-link-selected-bg': '#E8E8E8',

  /* Autocomplete */
  'autocomplete-match-text': '#16B378',
  'autocomplete-selected-match-text': '#B1FFE2',
  'autocomplete-item-selected-bg': '#E8E8E8',

  /* Search */
  'search-border': 'grey',
  'search-prev-next-button-fg': '#929299',
  'search-prev-next-button-bg': 'rgba(217,217,217,0.6)',

  /* Loaders */
  'loader-fg': '#16B378',
  'loader-bg': '#D9D9D9',

  /* Site Switcher */
  'site-switcher-active-fg': '#FFFFFF',
  'site-switcher-active-bg': '#262633',

  /* Doc Menu */
  'doc-menu-doc-options-fg': '#D9D9D9',
  'doc-menu-doc-options-hover-fg': '#929299',
  'doc-menu-doc-options-hover-bg': '#D9D9D9',

  /* Shortcut Keys */
  'shortcut-key-fg': 'black',
  'shortcut-key-primary-fg': '#009058',
  'shortcut-key-secondary-fg': '#929299',
  'shortcut-key-bg': 'white',
  'shortcut-key-border': '#929299',

  /* Breadcrumbs */
  'breadcrumbs-tag-fg': 'white',
  'breadcrumbs-tag-bg': '#929299',
  'breadcrumbs-tag-alert-bg': '#D0021B',

  /* Page Widget Picker */
  'widget-picker-primary-bg': 'white',
  'widget-picker-secondary-bg': '#F7F7F7',
  'widget-picker-item-fg': 'unset',
  'widget-picker-item-selected-bg': 'rgba(217,217,217,0.6)',
  'widget-picker-item-disabled-bg': 'rgba(217,217,217,0.6)',
  'widget-picker-icon': '#929299',
  'widget-picker-primary-icon': '#16B378',
  'widget-picker-summary-icon': '#009058',
  'widget-picker-border': 'rgba(217,217,217,0.6)',
  'widget-picker-shadow': 'rgba(38,38,51,0.20)',

  /* Code View */
  'code-view-text': '#444',
  'code-view-keyword': '#444',
  'code-view-comment': '#888888',
  'code-view-meta': '#1F7199',
  'code-view-title': '#880000',
  'code-view-params': '#444',
  'code-view-string': '#880000',
  'code-view-number': '#880000',
  'code-view-builtin': '#397300',
  'code-view-literal': '#78A960',

  /* Importer */
  'importer-table-info-border': '#D9D9D9',
  'importer-preview-border': '#D9D9D9',
  'importer-skipped-table-overlay': 'rgba(217,217,217,0.6)',
  'importer-match-icon': '#D9D9D9',

  /* Menu Toggles */
  'menu-toggle-fg': '#929299',
  'menu-toggle-hover-fg': '#009058',
  'menu-toggle-active-fg': '#007548',
  'menu-toggle-bg': 'white',
  'menu-toggle-border': '#929299',

  /* Info Button */
  'info-button-fg': '#8F8F8F',
  'info-button-hover-fg': '#707070',
  'info-button-active-fg': '#5C5C5C',

  /* Button Groups */
  'button-group-fg': '#262633',
  'button-group-light-fg': '#929299',
  'button-group-bg': 'unset',
  'button-group-icon': '#929299',
  'button-group-border': '#D9D9D9',
  'button-group-border-hover': '#BFBFBF',
  'button-group-selected-fg': '#FFFFFF',
  'button-group-light-selected-fg': '#16B378',
  'button-group-selected-bg': '#262633',
  'button-group-selected-border': '#262633',

  /* Access Rules */
  'access-rules-table-header-fg': '#262633',
  'access-rules-table-header-bg': 'rgba(217,217,217,0.6)',
  'access-rules-table-body-fg': '#929299',
  'access-rules-table-border': '#929299',
  'access-rules-column-list-border': '#D9D9D9',
  'access-rules-column-item-fg': '#262633',
  'access-rules-column-item-bg': '#E8E8E8',
  'access-rules-column-item-icon-fg': '#929299',
  'access-rules-column-item-icon-hover-fg': '#FFFFFF',
  'access-rules-column-item-icon-hover-bg': '#929299',
  'access-rules-formula-editor-bg': 'white',
  'access-rules-formula-editor-border-hover': '#D9D9D9',
  'access-rules-formula-editor-bg-disabled': '#E8E8E8',
  'access-rules-formula-editor-focus': '#16B378',

  /* Cells */
  'cell-fg': 'black',
  'cell-bg': 'white',
  'cell-zebra-bg': '#F8F8F8',

  /* Formula Editor */
  'formula-editor-bg': 'white',

  /* Charts */
  'chart-fg': '#444',
  'chart-bg': '#fff',
  'chart-legend-bg': '#FFFFFF80',
  'chart-x-axis': '#444',
  'chart-y-axis': '#444',

  /* Comments */
  'comments-popup-header-bg': '#F7F7F7',
  'comments-popup-body-bg': 'white',
  'comments-popup-border': '#D9D9D9',
  'comments-user-name-fg': '#494949',
  'comments-panel-topic-bg': 'white',
  'comments-panel-topic-border': '#ccc',
  'comments-panel-resolved-topic-bg': '#F0F0F0',

  /* Date Picker */
  'date-picker-selected-fg': '#262633',
  'date-picker-selected-bg': '#D9D9D9',
  'date-picker-selected-bg-hover': '#CFCFCF',
  'date-picker-today-fg': '#FFFFFF',
  'date-picker-today-bg': '#16B378',
  'date-picker-today-bg-hover': '#009058',
  'date-picker-range-start-end-bg': '#D9D9D9',
  'date-picker-range-start-end-bg-hover': '#CFCFCF',
  'date-picker-range-bg': '#EEEEEE',
  'date-picker-range-bg-hover': '#D9D9D9',

  /* Tutorials */
  'tutorials-popup-border': '#D9D9D9',
  'tutorials-popup-header-fg': '#FFFFFF',
  'tutorials-popup-box-bg': '#F5F5F5',

  /* Ace Autocomplete */
  'ace-autocomplete-primary-fg': '#444',
  'ace-autocomplete-secondary-fg': '#8F8F8F',
  'ace-autocomplete-highlighted-fg': '#000',
  'ace-autocomplete-bg': '#FBFBFB',
  'ace-autocomplete-border': 'lightgray',
  'ace-autocomplete-link': '#16B378',
  'ace-autocomplete-link-highlighted': '#009058',
  'ace-autocomplete-active-line-bg': '#CAD6FA',
  'ace-autocomplete-line-border-hover': '#ABBFFE',
  'ace-autocomplete-line-bg-hover': 'rgba(233,233,253,0.4)',

  /* Color Select */
  'color-select-fg': '#262633',
  'color-select-bg': 'white',
  'color-select-shadow': 'rgba(38,38,51,0.6)',
  'color-select-font-options-border': '#D9D9D9',
  'color-select-font-option-fg': '#262633',
  'color-select-font-option-bg': '#FFFFFF',
  'color-select-font-option-bg-hover': '#F7F7F7',
  'color-select-font-option-fg-selected': '#FFFFFF',
  'color-select-font-option-bg-selected': '#262633',
  'color-select-color-square-border': '#D9D9D9',
  'color-select-color-square-border-empty': '#262633',
  'color-select-input-fg': '#929299',
  'color-select-input-bg': 'white',
  'color-select-input-border': '#D9D9D9',

  /* Highlighted Code */
  'highlighted-code-block-bg': '#FFFFFF',
  'highlighted-code-block-bg-disabled': '#E8E8E8',
  'highlighted-code-fg': '#929299',
  'highlighted-code-border': '#D9D9D9',
  'highlighted-code-bg-disabled': '#E8E8E8',
};
