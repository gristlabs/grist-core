import {
  DefaultActivationPage, IActivationPageCreator
} from "app/client/ui/DefaultActivationPage";

export function getActivationPage(): IActivationPageCreator {
  return DefaultActivationPage;
}
