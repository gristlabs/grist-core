import { domAsync } from "app/client/lib/domAsync";
import { loadEmojiPicker } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { HomeModel } from "app/client/models/HomeModel";
import { buildDocIcon, getDefaultIconColors } from "app/client/ui/DocIcon";
import { textarea } from "app/client/ui/inputs";
import { textButton } from "app/client/ui2018/buttons";
import { buildColorPicker, ColorOption } from "app/client/ui2018/ColorSelect";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { saveModal } from "app/client/ui2018/modals";
import { gristThemeObs, gristThemePrefs } from "app/client/ui2018/theme";
import { Document } from "app/common/UserAPI";
import {
  Computed,
  Disposable,
  dom,
  makeTestId,
  Observable,
  styled,
} from "grainjs";
import { defaultMenuOptions, setPopupToCreateDom } from "popweasel";

const t = makeT("RenameDocModal");

const testId = makeTestId("test-dm-");

interface RenameDocModalOptions {
  home: HomeModel;
  doc: Document;
}

export function showRenameDocModal({ home, doc }: RenameDocModalOptions) {
  saveModal((_ctl, owner) => {
    const modal = RenameDocModal.create(owner, { home, doc });
    return {
      title: t("Rename and set icon"),
      body: modal.buildDom(),
      saveFunc: () => modal.save(),
      saveDisabled: modal.saveDisabled,
      modalArgs: [cssModal.cls("")],
    };
  });
}

class RenameDocModal extends Disposable {
  public readonly saveDisabled;

  private readonly _home = this._options.home;
  private readonly _doc = this._options.doc;
  private readonly _name = Observable.create(this, this._doc.name);
  private readonly _defaultIconColors = getDefaultIconColors(this._doc.id);
  private readonly _icon = {
    backgroundColor: Observable.create(
      this,
      this._doc.options?.appearance?.icon?.backgroundColor ??
        this._defaultIconColors.backgroundColor
    ),
    color: Observable.create(
      this,
      this._doc.options?.appearance?.icon?.color ??
        this._defaultIconColors.color
    ),
    emoji: Observable.create(
      this,
      this._doc.options?.appearance?.icon?.emoji ?? null
    ),
  };

  constructor(private _options: RenameDocModalOptions) {
    super();

    this.saveDisabled = Computed.create(
      this,
      this._name,
      (_use, name) => name.trim().length === 0
    );
  }

  public buildDom() {
    return [
      cssField(
        cssLabel(t("Name"), { for: "name" }),
        cssTextArea(
          this._name,
          { onInput: true },
          (el) => {
            setTimeout(() => {
              el.select();
            }, 10);
          },
          { id: "name", placeholder: t("Enter document name") }
        )
      ),
      cssField(
        cssLabel(t("Icon")),
        cssIconAndButtons(
          buildDocIcon(
            {
              docId: this._doc.id,
              docName: this._name,
              icon: this._icon,
            },
            testId("doc-icon-preview")
          ),
          cssButtons(
            textButton(
              cssIconAndLabel(icon("Pencil"), t("Choose color")),
              (el) => {
                setPopupToCreateDom(
                  el,
                  (ctl) =>
                    buildColorPicker(ctl, {
                      styleOptions: {
                        textColor: new ColorOption({
                          color: this._icon.color,
                          allowsNone: false,
                          defaultColor: this._defaultIconColors.color,
                          noneText: this._defaultIconColors.color,
                        }),
                        fillColor: new ColorOption({
                          color: this._icon.backgroundColor,
                          allowsNone: false,
                          defaultColor: this._defaultIconColors.backgroundColor,
                          noneText: this._defaultIconColors.backgroundColor,
                        }),
                      },
                    }),
                  { ...defaultMenuOptions, attach: null }
                );
              }
            ),
            textButton(
              cssIconAndLabel(icon("Smiley"), t("Choose icon")),
              (el) => {
                setPopupToCreateDom(
                  el,
                  (ctl) => {
                    return cssEmojiPicker(
                      domAsync(
                        loadEmojiPicker().then((module) => {
                          if (ctl.isDisposed()) {
                            return;
                          }

                          ctl.update();

                          return module.buildEmojiPicker({
                            onEmojiSelect: (emoji) => {
                              this._icon.emoji.set(emoji.native);
                              ctl.close();
                            },
                            theme: gristThemePrefs.get()?.syncWithOS
                              ? "auto"
                              : gristThemeObs().get().appearance,
                          });
                        })
                      )
                    );
                  },
                  { ...defaultMenuOptions, attach: null }
                );
              }
            ),
            textButton(
              t("Reset icon"),
              dom.on("click", () => {
                this._icon.emoji.set(null);
              }),
              dom.prop("disabled", (use) => !use(this._icon.emoji))
            )
          )
        )
      ),
    ];
  }

  public async save() {
    await this._home.renameDoc(this._doc.id, this._name.get().trim(), {
      icon: {
        backgroundColor: this._icon.backgroundColor.get(),
        color: this._icon.color.get(),
        emoji: this._icon.emoji.get(),
      },
    });
  }
}

const cssModal = styled("div", `
  position: relative;
  width: 100%;
  max-width: 488px;
  min-width: 0px;
`);

const cssField = styled("div", `
  margin: 16px 0;
`);

const cssLabel = styled("label", `
  display: inline-block;
  font-weight: 700;
  line-height: 16px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  margin-bottom: 8px;
`);

const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  padding: 8px 12px;
  outline: none;
  resize: none;
  border-radius: 3px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssIconAndButtons = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

const cssButtons = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`);

const cssIconAndLabel = styled("div", `
  display: flex;
  align-items: center;
  column-gap: 2px;
`);

const cssEmojiPicker = styled("div", `
  z-index: ${vars.emojiPickerZIndex};
`);
