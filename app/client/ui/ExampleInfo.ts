import {makeT} from 'app/client/lib/localization';

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
  title: t('Lightweight CRM'),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/lightweight-crm.png',
  tutorialUrl: 'https://support.getgrist.com/lightweight-crm/',
  welcomeCard: {
    title: t('Welcome to the Lightweight CRM template'),
    text: t('Check out our related tutorial for how to link data, and create high-productivity layouts.'),
    tutorialName: t("Tutorial: Create a CRM"),
  },
}, {
  id: 2,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'investment-research',
  title: t('Investment Research'),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/data-visualization.png',
  tutorialUrl: 'https://support.getgrist.com/investment-research/',
  welcomeCard: {
    title: t("Welcome to the Investment Research template"),
    text: t("Check out our related tutorial to learn how to create \
summary tables and charts, and to link charts dynamically."),
    tutorialName: t("Tutorial: Analyze & Visualize"),
  },
}, {
  id: 3,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'afterschool-program',
  title: t('Afterschool Program'),
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/business-management.png',
  tutorialUrl: 'https://support.getgrist.com/afterschool-program/',
  welcomeCard: {
    title: t("Welcome to the Afterschool Program template"),
    text: t("Check out our related tutorial for how to model business data, use formulas, and manage complexity."),
    tutorialName: t("Tutorial: Manage Business Data"),
  },
}];
