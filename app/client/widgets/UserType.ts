import _ from 'underscore';

/**
 * Given a widget name and a type, return the name of the widget that would
 * actually be used for that type (hopefully the same, unless falling back
 * on a default if widget name is unlisted), and all default configuration
 * information for that widget/type combination.
 * Returns something of form:
 * {
 *   name:"WidgetName",
 *   config: {
 *     cons: "NameOfWidgetClass",
 *     editCons: "NameOfEditorClass",
 *     options: { ... default options for widget ... }
 *   }
 * }
 */
export function getWidgetConfiguration(widgetName: string, type: string) {
  const oneTypeDef = typeDefs[type] || typeDefs.Text;
  if (!(widgetName in oneTypeDef.widgets)) {
    widgetName = oneTypeDef.default;
  }
  return {
    name: widgetName,
    config: oneTypeDef.widgets[widgetName]
  };
}

export function mergeOptions(options: any, type: string) {
  const {name, config} = getWidgetConfiguration(options.widget, type);
  return _.defaults({widget: name}, options, config.options);
}

// Contains the list of types with their storage types, possible widgets, default widgets,
// and defaults for all widget settings
// The names of widgets are used, instead of the actual classes needed, in order to limit
// the spread of dependencies.  See ./UserTypeImpl for actual classes.
export const typeDefs: any = {
  // TODO : translate labels (can not use classic makeT function)
  Any: {
    label: 'Any',
    icon: 'FieldAny',
    widgets: {
      TextBox: {
        cons: 'TextBox',
        editCons: 'TextEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'left',
          wrap: undefined,
        }
      }
    },
    default: 'TextBox'
  },
  Text: {
    label: 'Text',
    icon: 'FieldText',
    widgets: {
      TextBox: {
        cons: 'TextBox',
        editCons: 'TextEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'left',
          wrap: undefined,
        }
      },
      HyperLink: {
        cons: 'HyperLinkTextBox',
        editCons: 'HyperLinkEditor',
        icon: 'FieldLink',
        options: {
          alignment: 'left',
          wrap: undefined,
        }
      }
    },
    default: 'TextBox'
  },
  Numeric: {
    label: 'Numeric',
    icon: 'FieldNumeric',
    widgets: {
      TextBox: {
        cons: 'NumericTextBox',
        editCons: 'NumericEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'right',
          wrap: undefined,
          decimals: undefined,
          maxDecimals: undefined,
          numMode: undefined,
          numSign: undefined,
          currency: undefined,
        }
      },
      Spinner: {
        cons: 'Spinner',
        editCons: 'NumericEditor',
        icon: 'FieldSpinner',
        options: {
          alignment: 'right',
          wrap: undefined,
          decimals: undefined,
          maxDecimals: undefined,
          numMode: undefined,
          numSign: undefined,
          currency: undefined,
        }
      }
    },
    default: 'TextBox'
  },
  Int: {
    label: 'Integer',
    icon: 'FieldInteger',
    widgets: {
      TextBox: {
        cons: 'NumericTextBox',
        editCons: 'TextEditor',
        icon: 'FieldTextbox',
        options: {
          decimals: 0,
          alignment: 'right',
          wrap: undefined,
          maxDecimals: undefined,
          numMode: undefined,
          numSign: undefined,
          currency: undefined,
        }
      },
      Spinner: {
        cons: 'Spinner',
        editCons: 'TextEditor',
        icon: 'FieldSpinner',
        options: {
          decimals: 0,
          alignment: 'right',
          wrap: undefined,
          maxDecimals: undefined,
          numMode: undefined,
          numSign: undefined,
          currency: undefined,
        }
      }
    },
    default: 'TextBox'
  },
  Bool: {
    label: 'Toggle',
    icon: 'FieldToggle',
    widgets: {
      TextBox: {
        cons: 'TextBox',
        editCons: 'TextEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'center',
          wrap: undefined,
        }
      },
      CheckBox: {
        cons: 'CheckBox',
        editCons: 'CheckBoxEditor',
        icon: 'FieldCheckbox',
        options: {}
      },
      Switch: {
        cons: 'Switch',
        editCons: 'CheckBoxEditor',
        icon: 'FieldSwitcher',
        options: {}
      }
    },
    default: 'CheckBox'
  },
  Date: {
    label: 'Date',
    icon: 'FieldDate',
    widgets: {
      TextBox: {
        cons: 'DateTextBox',
        editCons: 'DateEditor',
        icon: 'FieldTextbox',
        options: {
          dateFormat: 'YYYY-MM-DD',
          isCustomDateFormat: false,
          alignment: 'left'
        }
      }
    },
    default: 'TextBox'
  },
  DateTime: {
    label: 'DateTime',
    icon: 'FieldDateTime',
    widgets: {
      TextBox: {
        cons: 'DateTimeTextBox',
        editCons: 'DateTimeEditor',
        icon: 'FieldTextbox',
        options: {
          dateFormat: 'YYYY-MM-DD',   // Default to ISO standard: https://xkcd.com/1179/
          timeFormat: 'h:mma',
          isCustomDateFormat: false,
          isCustomTimeFormat: false,
          alignment: 'left'
        }
      }
    },
    default: 'TextBox'
  },
  Choice: {
    label: 'Choice',
    icon: 'FieldChoice',
    widgets: {
      TextBox: {
        cons: 'ChoiceTextBox',
        editCons: 'ChoiceEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'left',
          wrap: undefined,
          choices: undefined,
          choiceOptions: undefined
        }
      }
    },
    default: 'TextBox'
  },
  ChoiceList: {
    label: 'Choice List',
    icon: 'FieldChoice',
    widgets: {
      TextBox: {
        cons: 'ChoiceListCell',
        editCons: 'ChoiceListEditor',
        icon: 'FieldTextbox',
        options: {
          alignment: 'left',
          wrap: undefined,
          choices: undefined,
          choiceOptions: undefined
        }
      }
    },
    default: 'TextBox'
  },
  Ref: {
    label: 'Reference',
    icon: 'FieldReference',
    widgets: {
      Reference: {
        cons: 'Reference',
        editCons: 'ReferenceEditor',
        icon: 'FieldReference',
        options: {
          alignment: 'left',
          wrap: undefined,
        }
      }
    },
    default: 'Reference'
  },
  RefList: {
    label: 'Reference List',
    icon: 'FieldReference',
    widgets: {
      Reference: {
        cons: 'ReferenceList',
        editCons: 'ReferenceListEditor',
        icon: 'FieldReference',
        options: {
          alignment: 'left',
          wrap: undefined
        }
      }
    },
    default: 'Reference'
  },
  Attachments: {
    label: 'Attachment',
    icon: 'FieldAttachment',
    widgets: {
      Attachments: {
        cons: 'AttachmentsWidget',
        editCons: 'AttachmentsEditor',
        icon: 'FieldAttachment',
        options: {
          height: '36'
        }
      }
    },
    default: 'Attachments'
  }
};
