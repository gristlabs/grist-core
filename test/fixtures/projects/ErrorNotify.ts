import { INotifyOptions, Notifier } from 'app/client/models/NotifyModel';
import { buildNotifyMenuButton, buildSnackbarDom } from 'app/client/ui/NotifyUI';
import { cssRootVars } from 'app/client/ui2018/cssVars';
import { delay } from 'bluebird';
import { dom, Holder, MultiHolder, styled } from 'grainjs';

let errHolder1 = Holder.create(null);
let errHolder2 = Holder.create(null);

const notifier = Notifier.create(null);
let multiHolder = new MultiHolder();
multiHolder.autoDispose(errHolder1);
multiHolder.autoDispose(errHolder2);

function radioGroup(clb: (value: string) => any) {
  const store = radioGroup as any;
  store.group = store.group || 0;
  store.radioId = store.radioId || 0;
  const group = store.group++;
  return (name: string, value: string) => {
    const radioId = store.radioId++;
    return [
      dom("input", {
        type: 'radio',
        name : `radio_group_${group}`,
        value: value,
        id : `radio${radioId}`
      }, dom.on('change', () => clb(value))),
      dom("label", { for : `radio${radioId}`}, dom.text(name))
    ];
  };
}

let notify = (message: string, options?: Partial<INotifyOptions>) =>  {
  return multiHolder.autoDispose(notifier.createUserMessage(message, {...options, inDropdown: true}) as any);
};

function setLevels(level: string) {
  function show(l: string) {
    return (msg: string, options?: Partial<INotifyOptions>) =>
      multiHolder.autoDispose(notifier.createUserMessage(msg, {...options, level: l as any, inDropdown: true}));
  }
  if (level === "all") {
    notify = (...args: any[]) => {
      const holder = new MultiHolder();
      holder.autoDispose(show("error")(args[0], args[1]));
      holder.autoDispose(show("warning")(args[0], args[1]));
      holder.autoDispose(show("success")(args[0], args[1]));
      holder.autoDispose(show("message")(args[0], args[1]));
      holder.autoDispose(show("info")(args[0], args[1]));
      multiHolder.autoDispose(holder);
      return holder;
    };
  } else {
    notify = show(level);
  }
}

function setupTest() {
  const radio = radioGroup(setLevels);
  return cssWrapper(
    buildNotifyMenuButton(notifier, null),
    dom("div", "Message level"),
    dom("div", [
      radio("Message", "message"),
      radio("Info", "info"),
      radio("Success", "success"),
      radio("Warning", "warning"),
      radio("Error", "error"),
      radio("All", "all"),
    ]),
    dom('button',
      'Close all',
      dom.on('click', () =>  {
        multiHolder.dispose();
        multiHolder = new MultiHolder();
        errHolder1 = new Holder();
        errHolder2 = new Holder();
        multiHolder.autoDispose(errHolder1);
        multiHolder.autoDispose(errHolder2);
      })
    ),
    dom('br'),
    dom('button.user-error-default',
      'User error example (default expire)',
      dom.on('click', () =>  {
        notify(`Workspace name is duplicated (default)`, {expireSec: 1});
      })
    ),
    dom('br'),
    dom('button.user-error-2sec',
      'User multi-line error example (custom expire in 2 secs)',
      dom.on('click', () => {
        notify(`Workspace name is duplicated and the error is way too long for one line (custom)`,
          { expireSec: 2 });
      })
    ),
    dom('br'),
    dom('button',
      'User error example (default expire or on click)',
      dom.on('click', () => {
        if (errHolder1.isEmpty()) {
          errHolder1.autoDispose(notify(`Workspace name is duplicated (clear on click)`));
        } else {
          errHolder1.clear();
        }
      })
    ),
    dom('br'),
    dom('button',
      'User error example (no expire until click)',
      dom.on('click', () => {
        if (errHolder2.isEmpty()) {
          errHolder2.autoDispose(notify(`Workspace name is duplicated (no expire)`,
            { expireSec: 0 }));
        } else {
          errHolder2.clear();
        }
      })
    ),
    dom('br'),
    dom('button',
      'User error with dismiss',
      dom.on('click', () => {
        notify(`Example error with dismiss`, { expireSec: 0, canUserClose: true });
      })
    ),
    dom('br'),
    dom('button',
      'User multi-line error with dismiss',
      dom.on('click', () => {
        notify(`Example error with dismiss and a long, long, long message`, { canUserClose: true });
      })
    ),
    dom('br'),
    dom('button',
      'Unexpected error',
      dom.on('click', () => {
        notify("10:03:10 Cannot read property of null (reading 'callback')",
        {
          title : "Unexpected error",
          actions : ['report-problem'],
          expireSec: 0,
          canUserClose: true
        });
      })
    ),
    dom('hr'),
    dom('button',
      'Import a file - success',
      dom.on('click', async () => {
        const progress = notifier.createProgressIndicator('Foo Sample.pdf', '12mb');
        multiHolder.autoDispose(progress);
        for (let i = 1; i <= 4; i++) {
          await delay(500);
          if (progress.isDisposed()) {
            break;
          }
          progress.setProgress(25 * i);
        }
      })
    ),
    dom('button',
      'Import a file - failure',
      dom.on('click', async () => {
        const holder = Holder.create(null);
        multiHolder.autoDispose(holder);
        const progress = notifier.createProgressIndicator('Foo Sample.pdf', '12mb');
        holder.autoDispose(progress);
        for (let i = 1; i <= 3; i++) {
          await delay(500);
          if (progress.isDisposed()) {
            return;
          }
          progress.setProgress(25 * i);
        }
        holder.autoDispose(notifier.createUserMessage('Unable to upload Foo Sample.pdf',
          { expireSec: 0, canUserClose: true, level: 'error' }));
      })
    ),
    dom('hr'),
    dom('button',
      'Common popups',
      dom.on('click', async () => {
        multiHolder.dispose();
        multiHolder = new MultiHolder();
        const noExp = { expireSec: 0, canUserClose: true };
        let n = notifier.createUserMessage("10:03:10 Cannot read property of null (reading 'callback')",
        {
          title : "Unexpected error",
          actions : ['report-problem'],
          level: 'error',
          ...noExp
        });
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("Blocked by table update access rules", noExp);
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("No more documents permitted", {
           title: "Reached plan limit",
           actions : ['upgrade'],
           ...noExp
        });
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("Still working ...", noExp);
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("Link copied to clipboard", noExp);
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("Cannot change summary column 'count' between formula and data", {
          actions : ['ask-for-help'],
          level: 'error',
          ...noExp
        });
        multiHolder.autoDispose(n);
        n = notifier.createUserMessage("Cannot change summary column 'count' between formula and data", {
          actions : ['ask-for-help'],
          title : "Warning",
          level: 'error',
          ...noExp
        });
        multiHolder.autoDispose(n);
        const progress = notifier.createProgressIndicator('Foo Sample.pdf', '12mb');
        progress.setProgress(25);
        multiHolder.autoDispose(progress);
      })
    ),
    buildSnackbarDom(notifier, null),
  );
}

// Load icons.css, wait for it to load, then build the page.
document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'},
  dom.on('load', () => dom.update(document.body, dom.cls(cssRootVars), setupTest()))
));

const cssWrapper = styled('div', `
`);
