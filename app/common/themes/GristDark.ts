import {ThemeColors} from 'app/common/ThemePrefs';

export const GristDark: ThemeColors = {
  /* Text */
  'text': '#EFEFEF',
  'text-light': '#A4A4B1',
  'text-medium': '#D5D5D5',
  'text-dark': '#FFFFFF',
  'text-error': '#E63946',
  'text-error-hover': '#FF5C5C',
  'text-danger': '#FFA500',
  'text-disabled': '#A4A4B1',

  /* Page */
  'page-bg': '#262633',
  'page-backdrop': 'black',

  /* Page Panels */
  'page-panels-main-panel-bg': '#32323F',
  'page-panels-left-panel-bg': '#262633',
  'page-panels-right-panel-bg': '#262633',
  'page-panels-top-header-bg': '#32323F',
  'page-panels-bottom-footer-bg': '#32323F',
  'page-panels-border': '#60606D',
  'page-panels-border-resizing': '#17B378',
  'page-panels-side-panel-opener-fg': '#A4A4B1',
  'page-panels-side-panel-opener-active-fg': '#FFFFFF',
  'page-panels-side-panel-opener-active-bg': '#17B378',

  /* Add New */
  'add-new-circle-fg': '#FFFFFF',
  'add-new-circle-bg': '#0A5438',
  'add-new-circle-hover-bg': '#157A54',
  'add-new-circle-small-fg': '#FFFFFF',
  'add-new-circle-small-bg': '#157A54',
  'add-new-circle-small-hover-bg': '#1DA270',

  /* Top Bar */
  'top-bar-button-primary-fg': '#17B378',
  'top-bar-button-secondary-fg': '#A4A4B1',
  'top-bar-button-disabled-fg': '#70707D',
  'top-bar-button-error-fg': 'FF6666',

  /* Notifications */
  'notifications-panel-header-bg': '#262633',
  'notifications-panel-body-bg': '#32323F',
  'notifications-panel-border': '#70707D',

  /* Toasts */
  'toast-text': '#FFFFFF',
  'toast-text-light': '#929299',
  'toast-bg': '#040404',
  'toast-memo-text': '#EFEFEF',
  'toast-memo-bg': '#555563',
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
  'tooltip-icon': '#A4A4B1',
  'tooltip-close-button-fg': 'white',
  'tooltip-close-button-hover-fg': 'black',
  'tooltip-close-button-hover-bg': 'white',

  /* Modals */
  'modal-bg': '#32323F',
  'modal-backdrop': 'rgba(0,0,0,0.6)',
  'modal-border': '#60606D',
  'modal-border-dark': '#70707D',
  'modal-border-hover': '#A4A4B1',
  'modal-shadow-inner': '#000000',
  'modal-shadow-outer': '#000000',
  'modal-close-button-fg': '#A4A4B1',
  'modal-backdrop-close-button-fg': '#17B378',
  'modal-backdrop-close-button-hover-fg': '#13D78D',

  /* Popups */
  'popup-bg': '#32323F',
  'popup-shadow-inner': '#000000',
  'popup-shadow-outer': '#000000',
  'popup-close-button-fg': '#A4A4B1',

  /* Prompts */
  'prompt-fg': '#A4A4B1',

  /* Progress Bars */
  'progress-bar-fg': '#17B378',
  'progress-bar-error-fg': '#FF6666',
  'progress-bar-bg': '#70707D',

  /* Links */
  'link': '#17B378',
  'link-hover': '#17B378',

  /* Hover */
  'hover': 'rgba(111,111,125,0.6)',
  'hover-light': 'rgba(111,111,125,0.4)',

  /* Cell Editor */
  'cell-editor-fg': '#FFFFFF',
  'cell-editor-placeholder-fg': '#A4A4B1',
  'cell-editor-bg': '#32323F',

  /* Cursor */
  'cursor': '#1DA270',
  'cursor-inactive': 'rgba(29,162,112,0.5)',
  'cursor-readonly': '#A4A4B1',

  /* Tables */
  'table-header-fg': '#EFEFEF',
  'table-header-selected-fg': '#EFEFEF',
  'table-header-bg': '#262633',
  'table-header-selected-bg': '#414358',
  'table-header-border': '#70707D',
  'table-body-bg': '#32323F',
  'table-body-border': '#60606D',
  'table-add-new-bg': '#4A4A5D',
  'table-scroll-shadow': '#000000',
  'table-frozen-columns-border': '#A4A4B1',
  'table-drag-drop-indicator': '#A4A4B1',
  'table-drag-drop-shadow': 'rgba(111,111,125,0.6)',
  'table-cell-summary-bg': 'rgba(111,111,125,0.6)',

  /* Cards */
  'card-compact-widget-bg': '#262633',
  'card-compact-record-bg': '#32323F',
  'card-blocks-bg': '#404150',
  'card-form-label': '#A4A4B1',
  'card-compact-label': '#A4A4B1',
  'card-blocks-label': '#A4A4B1',
  'card-form-border': '#70707D',
  'card-compact-border': '#70707D',
  'card-editing-layout-bg': 'rgba(85, 85, 99, 0.2)',
  'card-editing-layout-border': '#70707D',

  /* Card Lists */
  'card-list-form-border': '#60606D',
  'card-list-blocks-border': '#60606D',

  /* Selection */
  'selection': 'rgba(22,179,120,0.15)',
  'selection-darker': 'rgba(22,179,120,0.25)',
  'selection-darkest': 'rgba(22,179,120,0.35)',
  'selection-opaque-fg': 'white',
  'selection-opaque-bg': '#2F4748',
  'selection-opaque-dark-bg': '#253E3E',
  'selection-header': 'rgba(107,107,144,0.4)',

  /* Widgets */
  'widget-bg': '#32323F',
  'widget-border': '#70707D',
  'widget-active-border': '#157A54',
  'widget-inactive-stripes-light': '#262633',
  'widget-inactive-stripes-dark': '#32323F',

  /* Pinned Docs */
  'pinned-doc-footer-bg': '#32323F',
  'pinned-doc-border': '#60606D',
  'pinned-doc-border-hover': '#A4A4B1',
  'pinned-doc-editor-bg': '#60606D',

  /* Raw Data */
  'raw-data-table-border': '#60606D',
  'raw-data-table-border-hover': '#A4A4B1',

  /* Controls */
  'control-fg': '#17B378',
  'control-primary-fg': '#FFFFFF',
  'control-primary-bg': '#157A54',
  'control-secondary-fg': '#A4A4B1',
  'control-secondary-disabled-fg': '#60606D',
  'control-hover-fg': '#13D78D',
  'control-primary-hover-bg': '#1DA270',
  'control-secondary-hover-fg': '#EFEFEF',
  'control-secondary-hover-bg': '#60606D',
  'control-disabled-fg': '#A4A4B1',
  'control-disabled-bg': '#70707D',
  'control-border': '1px solid #17B378',

  /* Checkboxes */
  'checkbox-bg': '#32323F',
  'checkbox-disabled-bg': '#70707D',
  'checkbox-border': '#70707D',
  'checkbox-border-hover': '#A4A4B1',

  /* Move Docs */
  'move-docs-selected-fg': '#FFFFFF',
  'move-docs-selected-bg': '#157A54',
  'move-docs-disabled-bg': '#70707D',

  /* Filter Bar */
  'filter-bar-button-saved-fg': '#FFFFFF',
  'filter-bar-button-saved-bg': '#555563',
  'filter-bar-button-saved-hover-bg': '#70707D',

  /* Icons */
  'icon-disabled': '#A4A4B1',
  'icon-error': '#FFA500',

  /* Icon Buttons */
  'icon-button-fg': '#FFFFFF',
  'icon-button-primary-bg': '#17B378',
  'icon-button-primary-hover-bg': '#13D78D',
  'icon-button-secondary-bg': '#70707D',
  'icon-button-secondary-hover-bg': '#A4A4B1',

  /* Left Panel */
  'left-panel-page-hover-bg': 'rgba(111,111,117,0.25)',
  'left-panel-active-page-fg': '#EFEFEF',
  'left-panel-active-page-bg': '#646473',
  'left-panel-disabled-page-fg': '#70707D',
  'left-panel-page-options-fg': '#A4A4B1',
  'left-panel-page-options-hover-fg': '#FFFFFF',
  'left-panel-page-options-hover-bg': '#70707D',
  'left-panel-page-options-selected-hover-bg': '#A4A4B1',
  'left-panel-page-initials-fg': 'white',
  'left-panel-page-initials-bg': '#8E8EA0',
  'left-panel-page-emoji-fg': 'black',
  'left-panel-page-emoji-outline': '#70707D',

  /* Right Panel */
  'right-panel-tab-fg': '#EFEFEF',
  'right-panel-tab-bg': '#262633',
  'right-panel-tab-icon': '#A4A4B1',
  'right-panel-tab-icon-hover': '#13D78D',
  'right-panel-tab-hover-bg': 'rgba(111,111,117,0.6)',
  'right-panel-tab-selected-fg': '#FFFFFF',
  'right-panel-tab-selected-bg': '#157A54',
  'right-panel-tab-button-hover-bg': '#0A5438',
  'right-panel-subtab-fg': '#17B378',
  'right-panel-subtab-selected-fg': '#EFEFEF',
  'right-panel-subtab-selected-underline': '#1DA270',
  'right-panel-subtab-hover-fg': '#13D78D',
  'right-panel-subtab-hover-underline': '#13D78D',
  'right-panel-disabled-overlay': '#262633',
  'right-panel-toggle-button-enabled-fg': '#FFFFFF',
  'right-panel-toggle-button-enabled-bg': '#646473',
  'right-panel-toggle-button-disabled-fg': '#646473',
  'right-panel-toggle-button-disabled-bg': '#32323F',
  'right-panel-field-settings-bg': '#404150',
  'right-panel-field-settings-button-bg': '#646473',

  /* Document History */
  'document-history-snapshot-fg': '#EFEFEF',
  'document-history-snapshot-selected-fg': '#EFEFEF',
  'document-history-snapshot-bg': '#32323F',
  'document-history-snapshot-selected-bg': '#646473',
  'document-history-snapshot-border': '#70707D',
  'document-history-activity-text': '#EFEFEF',
  'document-history-activity-text-light': '#A4A4B1',
  'document-history-table-header-fg': '#EFEFEF',
  'document-history-table-border': '#70707D',
  'document-history-table-border-light': '#60606D',

  /* Accents */
  'accent-icon': '#17B378',
  'accent-border': '#157A54',
  'accent-text': '#17B378',

  /* Inputs */
  'input-fg': '#EFEFEF',
  'input-bg': '#32323F',
  'input-disabled-fg': '#A4A4B1',
  'input-disabled-bg': '#262633',
  'input-placeholder-fg': '#A4A4B1',
  'input-border': '#70707D',
  'input-valid': '#17B378',
  'input-invalid': '#FF6666',
  'input-focus': '#5E9ED6',
  'input-readonly-bg': '#262633',
  'input-readonly-border': '#70707D',

  /* Choice Tokens */
  'choice-token-fg': '#FFFFFF',
  'choice-token-blank-fg': '#A4A4B1',
  'choice-token-bg': '#70707D',
  'choice-token-selected-bg': '#555563',
  'choice-token-selected-border': '#17B378',
  'choice-token-invalid-fg': '#FFFFFF',
  'choice-token-invalid-bg': '#323240',
  'choice-token-invalid-border': '#D0021B',

  /* Choice Entry */
  'choice-entry-bg': '#32323F',
  'choice-entry-border': '#70707D',
  'choice-entry-border-hover': '#A4A4B1',

  /* Select Buttons */
  'select-button-fg': '#EFEFEF',
  'select-button-placeholder-fg': '#A4A4B1',
  'select-button-bg': '#32323F',
  'select-button-border': '#70707D',
  'select-button-border-invalid': '#FF6666',

  /* Menus */
  'menu-text': '#A4A4B1',
  'menu-light-text': '#A4A4B1',
  'menu-bg': '#32323F',
  'menu-subheader-fg': '#EFEFEF',
  'menu-border': '#70707D',
  'menu-shadow': '#000000',

  /* Menu Items */
  'menu-item-fg': '#FFFFFF',
  'menu-item-selected-fg': '#FFFFFF',
  'menu-item-selected-bg': '#157A54',
  'menu-item-disabled-fg': '#70707D',
  'menu-item-icon-fg': '#A4A4B1',
  'menu-item-icon-selected-fg': '#FFFFFF',

  /* Autocomplete */
  'autocomplete-match-text': '#17B378',
  'autocomplete-selected-match-text': '#13D78D',
  'autocomplete-item-selected-bg': '#70707D',
  'autocomplete-add-new-circle-fg': '#FFFFFF',
  'autocomplete-add-new-circle-bg': '#157A54',
  'autocomplete-add-new-circle-selected-bg': '#1DA270',

  /* Search */
  'search-border': '#70707D',
  'search-prev-next-button-fg': '#A4A4B1',
  'search-prev-next-button-bg': '#24242F',

  /* Loading Spinners */
  'loader-fg': '#17B378',
  'loader-bg': '#70707D',

  /* Site Switcher */
  'site-switcher-active-fg': '#FFFFFF',
  'site-switcher-active-bg': '#000000',

  /* Doc Menu */
  'doc-menu-doc-options-fg': '#70707D',
  'doc-menu-doc-options-hover-fg': '#A4A4B1',
  'doc-menu-doc-options-hover-bg': '#70707D',

  /* Shortcut Keys */
  'shortcut-key-fg': '#FFFFFF',
  'shortcut-key-primary-fg': '#17B378',
  'shortcut-key-secondary-fg': '#A4A4B1',
  'shortcut-key-bg': '#32323F',
  'shortcut-key-border': '#A4A4B1',

  /* Breadcrumbs */
  'breadcrumbs-tag-fg': '#FFFFFF',
  'breadcrumbs-tag-bg': '#70707D',
  'breadcrumbs-tag-alert-bg': '#D0021B',

  /* Page Widget Picker */
  'widget-picker-primary-bg': '#32323F',
  'widget-picker-secondary-bg': '#262633',
  'widget-picker-item-fg': '#FFFFFF',
  'widget-picker-item-selected-bg': 'rgba(111,111,125,0.6)',
  'widget-picker-item-disabled-bg': 'rgba(111,111,125,0.6)',
  'widget-picker-icon': '#A4A4B1',
  'widget-picker-primary-icon': '#17B378',
  'widget-picker-summary-icon': '#17B378',
  'widget-picker-border': 'rgba(111,111,125,0.6)',
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
  'code-view-builtin': '#BFE6D8',
  'code-view-literal': '#9ED682',

  /* Importer */
  'importer-table-info-border': '#70707D',
  'importer-preview-border': '#70707D',
  'importer-skipped-table-overlay': 'rgba(111,111,125,0.6)',
  'importer-match-icon': '#70707D',
  'importer-outside-bg': '#32323F',
  'importer-main-content-bg': '#262633',
  'importer-active-file-bg': '#16B378',
  'importer-active-file-fg': '#FFFFFF',
  'importer-inactive-file-bg': '#808080',
  'importer-inactive-file-fg': '#FFFFFF',

  /* Menu Toggles */
  'menu-toggle-fg': '#A4A4B1',
  'menu-toggle-hover-fg': '#17B378',
  'menu-toggle-active-fg': '#13D78D',
  'menu-toggle-bg': '#32323F',
  'menu-toggle-border': '#A4A4B1',

  /* Info Button */
  'info-button-fg': '#8F8F8F',
  'info-button-hover-fg': '#707070',
  'info-button-active-fg': '#5C5C5C',

  /* Button Groups */
  'button-group-fg': '#EFEFEF',
  'button-group-light-fg': '#A4A4B1',
  'button-group-bg': 'transparent',
  'button-group-bg-hover': 'rgba(111,111,125,0.25)',
  'button-group-icon': '#A4A4B1',
  'button-group-border': '#70707D',
  'button-group-border-hover': '#646473',
  'button-group-selected-fg': '#EFEFEF',
  'button-group-light-selected-fg': '#17B378',
  'button-group-selected-bg': '#646473',
  'button-group-selected-border': '#646473',

  /* Access Rules */
  'access-rules-table-header-fg': '#EFEFEF',
  'access-rules-table-header-bg': '#60606D',
  'access-rules-table-body-fg': '#A4A4B1',
  'access-rules-table-body-light-fg': '#70707D',
  'access-rules-table-border': '#A4A4B1',
  'access-rules-column-list-border': '#70707D',
  'access-rules-column-item-fg': '#EFEFEF',
  'access-rules-column-item-bg': '#60606D',
  'access-rules-column-item-icon-fg': '#A4A4B1',
  'access-rules-column-item-icon-hover-fg': '#EFEFEF',
  'access-rules-column-item-icon-hover-bg': '#A4A4B1',
  'access-rules-formula-editor-bg': '#32323F',
  'access-rules-formula-editor-border-hover': '#70707D',
  'access-rules-formula-editor-bg-disabled': '#60606D',
  'access-rules-formula-editor-focus': '#17B378',

  /* Cells */
  'cell-fg': '#FFFFFF',
  'cell-bg': '#32323F',
  'cell-zebra-bg': '#262633',

  /* Charts */
  'chart-fg': '#A4A4B1',
  'chart-bg': '#32323F',
  'chart-legend-bg': 'rgba(50,50,63,0.5)',
  'chart-x-axis': '#A4A4B1',
  'chart-y-axis': '#A4A4B1',

  /* Comments */
  'comments-popup-header-bg': '#262633',
  'comments-popup-body-bg': '#32323F',
  'comments-popup-border': '#70707D',
  'comments-user-name-fg': '#EFEFEF',
  'comments-panel-topic-bg': '#32323F',
  'comments-panel-topic-border': '#555563',
  'comments-panel-resolved-topic-bg': '#262633',

  /* Date Picker */
  'date-picker-selected-fg': '#FFFFFF',
  'date-picker-selected-bg': '#7A7A8D',
  'date-picker-selected-bg-hover': '#8D8D9C',
  'date-picker-today-fg': '#FFFFFF',
  'date-picker-today-bg': '#157A54',
  'date-picker-today-bg-hover': '#1DA270',
  'date-picker-range-start-end-bg': '#7A7A8D',
  'date-picker-range-start-end-bg-hover': '#8D8D9C',
  'date-picker-range-bg': '#60606D',
  'date-picker-range-bg-hover': '#7A7A8D',

  /* Tutorials */
  'tutorials-popup-border': '#70707D',
  'tutorials-popup-header-fg': '#FFFFFF',
  'tutorials-popup-box-bg': '#60606D',
  'tutorials-popup-code-fg': '#FFFFFF',
  'tutorials-popup-code-bg': '#262633',
  'tutorials-popup-code-border': '#929299',

  /* Ace */
  'ace-editor-bg': '#32323F',
  'ace-autocomplete-primary-fg': '#EFEFEF',
  'ace-autocomplete-secondary-fg': '#A4A4B1',
  'ace-autocomplete-highlighted-fg': '#FFFFFF',
  'ace-autocomplete-bg': '#32323F',
  'ace-autocomplete-border': '#70707D',
  'ace-autocomplete-link': '#28BE86',
  'ace-autocomplete-link-highlighted': '#45D48B',
  'ace-autocomplete-active-line-bg': '#555563',
  'ace-autocomplete-line-border-hover': 'rgba(111,111,125,0.3)',
  'ace-autocomplete-line-bg-hover': 'rgba(111,111,125,0.3)',

  /* Color Select */
  'color-select-fg': '#A4A4B1',
  'color-select-bg': '#32323F',
  'color-select-shadow': '#000000',
  'color-select-font-options-border': '#555563',
  'color-select-font-option-fg': '#EFEFEF',
  'color-select-font-option-bg-hover': 'rgba(111,111,125,0.25)',
  'color-select-font-option-fg-selected': '#EFEFEF',
  'color-select-font-option-bg-selected': '#646473',
  'color-select-color-square-border': '#A4A4B1',
  'color-select-color-square-border-empty': '#EFEFEF',
  'color-select-input-fg': '#A4A4B1',
  'color-select-input-bg': '#32323F',
  'color-select-input-border': '#70707D',

  /* Highlighted Code */
  'highlighted-code-block-bg': '#262633',
  'highlighted-code-block-bg-disabled': '#555563',
  'highlighted-code-fg': '#A4A4B1',
  'highlighted-code-border': '#70707D',
  'highlighted-code-bg-disabled': '#32323F',

  /* Login Page */
  'login-page-bg': '#32323F',
  'login-page-backdrop': '#404150',
  'login-page-line': '#60606D',
  'login-page-google-button-fg': '#FFFFFF',
  'login-page-google-button-bg': '#404150',
  'login-page-google-button-bg-hover': '#555563',
  'login-page-google-button-border': '#70707D',

  /* Formula Assistant */
  'formula-assistant-header-bg': '#262633',
  'formula-assistant-border': '#70707D',
  'formula-assistant-preformatted-text-bg': '#262633',

  /* Attachments */
  'attachments-editor-button-fg': '#17B378',
  'attachments-editor-button-hover-fg': '#13D78D',
  'attachments-editor-button-bg': '#404150',
  'attachments-editor-button-hover-bg': '#555563',
  'attachments-editor-button-border': '#70707D',
  'attachments-editor-button-icon': '#A4A4B1',
  'attachments-editor-border': '#A4A4B1',
  'attachments-cell-icon-fg': '#A4A4B1',
  'attachments-cell-icon-bg': '#555563',
  'attachments-cell-icon-hover-bg': '#70707D',

  /* Switches */
  'switch-slider-fg': '#70707D',
  'switch-circle-fg': '#EFEFEF',

  /* Announcement Popups */
  'announcement-popup-fg': '#FFFFFF',
  'announcement-popup-bg': '#404150',

  /* Scroll Shadow */
  'scroll-shadow': 'rgba(0,0,0,0.25)',

  /* Toggle Checkboxes */
  'toggle-checkbox-fg': '#A4A4B1',

  /* Numeric Spinners */
  'numeric-spinner-fg': '#A4A4B1',
};
