import {
  DefaultActivationPage, IActivationPageCreator
} from "app/client/ui/DefaultActivationPage";

export function getActivationPage(): IActivationPageCreator {
  return DefaultActivationPage;
}

export function showEnterpriseToggle() {
  // To be changed by enterprise module
  return false;
}
