import {makeT} from 'app/client/lib/localization'

const t = makeT('ExampleInfo');

export interface IExampleInfo {
  id: number;
  urlId: string;
  title: string;
  imgUrl: string;
  tutorialUrl: string;
  welcomeCard: WelcomeCard;
}

interface WelcomeCard {
  title: string;
  text: string;
  tutorialName: string;
}

export const buildExamples = (): IExampleInfo[] => [{
  id: 1,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'lightweight-crm',
  title: t('Title', {context: "CRM"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/lightweight-crm.png',
  tutorialUrl: 'https://support.getgrist.com/lightweight-crm/',
  welcomeCard: {
    title: t('WelcomeTitle', {context: "CRM"}),
    text: t('WelcomeText', {context: "CRM"}),
    tutorialName: t('WelcomeTutorialName', {context: "CRM"}),
  },
}, {
  id: 2,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'investment-research',
  title: t('Title', {context: "investmentResearch"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/data-visualization.png',
  tutorialUrl: 'https://support.getgrist.com/investment-research/',
  welcomeCard: {
    title: t('WelcomeTitle', {context: "investmentResearch"}),
    text: t('WelcomeText', {context: "investmentResearch"}),
    tutorialName: t('WelcomeTutorialName', {context: "investmentResearch"}),
  },
}, {
  id: 3,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'afterschool-program',
  title: t('Title', {context: "afterschool"}),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/business-management.png',
  tutorialUrl: 'https://support.getgrist.com/afterschool-program/',
  welcomeCard: {
    title: t('WelcomeTitle', {context: "afterschool"}),
    text: t('WelcomeText', {context: "afterschool"}),
    tutorialName: t('WelcomeTutorialName', {context: "afterschool"}),
  },
}];
