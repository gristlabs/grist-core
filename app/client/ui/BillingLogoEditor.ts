import { get as getBrowserGlobals } from "app/client/lib/browserGlobals";
import { selectPicker } from "app/client/lib/uploads";
import { UserError } from "app/client/models/errors";
import { basicButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { testId as globalTestId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { IModalControl, modal } from "app/client/ui2018/modals";

import { Disposable, dom, makeTestId, MultiHolder, Observable, styled } from "grainjs";

const G = getBrowserGlobals("window") as { window: Window };
const testId = makeTestId("test-bp-");

/**
 * Self-contained logo editor widget.
 * Shows a preview (if url is set) or a placeholder icon. Clicking opens a fullscreen
 * editor modal for uploading/removing. On save, calls `onChange` with the new data URL
 * (or "" to remove).
 *
 * Usage: dom.create(BillingLogoEditor, url, onChange)
 */
export class BillingLogoEditor extends Disposable {
  private _selected: Observable<string> = Observable.create(this, "");
  private _onChange: ((url: string) => void) | undefined;
  private _readonly: boolean;

  constructor(
    currentUrl?: string | null,
    onChange?: (url: string) => void,
    options?: { readonly?: boolean },
  ) {
    super();
    this._selected.set(currentUrl || "");
    this._onChange = onChange;
    this._readonly = options?.readonly ?? false;
  }

  public buildDom() {
    return dom.domComputed(this._selected, (currentUrl) => {
      if (currentUrl) {
        return cssWidgetPreview(
          { src: currentUrl },
          dom.on("click", () => this._openModal()),
          testId("logo-preview"),
        );
      }
      return cssWidgetPlaceholder(
        icon("Public", dom.cls(cssWidgetIcon.className)),
        dom.on("click", () => this._openModal()),
        testId("logo-placeholder"),
      );
    });
  }

  private _openModal() {
    modal((ctl, owner) => {
      // Window events interfere with drag and drop. Disable them while the modal is open.
      disableWindowEvents(owner);

      // If FieldEditor is disposed externally (e.g. on navigation), be sure to close the modal.
      this.onDispose(() => this._close(ctl, false));
      return [
        cssFullScreenModal.cls(""),
        dom.onKeyDown({
          Enter: this._close.bind(this, ctl, true),
          Escape: this._close.bind(this, ctl, false),
        }),
        // Close if clicking into the background. (The default modal's behavior for this isn't
        // triggered because our content covers the whole screen.)
        dom.on("click", (ev, elem) => { if (ev.target === elem) { this._close(ctl, true); } }),
        ...this._buildEditorDom(ctl),
      ];
    }, { noEscapeKey: true });
  }

  private _close(ctl: IModalControl, success = true) {
    if (success) {
      this._onChange?.(this._selected.get());
    }
    ctl.close();
  }

  // Builds the logo preview modal.
  private _buildEditorDom(ctl: IModalControl) {
    return [
      cssHeader(
        dom.maybe(this._selected, () =>
          cssTitle(
            "Custom Logo",
          ),
        ),
        cssFlexExpand(
          cssFileButtons(
            this._readonly ? null : [
              cssButton(cssButtonIcon("FieldAttachment"),
                "Upload",
                dom.on("click", () => this._select()),
                globalTestId("pw-add"),
              ),
              dom.maybe(this._selected, () =>
                cssButton(cssButtonIcon("Remove"), "Delete",
                  dom.on("click", () => this._remove()),
                  globalTestId("pw-remove"),
                ),
              ),
            ],
          ),
          cssCloseButton(cssBigIcon("CrossBig"), dom.on("click", () => this._close(ctl)),
            globalTestId("pw-close")),
        ),
      ),
      dom.domComputed(this._selected, selected => renderContent(selected, this._readonly)),

      // Drag-over logic
      (elem: HTMLElement) => dragOverClass(elem, cssDropping.className),
      cssDragArea(this._readonly ? null : cssWarning("Drop a file here")),
      this._readonly ? null : dom.on("drop", ev => this._upload(ev.dataTransfer!.files)),
      globalTestId("pw-modal"),
    ];
  }

  private async _remove() {
    this._selected.set("");
  }

  private async _select(): Promise<void> {
    const uploadResult = await selectPicker({
      multiple: false,
      sizeLimit: "attachment",
      extensions: [".svg", ".png", ".ico", ".jpg", ".jpeg"],
    });
    return this._add(uploadResult);
  }

  private async _upload(files: FileList): Promise<void> {
    return this._add(Array.from(files));
  }

  private async _add(uploadResult: File[] | null): Promise<void> {
    // We accept only .svg, .png, .ico, .jpg, .jpeg.
    // If the file name is ok, convert it to data url, and render.
    // If the file name is not ok, show a warning.
    const firstFile = uploadResult?.[0];
    if (!firstFile) { return; }
    const ext = firstFile.name.split(".").pop()!.toLowerCase();
    if (!["svg", "png", "ico", "jpg", "jpeg"].includes(ext)) {
      throw new UserError("Unsupported file type. Only .svg, .png, .ico, .jpg, and .jpeg files are allowed.");
    }

    const MAX_SIZE = 100 * 1024; // 100KB (roughly the result of downscaling).

    // If this is image other than svg or ico, try to downscale it if it is too large.
    if (["png", "jpg", "jpeg"].includes(ext) && firstFile.size > MAX_SIZE) {
      const dataUrl = await downscaleImage(firstFile);
      this._selected.set(dataUrl);
      return;
    }

    // Validate size of the image, we allow up to 32KB.
    if (firstFile.size > MAX_SIZE) {
      throw new UserError("File size is too large. Only files up to 32KB are allowed.");
    }

    // Read file content and convert it to Data URL
    const dataUrl = await readFileAsDataURL(firstFile);
    // Set the selected file's URL
    this._selected.set(dataUrl);
  }
}

// Helper function outside the class
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function renderContent(att: string | null, readonly: boolean): HTMLElement {
  const commonArgs = [cssContent.cls(""), globalTestId("pw-attachment-content")];
  if (att) {
    return dom("img", dom.attr("src", att), ...commonArgs);
  } else {
    return cssWarning(
      "No logo selected",
      readonly ? null : cssDetails("Drop a file here"),
      readonly ? null : cssSubDetails("Max size 100KB. Larger images will be downscaled."),
      ...commonArgs);
  }
}

function dragOverClass(target: HTMLElement, className: string): void {
  let enterTarget: EventTarget | null = null;
  function toggle(ev: DragEvent, onOff: boolean) {
    enterTarget = onOff ? ev.target : null;
    ev.stopPropagation();
    ev.preventDefault();
    target.classList.toggle(className, onOff);
  }
  dom.onElem(target, "dragenter", ev => toggle(ev, true));
  dom.onElem(target, "dragleave", ev => (ev.target === enterTarget) && toggle(ev, false));
  dom.onElem(target, "drop", ev => toggle(ev, false));
}

// Helper to downscale image to a size that should be under 100KB.
// Inspired by: https://imagekit.io/blog/how-to-resize-image-in-javascript
function downscaleImage(file: File, maxWidth: number = 200, maxHeight: number = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate the new dimensions while preserving aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return reject(new Error("Failed to get canvas context"));
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    const reader = new FileReader();
    reader.onload = (event) => {
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to downscale image"));
    reader.readAsDataURL(file);
  });
}

function disableWindowEvents(owner: MultiHolder) {
  const preventDefault = (e: Event) => e.preventDefault();

  for (const event of ["dragover", "drop"]) {
    G.window.addEventListener(event, preventDefault);
  }

  owner.onDispose(() => {
    for (const event of ["dragover", "drop"]) {
      G.window.removeEventListener(event, preventDefault);
    }
  });
}

const cssFullScreenModal = styled("div", `
  background-color: initial;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0px;
  box-shadow: none;
  padding: 0px;
`);

const cssHeader = styled("div", `
  padding: 16px 24px;
  position: fixed;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
`);

const cssCloseButton = styled("div", `
  padding: 6px;
  border-radius: 32px;
  cursor: pointer;
  background-color: ${theme.attachmentsEditorButtonBg};
  --icon-color: ${theme.attachmentsEditorButtonFg};

  &:hover {
    background-color: ${theme.attachmentsEditorButtonHoverBg};
    --icon-color: ${theme.attachmentsEditorButtonHoverFg};
  }
`);

const cssBigIcon = styled(icon, `
  padding: 10px;
`);

const cssTitle = styled("div", `
  display: inline-block;
  padding: 8px 16px;
  margin-right: 8px;
  min-width: 0px;
  overflow: hidden;

  &:hover {
    outline: 1px solid ${theme.lightText};
  }
  &:focus-within {
    outline: 1px solid ${theme.controlFg};
  }
`);

const cssFlexExpand = styled("div", `
  flex: 1;
  display: flex;
`);

const cssFileButtons = styled(cssButtonGroup, `
  margin-left: auto;
  margin-right: 16px;
  height: 32px;
  flex: none;
`);

const cssButton = styled(basicButton, `
  color: ${theme.attachmentsEditorButtonFg};
  background-color: ${theme.attachmentsEditorButtonBg};
  font-weight: normal;
  padding: 0 16px;
  border-top: none;
  border-right: none;
  border-bottom: none;
  border-left: 1px solid ${theme.attachmentsEditorButtonBorder};
  display: flex;
  align-items: center;

  &:first-child {
    border: none;
  }
  &:hover {
    color: ${theme.attachmentsEditorButtonHoverFg};
    background-color: ${theme.attachmentsEditorButtonHoverBg};
    border-color: ${theme.attachmentsEditorButtonBorder};
  }
`);

const cssButtonIcon = styled(icon, `
  --icon-color: ${theme.attachmentsEditorButtonIcon};
  margin-right: 4px;
`);

const cssDropping = styled("div", "");

const cssContent = styled("div", `
  display: block;
  height: calc(100% - 72px);
  width: calc(100% - 64px);
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  margin-top: 64px;
  margin-bottom: 8px;
  outline: none;
  img& {
    width: max-content;
    height: unset;
  }
  audio& {
    padding-bottom: 64px;
  }
  .${cssDropping.className} > & {
    display: none;
  }
`);

const cssWarning = styled("div", `
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: white;
  padding: 0px;
`);

const cssDetails = styled("div", `
  font-weight: normal;
  margin-top: 24px;
`);

const cssSubDetails = styled("div", `
  font-weight: normal;
  margin-top: 12px;
  font-size: ${vars.smallFontSize};
`);

const cssDragArea = styled(cssContent, `
  border: 2px dashed ${theme.attachmentsEditorBorder};
  height: calc(100% - 96px);
  margin-top: 64px;
  padding: 0px;
  justify-content: center;
  display: none;
  .${cssDropping.className} > & {
    display: flex;
  }
`);

const cssWidgetPreview = styled("img", `
  aspect-ratio: 1;
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  padding: 2px;
  margin: 2px;
  height: 40px;
  cursor: pointer;
  object-fit: cover;
  &:hover {
    border-color: ${theme.accentBorder};
  }
`);

const cssWidgetPlaceholder = styled("div", `
  aspect-ratio: 1;
  color: ${theme.inputPlaceholderFg};
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  padding: 2px;
  margin: 2px;
  height: 40px;
  cursor: pointer;
  display: grid;
  place-items: center;
  &:hover {
    border-color: ${theme.accentBorder};
  }
`);

const cssWidgetIcon = styled("div", `
  height: 60%;
  width: 60%;
  --icon-color: ${theme.inputPlaceholderFg};
`);
