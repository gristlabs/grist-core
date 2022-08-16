import * as server from 'app/server/server'
import { BrowserWindow, app } from 'electron'

server.main();

let mainWindow = null;

function main() {
  mainWindow = new BrowserWindow();
  mainWindow.loadURL(`http://localhost:${process.env.PORT}`);
  mainWindow.on('close', event => {
    mainWindow = null;
  })
}

app.on('ready', main);