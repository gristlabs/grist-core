import { DomContents, IDisposableOwner } from "grainjs";

export interface WidgetCreatorComposerOptions {
  onSubmit: (prompt: string) => void;
}

/** There is no assistant in this build. */
export function buildWidgetCreatorComposer(
  _owner: IDisposableOwner, _options: WidgetCreatorComposerOptions,
): DomContents {
  return null;
}
