

/* globals self, grist */

self.importScripts("/grist-plugin-api.js");

class CustomSection {
  createSection(renderTarget) {
    return grist.api.render('index.html', renderTarget);
  }
}

grist.rpc.registerImpl('hello', new CustomSection(), grist.CustomSectionDescription);
grist.ready();
