export interface IExampleInfo {
  id: number;
  urlId: string;
  title: KeyAndContext;
  imgUrl: string;
  tutorialUrl: string;
  welcomeCard: WelcomeCard;
}

interface WelcomeCard {
  title: KeyAndContext;
  text: KeyAndContext;
  tutorialName: KeyAndContext;
}

type KeyAndContext = [string, Record<string, string>];

export const examples: IExampleInfo[] = [{
  id: 1,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'lightweight-crm',
  title: ['Title', {context: "CRM"}],
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/lightweight-crm.png',
  tutorialUrl: 'https://support.getgrist.com/lightweight-crm/',
  welcomeCard: {
    title: ['WelcomeTitle', {context: "CRM"}],
    text: ['WelcomeText', {context: "CRM"}],
    tutorialName: ['WelcomeTutorialName', {context: "CRM"}],
  },
}, {
  id: 2,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'investment-research',
  title: ['Title', {context: "investmentResearch"}],
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/data-visualization.png',
  tutorialUrl: 'https://support.getgrist.com/investment-research/',
  welcomeCard: {
    title: ['WelcomeTitle', {context: "investmentResearch"}],
    text: ['WelcomeText', {context: "investmentResearch"}],
    tutorialName: ['WelcomeTutorialName', {context: "investmentResearch"}],
  },
}, {
  id: 3,    // Identifies the example in UserPrefs.seenExamples
  urlId: 'afterschool-program',
  title: ['Title', {context: "afterschool"}],
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/business-management.png',
  tutorialUrl: 'https://support.getgrist.com/afterschool-program/',
  welcomeCard: {
    title: ['WelcomeTitle', {context: "afterschool"}],
    text: ['WelcomeText', {context: "afterschool"}],
    tutorialName: ['WelcomeTutorialName', {context: "afterschool"}],
  },
}];
