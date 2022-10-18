import {t} from 'app/client/lib/localization';
import * as commands from 'app/client/components/commands';
import {getUserPrefObs} from 'app/client/models/UserPrefs';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IconName} from 'app/client/ui2018/IconList';
import {ISaveModalOptions, saveModal} from 'app/client/ui2018/modals';
import {BaseAPI} from 'app/common/BaseAPI';
import {UserPrefs} from 'app/common/Prefs';
import {getGristConfig} from 'app/common/urlUtils';
import {dom, input, Observable, styled, subscribeElem} from 'grainjs';

const translate = (x: string, args?: any): string => t(`WelcomeQuestions.${x}`, args);

export function showWelcomeQuestions(userPrefsObs: Observable<UserPrefs>) {
  if (!(getGristConfig().survey && userPrefsObs.get()?.showNewUserQuestions)) {
    return null;
  }

  return saveModal((ctl, owner): ISaveModalOptions => {
    const selection = choices.map(c => Observable.create(owner, false));
    const otherText = Observable.create(owner, '');
    const showQuestions = getUserPrefObs(userPrefsObs, 'showNewUserQuestions');

    async function onConfirm() {
      const selected = choices.filter((c, i) => selection[i].get()).map(c => c.text);
      const use_cases = ['L', ...selected];   // Format to populate a ChoiceList column
      const use_other = selected.includes('Other') ? otherText.get() : '';

      const submitUrl = new URL(window.location.href);
      submitUrl.pathname = '/welcome/info';
      return BaseAPI.request(submitUrl.href,
        {method: 'POST', body: JSON.stringify({use_cases, use_other})});
    }


    owner.onDispose(async () => {
      // Whichever way the modal is closed, don't show the questions again. (We set the value to
      // undefined to remove it from the JSON prefs object entirely; it's never used again.)
      showQuestions.set(undefined);

      // Show the Grist video tour when the modal is closed.
      await commands.allCommands.leftPanelOpen.run();
      commands.allCommands.videoTourToolsOpen.run();
    });

    return {
      title: [cssLogo(), dom('div', translate('WelcomeToGrist'))],
      body: buildInfoForm(selection, otherText),
      saveLabel: 'Start using Grist',
      saveFunc: onConfirm,
      hideCancel: true,
      width: 'fixed-wide',
      modalArgs: cssModalCentered.cls(''),
    };
  });
}

const choices: Array<{icon: IconName, color: string, text: string}> = [
  {icon: 'UseProduct', color: `${colors.lightGreen}`, text: translate('ProductDevelopment') },
  {icon: 'UseFinance', color: '#0075A2',       text: translate('FinanceAccounting')},
  {icon: 'UseMedia',   color: '#F7B32B',       text: translate('MediaProduction')    },
  {icon: 'UseMonitor', color: '#F2545B',       text: translate('ITTechnology')     },
  {icon: 'UseChart',   color: '#7141F9',       text: translate('Marketing')           },
  {icon: 'UseScience', color: '#231942',       text: translate('Research')            },
  {icon: 'UseSales',   color: '#885A5A',       text: translate('Sales')               },
  {icon: 'UseEducate', color: '#4A5899',       text: translate('Education')           },
  {icon: 'UseHr',      color: '#688047',       text: translate('HR & Management')     },
  {icon: 'UseOther',   color: '#929299',       text: translate('Other')               },
];

function buildInfoForm(selection: Observable<boolean>[], otherText: Observable<string>) {
  return [
    dom('span', translate('WhatBringsYouToGrist')),
    cssChoices(
      choices.map((item, i) => cssChoice(
        cssIcon(icon(item.icon), {style: `--icon-color: ${item.color}`}),
        cssChoice.cls('-selected', selection[i]),
        dom.on('click', () => selection[i].set(!selection[i].get())),
        (item.icon !== 'UseOther' ?
          item.text :
          [
            cssOtherLabel(item.text),
            cssOtherInput(otherText, {}, {type: 'text', placeholder: translate('TypeHere')},
              // The following subscribes to changes to selection observable, and focuses the input when
              // this item is selected.
              (elem) => subscribeElem(elem, selection[i], val => val && setTimeout(() => elem.focus(), 0)),
              // It's annoying if clicking into the input toggles selection; better to turn that
              // off (user can click icon to deselect).
              dom.on('click', ev => ev.stopPropagation()),
              // Similarly, ignore Enter/Escape in "Other" textbox, so that they don't submit/close the form.
              dom.onKeyDown({
                Enter: (ev, elem) => elem.blur(),
                Escape: (ev, elem) => elem.blur(),
              }),
            )
          ]
        )
      )),
      testId('welcome-questions'),
    ),
  ];
}

const cssModalCentered = styled('div', `
  text-align: center;
`);

const cssLogo = styled('div', `
  display: inline-block;
  height: 48px;
  width: 48px;
  background-image: var(--icon-GristLogo);
  background-size: 32px 32px;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssChoices = styled('div', `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 24px;
`);

const cssChoice = styled('div', `
  flex: 1 0 40%;
  min-width: 0px;
  margin: 8px 4px 0 4px;
  height: 40px;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  display: flex;
  align-items: center;
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: ${colors.lightGreen};
  }
  &-selected {
    background-color: ${colors.mediumGrey};
  }
  &-selected:hover {
    border-color: ${colors.darkGreen};
  }
  &-selected:focus-within {
    box-shadow: 0 0 2px 0px var(--grist-color-cursor);
    border-color: ${colors.lightGreen};
  }
`);

const cssIcon = styled('div', `
  margin: 0 16px;
`);

const cssOtherLabel = styled('div', `
  display: block;
  .${cssChoice.className}-selected & {
    display: none;
  }
`);

const cssOtherInput = styled(input, `
  display: none;
  border: none;
  background: none;
  outline: none;
  padding: 0px;
  .${cssChoice.className}-selected & {
    display: block;
  }
`);
