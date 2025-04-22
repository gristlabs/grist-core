import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { sessionStorageJsonObs } from "app/client/lib/localStorageObs";
import { FloatingPopup, PopupPosition } from "app/client/ui/FloatingPopup";
import { icon } from "app/client/ui2018/icons";
import { Disposable, DomContents, Holder, styled } from "grainjs";

const t = makeT("Assistant");

export class Assistant extends Disposable {
  private _appModel = this._gristDoc.appModel;
  private _userId = this._appModel.currentUser?.id ?? 0;
  private _docId = this._gristDoc.docId();
  private _popupHolder = Holder.create<FloatingPopup>(this);
  private _width = this.autoDispose(
    sessionStorageJsonObs(
      `u:${this._userId};d:${this._docId};docAssistantWidth`,
      436
    )
  );
  private _height = this.autoDispose(
    sessionStorageJsonObs(
      `u:${this._userId};d:${this._docId};docAssistantHeight`,
      711
    )
  );
  private _position = this.autoDispose(
    sessionStorageJsonObs<PopupPosition | undefined>(
      `u:${this._userId};d:${this._docId};docAssistantPosition`,
      undefined
    )
  );

  constructor(private _gristDoc: GristDoc) {
    super();
    this._showPopup();
  }

  private _showPopup() {
    const popup = FloatingPopup.create(this._popupHolder, {
      title: this._buildPopupTitle.bind(this),
      content: this._buildPopupContent.bind(this),
      onMoveEnd: (position) => this._position.set(position),
      onResizeEnd: ({ width, height, ...position }) => {
        this._width.set(width);
        this._height.set(height);
        this._position.set(position);
      },
      width: this._width.get(),
      height: this._height.get(),
      minWidth: 328,
      minHeight: 300,
      position: this._position.get(),
      minimizable: true,
      closeButton: true,
      closeButtonHover: () => t("Close"),
      onClose: () => this.dispose(),
    });
    popup.showPopup();
  }

  private _buildPopupTitle(): DomContents {
    return cssPopupTitle(icon("Robot"), t("Assistant"));
  }

  private _buildPopupContent(): DomContents {
    return null;
  }
}

const cssPopupTitle = styled("div", `
  display: flex;
  align-items: center;
  column-gap: 8px;
  user-select: none;
`);
