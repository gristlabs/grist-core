import {DomContents} from 'grainjs';

export interface IExampleInfo {
  id: number;
  matcher: RegExp;
  title: string;
  imgUrl: string;
  tutorialUrl: string;
  bgColor: string;
  desc: () => DomContents;
  welcomeCard: WelcomeCard;
}

interface WelcomeCard {
  title: string;
  text: string;
  tutorialName: string;
}

export const examples: IExampleInfo[] = [{
  id: 1,    // Identifies the example in UserPrefs.seenExamples
  matcher: /Lightweight CRM/,
  title: 'Lightweight CRM',
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/lightweight-crm.png',
  tutorialUrl: 'https://support.getgrist.com/lightweight-crm/',
  bgColor: '#FDEDD7',
  desc: () => 'CRM template and example for linking data, and creating productive layouts.',
  welcomeCard: {
    title: 'Welcome to the Lightweight CRM template',
    text: 'Check out our related tutorial for how to link data, and create ' +
          'high-productivity layouts.',
    tutorialName: 'Tutorial: Create a CRM',
  },
}, {
  id: 2,    // Identifies the example in UserPrefs.seenExamples
  matcher: /Investment Research/,
  title: 'Investment Research',
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/data-visualization.png',
  tutorialUrl: 'https://support.getgrist.com/investment-research/',
  bgColor: '#CEF2E4',
  desc: () => 'Example for analyzing and visualizing with summary tables and linked charts.',
  welcomeCard: {
    title: 'Welcome to the Investment Research template',
    text: 'Check out our related tutorial to learn how to create summary tables and charts, ' +
          'and to link charts dynamically.',
    tutorialName: 'Tutorial: Analyze & Visualize',
  },
}, {
  id: 3,    // Identifies the example in UserPrefs.seenExamples
  matcher: /Afterschool Program/,
  title: 'Afterschool Program',
  imgUrl: 'https://www.getgrist.com/themes/grist/assets/images/use-cases/business-management.png',
  tutorialUrl: 'https://support.getgrist.com/afterschool-program/',
  bgColor: '#D7E3F5',
  desc: () => 'Example for how to model business data, use formulas, and manage complexity.',
  welcomeCard: {
    title: 'Welcome to the Afterschool Program template',
    text: 'Check out our related tutorial for how to model business data, use formulas, ' +
          'and manage complexity.',
    tutorialName: 'Tutorial: Manage Business Data',
  },
}];
