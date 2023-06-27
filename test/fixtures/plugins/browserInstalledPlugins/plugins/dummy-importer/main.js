

/* global grist, self */

self.importScripts('/grist-plugin-api.js');

grist.addImporter('dummy', 'index.html', 'fullscreen');
grist.addImporter('dummy-inlined', 'index.html', 'inline');
grist.ready();
