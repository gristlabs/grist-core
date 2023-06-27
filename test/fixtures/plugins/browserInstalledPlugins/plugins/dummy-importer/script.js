

/* global grist, window, document, $ */

let resolve;  // eslint-disable-line no-unused-vars

const importer = {
  getImportSource: () => new Promise((_resolve) => {
    resolve = _resolve;
  })
};

grist.rpc.registerImpl('dummy', importer );
grist.rpc.registerImpl('dummy-inlined', importer );

grist.ready();

window.onload = function() {
  callFunctionOnClick('#call-safePython', 'func1@sandbox/main.py', 'Bob');
  callFunctionOnClick('#call-unsafeNode', 'func1@node/main.js', 'Alice');
  document.querySelector('#cancel').addEventListener('click', () => resolve());
  document.querySelector('#ok').addEventListener('click', () => {
    const name = $('#name').val();
    resolve({
      item: {
        kind: "fileList",
        files: [{content: "A,B\n1,2\n", name}]
      },
      description: name + " selected!"
    });
  });
};

function callFunctionOnClick(selector, funcName, ...args) {
  document.querySelector(selector).addEventListener('click', () => {
    grist.rpc.callRemoteFunc(funcName, ...args)
      .then(val => {
        const resElement = document.createElement('h1');
        resElement.classList.add(`result`);
        resElement.textContent = val;
        document.body.appendChild(resElement);
      });
  });
}
