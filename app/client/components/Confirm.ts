// Grist client libs
import * as ModalDialog from 'app/client/components/ModalDialog';
import * as dom from 'app/client/lib/dom';
import * as kd from 'app/client/lib/koDom';
import * as kf from 'app/client/lib/koForm';

export function showConfirmDialog(title: string, btnText: string, onConfirm: () => Promise<void>,
                                  explanation?: Element|string): void {
  const body = dom('div.confirm',
    explanation ? kf.row(explanation, kd.style('margin-bottom', '2rem')) : null,
    kf.row(
      1, kf.buttonGroup(
        kf.button(() => dialog.hide(), 'Cancel')
      ),
      1, kf.buttonGroup(
        kf.accentButton(async () => {
          await onConfirm();
          dialog.hide();
        }, btnText)
      )
    )
  );
  const dialog = ModalDialog.create({
    title,
    body,
    width: '300px',
    show: true
  });
  dialog.once('close', () => dialog.dispose());
}
