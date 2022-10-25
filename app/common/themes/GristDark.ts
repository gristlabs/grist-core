import {ThemeColors} from 'app/common/ThemePrefs';

export const GristDark: ThemeColors = {
  /* Text */
  'text': '#EFEFEF',
  'text-light': '#A4A4A4',
  'text-dark': '#FFFFFF',
  'text-error': '#FF6666',
  'text-danger': '#FFA500',
  'text-disabled': '#A4A4A4',

  /* Page */
  'page-bg': '#262633',
  'page-backdrop': 'black',

  /* Page Panels */
  'page-panels-main-panel-bg': '#32323F',
  'page-panels-left-panel-bg': '#262633',
  'page-panels-right-panel-bg': '#262633',
  'page-panels-top-header-bg': '#32323F',
  'page-panels-bottom-footer-bg': '#32323F',
  'page-panels-border': '#57575F',
  'page-panels-border-resizing': '#1DA270',
  'page-panels-side-panel-opener-fg': '#A4A4A4',
  'page-panels-side-panel-opener-active-fg': '#FFFFFF',
  'page-panels-side-panel-opener-active-bg': '#1DA270',

  /* Add New */
  'add-new-circle-fg': '#FFFFFF',
  'add-new-circle-bg': '#157A54',
  'add-new-circle-hover-bg': '#0A5438',
  'add-new-circle-small-fg': '#FFFFFF',
  'add-new-circle-small-bg': '#1DA270',
  'add-new-circle-small-hover-bg': '#157A54',

  /* Top Bar */
  'top-bar-button-primary-fg': '#1DA270',
  'top-bar-button-secondary-fg': '#A4A4A4',
  'top-bar-button-disabled-fg': '#69697D',
  'top-bar-button-error-fg': 'FF6666',

  /* Notifications */
  'notifications-panel-header-bg': '#262633',
  'notifications-panel-body-bg': '#32323F',
  'notifications-panel-border': '#69697D',

  /* Toasts */
  'toast-text': '#FFFFFF',
  'toast-text-light': '#929299',
  'toast-bg': '#040404',
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
  'tooltip-icon': '#A4A4A4',
  'tooltip-close-button-fg': 'white',
  'tooltip-close-button-hover-fg': 'black',
  'tooltip-close-button-hover-bg': 'white',

  /* Modals */
  'modal-bg': '#32323F',
  'modal-backdrop': 'rgba(0,0,0,0.6)',
  'modal-border': '#57575F',
  'modal-border-dark': '#69697D',
  'modal-border-hover': '#A4A4A4',
  'modal-shadow-inner': '#000000',
  'modal-shadow-outer': '#000000',
  'modal-close-button-fg': '#A4A4A4',
  'modal-backdrop-close-button-fg': '#1DA270',
  'modal-backdrop-close-button-hover-fg': '#157A54',

  /* Popups */
  'popup-bg': '#32323F',
  'popup-shadow-inner': '#000000',
  'popup-shadow-outer': '#000000',
  'popup-close-button-fg': '#A4A4A4',

  /* Progress Bars */
  'progress-bar-fg': '#1DA270',
  'progress-bar-error-fg': '#FF6666',
  'progress-bar-bg': '#69697D',

  /* Links */
  'link': '#1DA270',
  'link-hover': '#1DA270',

  /* Hover */
  'hover': 'rgba(111,111,117,0.6)',
  'hover-light': 'rgba(111,111,117,0.4)',

  /* Cell Editor */
  'cell-editor-fg': '#FFFFFF',
  'cell-editor-bg': '#32323F',

  /* Cursor */
  'cursor': '#1DA270',
  'cursor-inactive': 'rgba(29,162,112,0.5)',
  'cursor-readonly': '#A4A4A4',

  /* Tables */
  'table-header-fg': '#EFEFEF',
  'table-header-selected-fg': '#EFEFEF',
  'table-header-bg': '#262633',
  'table-header-selected-bg': '#414358',
  'table-header-border': '#57575F',
  'table-header-border-dark': '#69697D',
  'table-body-bg': '#32323F',
  'table-body-border': '#69697D',
  'table-add-new-bg': '#4A4A5D',
  'table-scroll-shadow': '#000000',
  'table-frozen-columns-border': '#A4A4A4',
  'table-drag-drop-indicator': '#A4A4A4',
  'table-drag-drop-shadow': 'rgba(111,111,117,0.6)',

  /* Cards */
  'card-compact-widget-bg': '#262633',
  'card-compact-record-bg': '#32323F',
  'card-blocks-bg': '#404150',
  'card-form-label': '#A4A4A4',
  'card-compact-label': '#A4A4A4',
  'card-blocks-label': '#A4A4A4',
  'card-form-border': '#69697D',
  'card-compact-border': '#69697D',
  'card-editing-layout-bg': 'rgba(85, 85, 99, 0.2)',
  'card-editing-layout-border': '#69697D',

  /* Card Lists */
  'card-list-form-border': '#57575F',
  'card-list-blocks-border': '#57575F',

  /* Selection */
  'selection': 'rgba(22,179,120,0.15)',
  'selection-opaque-fg': 'white',
  'selection-opaque-bg': '#2F4748',
  'selection-opaque-dark-bg': '#253E3E',

  /* Widgets */
  'widget-bg': '#32323F',
  'widget-border': '#57575F',
  'widget-active-border': '#1DA270',
  'widget-inactive-stripes-light': '#262633',
  'widget-inactive-stripes-dark': '#32323F',

  /* Pinned Docs */
  'pinned-doc-footer-bg': '#32323F',
  'pinned-doc-border': '#57575F',
  'pinned-doc-border-hover': '#A4A4A4',
  'pinned-doc-editor-bg': '#57575F',

  /* Raw Data */
  'raw-data-table-border': '#57575F',
  'raw-data-table-border-hover': '#A4A4A4',

  /* Controls */
  'control-fg': '#1DA270',
  'control-primary-fg': '#FFFFFF',
  'control-primary-bg': '#1DA270',
  'control-secondary-fg': '#A4A4A4',
  'control-hover-fg': '#157A54',
  'control-primary-hover-bg': '#157A54',
  'control-secondary-hover-fg': '#EFEFEF',
  'control-secondary-hover-bg': '#57575F',
  'control-disabled-fg': '#A4A4A4',
  'control-disabled-bg': '#69697D',
  'control-primary-disabled': '#5F8C7B',
  'control-border': '#11B683',

  /* Checkboxes */
  'checkbox-bg': '#32323F',
  'checkbox-disabled-bg': '#69697D',
  'checkbox-border': '#69697D',
  'checkbox-border-hover': '#57575F',

  /* Move Docs */
  'move-docs-selected-fg': '#FFFFFF',
  'move-docs-selected-bg': '#1DA270',
  'move-docs-disabled-bg': '#69697D',

  /* Filter Bar */
  'filter-bar-button-saved-fg': '#FFFFFF',
  'filter-bar-button-saved-bg': '#555563',
  'filter-bar-button-saved-hover-bg': '#69697D',

  /* Icon Buttons */
  'icon-button-fg': '#FFFFFF',
  'icon-button-primary-bg': '#1DA270',
  'icon-button-primary-hover-bg': '#157A54',
  'icon-button-secondary-bg': '#69697D',
  'icon-button-secondary-hover-bg': '#A4A4A4',

  /* Left Panel */
  'left-panel-page-hover-bg': 'rgba(111,111,117,0.25)',
  'left-panel-active-page-fg': '#EFEFEF',
  'left-panel-active-page-bg': '#555563',
  'left-panel-disabled-page-fg': '#69697D',
  'left-panel-page-options-fg': '#A4A4A4',
  'left-panel-page-options-hover-fg': '#FFFFFF',
  'left-panel-page-options-hover-bg': '#69697D',
  'left-panel-page-options-selected-hover-bg': '#A4A4A4',
  'left-panel-page-initials-fg': 'white',
  'left-panel-page-initials-bg': '#929299',

  /* Right Panel */
  'right-panel-tab-fg': '#EFEFEF',
  'right-panel-tab-bg': '#262633',
  'right-panel-tab-icon': '#A4A4A4',
  'right-panel-tab-icon-hover': '#1DA270',
  'right-panel-tab-hover-bg': 'rgba(111,111,117,0.6)',
  'right-panel-tab-selected-fg': '#FFFFFF',
  'right-panel-tab-selected-bg': '#1DA270',
  'right-panel-tab-button-hover-bg': '#157A54',
  'right-panel-subtab-fg': '#1DA270',
  'right-panel-subtab-selected-fg': '#EFEFEF',
  'right-panel-subtab-selected-underline': '#1DA270',
  'right-panel-subtab-hover-fg': '#157A54',
  'right-panel-subtab-hover-underline': '#1DA270',
  'right-panel-disabled-overlay': '#262633',
  'right-panel-toggle-button-enabled-fg': '#FFFFFF',
  'right-panel-toggle-button-enabled-bg': '#555563',
  'right-panel-toggle-button-enabled-hover-fg': '#D9D9D9',
  'right-panel-toggle-button-disabled-fg': '#FFFFFF',
  'right-panel-toggle-button-disabled-bg': '#333333',
  'right-panel-field-settings-bg': '#414358',
  'right-panel-field-settings-button-bg': '#57575F',

  /* Document History */
  'document-history-snapshot-fg': '#EFEFEF',
  'document-history-snapshot-selected-fg': '#EFEFEF',
  'document-history-snapshot-bg': '#32323F',
  'document-history-snapshot-selected-bg': '#555563',
  'document-history-snapshot-border': '#69697D',
  'document-history-activity-text': '#EFEFEF',
  'document-history-activity-text-light': '#A4A4A4',

  /* Accents */
  'accent-icon': '#1DA270',
  'accent-border': '#1DA270',
  'accent-text': '#1DA270',

  /* Inputs */
  'input-fg': '#EFEFEF',
  'input-bg': '#32323F',
  'input-disabled-fg': '#A4A4A4',
  'input-disabled-bg': '#262633',
  'input-placeholder-fg': '#A4A4A4',
  'input-border': '#69697D',
  'input-valid': '#1DA270',
  'input-invalid': '#FF6666',
  'input-focus': '#5E9ED6',
  'input-readonly-bg': '#262633',
  'input-readonly-border': '#69697D',

  /* Choice Entry */
  'choice-entry-bg': '#32323F',
  'choice-entry-border': '#69697D',
  'choice-entry-border-hover': '#A4A4A4',

  /* Select Buttons */
  'select-button-fg': '#EFEFEF',
  'select-button-placeholder-fg': '#A4A4A4',
  'select-button-disabled-fg': '#A4A4A4',
  'select-button-bg': '#32323F',
  'select-button-border': '#69697D',
  'select-button-border-invalid': '#FF6666',

  /* Menus */
  'menu-text': '#A4A4A4',
  'menu-light-text': '#A4A4A4',
  'menu-bg': '#32323F',
  'menu-subheader-fg': '#EFEFEF',
  'menu-border': '#69697D',
  'menu-shadow': '#000000',

  /* Menu Items */
  'menu-item-fg': '#FFFFFF',
  'menu-item-selected-fg': '#FFFFFF',
  'menu-item-selected-bg': '#1DA270',
  'menu-item-disabled-fg': '#69697D',
  'menu-item-icon-fg': '#A4A4A4',
  'menu-item-icon-selected-fg': '#FFFFFF',
  'menu-item-link-fg': '#1DA270',
  'menu-item-link-selected-fg': '#157A54',
  'menu-item-link-selected-bg': '#484859',

  /* Autocomplete */
  'autocomplete-match-text': '#1DA270',
  'autocomplete-selected-match-text': '#0A5438',
  'autocomplete-item-selected-bg': '#69697D',

  /* Search */
  'search-border': '#69697D',
  'search-prev-next-button-fg': '#A4A4A4',
  'search-prev-next-button-bg': '#24242F',

  /* Loading Spinners */
  'loader-fg': '#1DA270',
  'loader-bg': '#69697D',

  /* Site Switcher */
  'site-switcher-active-fg': '#FFFFFF',
  'site-switcher-active-bg': '#000000',

  /* Doc Menu */
  'doc-menu-doc-options-fg': '#69697D',
  'doc-menu-doc-options-hover-fg': '#A4A4A4',
  'doc-menu-doc-options-hover-bg': '#69697D',

  /* Shortcut Keys */
  'shortcut-key-fg': '#FFFFFF',
  'shortcut-key-primary-fg': '#17B378',
  'shortcut-key-secondary-fg': '#A4A4A4',
  'shortcut-key-bg': '#32323F',
  'shortcut-key-border': '#A4A4A4',

  /* Breadcrumbs */
  'breadcrumbs-tag-fg': 'white',
  'breadcrumbs-tag-bg': '#929299',
  'breadcrumbs-tag-alert-bg': '#D0021B',

  /* Page Widget Picker */
  'widget-picker-primary-bg': '#32323F',
  'widget-picker-secondary-bg': '#262633',
  'widget-picker-item-fg': '#FFFFFF',
  'widget-picker-item-selected-bg': 'rgba(111,111,117,0.6)',
  'widget-picker-item-disabled-bg': 'rgba(111,111,117,0.6)',
  'widget-picker-icon': '#A4A4A4',
  'widget-picker-primary-icon': '#1DA270',
  'widget-picker-summary-icon': '#1DA270',
  'widget-picker-border': 'rgba(111,111,117,0.6)',
  'widget-picker-shadow': '#000000',

  /* Code View */
  'code-view-text': '#D2D2D2',
  'code-view-keyword': '#D2D2D2',
  'code-view-comment': '#888888',
  'code-view-meta': '#7CD4FF',
  'code-view-title': '#ED7373',
  'code-view-params': '#D2D2D2',
  'code-view-string': '#ED7373',
  'code-view-number': '#ED7373',

  /* Importer */
  'importer-table-info-border': '#69697D',
  'importer-preview-border': '#69697D',
  'importer-skipped-table-overlay': 'rgba(111,111,117,0.6)',
  'importer-match-icon': '#69697D',

  /* Menu Toggles */
  'menu-toggle-fg': '#A4A4A4',
  'menu-toggle-hover-fg': '#1DA270',
  'menu-toggle-active-fg': '#157A54',
  'menu-toggle-bg': '#32323F',
  'menu-toggle-border': '#A4A4A4',

  /* Button Groups */
  'button-group-fg': '#EFEFEF',
  'button-group-light-fg': '#A4A4A4',
  'button-group-bg': 'unset',
  'button-group-icon': '#A4A4A4',
  'button-group-border': '#69697D',
  'button-group-border-hover': '#555563',
  'button-group-selected-fg': '#EFEFEF',
  'button-group-light-selected-fg': '#1DA270',
  'button-group-selected-bg': '#555563',
  'button-group-selected-border': '#555563',

  /* Access Rules */
  'access-rules-table-header-fg': '#EFEFEF',
  'access-rules-table-header-bg': '#57575F',
  'access-rules-table-body-fg': '#A4A4A4',
  'access-rules-table-border': '#A4A4A4',
  'access-rules-column-list-border': '#69697D',
  'access-rules-column-item-fg': '#EFEFEF',
  'access-rules-column-item-bg': '#57575F',
  'access-rules-column-item-icon-fg': '#A4A4A4',
  'access-rules-column-item-icon-hover-fg': '#EFEFEF',
  'access-rules-column-item-icon-hover-bg': '#A4A4A4',

  /* Cells */
  'cell-fg': '#FFFFFF',
  'cell-bg': '#32323F',
  'cell-zebra-bg': '#262633',

  /* Formula Editor */
  'formula-editor-bg': '#282A36',

  /* Charts */
  'chart-fg': '#A4A4A4',
  'chart-bg': '#32323F',
  'chart-legend-bg': '#32323F80',
  'chart-x-axis': '#A4A4A4',
  'chart-y-axis': '#A4A4A4',

  /* Comments */
  'comments-popup-header-bg': '#262633',
  'comments-popup-body-bg': '#32323F',
  'comments-popup-border': '#69697D',
  'comments-user-name-fg': '#DFDFDF',
  'comments-panel-topic-bg': '#32323F',
  'comments-panel-topic-border': '#555563',
  'comments-panel-resolved-topic-bg': '#262634',
};
