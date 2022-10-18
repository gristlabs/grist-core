import {t} from 'app/client/lib/localization'
export interface IExampleInfo {
  id: number;
  urlId: string;
  title: string;
  imgUrl: string;
  tutorialUrl: string;
  welcomeCard: WelcomeCard;
}

const translate = (x: string, args?: any): string => t(`ExampleInfo.${x}`, args);

interface WelcomeCard {
  title: string;
  text: string;
  tutorialName: string;
}

export const examples: IExampleInfo[] = [{
  id: 1,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'lightweight-crm',
  title: translate('Title', {context: "CRM"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/lightweight-crm.png',
  tutorialUrl: 'https://support.getgrist.com/lightweight-crm/',
  welcomeCard: {
    title: translate('WelcomeTitle', {context: "CRM"}),
    text: translate('WelcomeText', {context: "CRM"}),
    tutorialName: translate('WelcomeTutorialName', {context: "CRM"}),
  },
}, {
  id: 2,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'investment-research',
  title: translate('Title', {context: "investmentResearch"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/data-visualization.png',
  tutorialUrl: 'https://support.getgrist.com/investment-research/',
  welcomeCard: {
    title: translate('WelcomeTitle', {context: "investmentResearch"}),
    text: translate('WelcomeText', {context: "investmentResearch"}),
    tutorialName: translate('WelcomeTutorialName', {context: "investmentResearch"}),
  },
}, {
  id: 3,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'afterschool-program',
  title: translate('Title', {context: "afterschool"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/business-management.png',
  tutorialUrl: 'https://support.getgrist.com/afterschool-program/',
  welcomeCard: {
    title: translate('WelcomeTitle', {context: "afterschool"}),
    text: translate('WelcomeText', {context: "afterschool"}),
    tutorialName: translate('WelcomeTutorialName', {context: "afterschool"}),
  },
}];
