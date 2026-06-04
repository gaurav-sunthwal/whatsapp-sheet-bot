const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { startBot, getGroups, loadConfig, saveConfig } = require('./index');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b1326',
  });

  mainWindow.loadFile('index.html');

  // Uncomment to open DevTools
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  // Start the bot and pass a callback for updates
  startBot((type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-update', { type, data });
    }
  });

  // ── CSV Handlers ──────────────────────────────────────────────────
  ipcMain.handle('get-csv-data', async () => {
    const csvPath = path.join(__dirname, 'beneficiaries.csv');
    if (fs.existsSync(csvPath)) {
      return fs.readFileSync(csvPath, 'utf-8');
    }
    return '';
  });

  ipcMain.handle('open-csv-file', async () => {
    const csvPath = path.join(__dirname, 'beneficiaries.csv');
    if (fs.existsSync(csvPath)) {
      await shell.openPath(csvPath);
      return true;
    }
    return false;
  });

  // ── Group & Settings Handlers ─────────────────────────────────────
  ipcMain.handle('get-groups', async () => {
    return await getGroups();
  });

  ipcMain.handle('get-config', async () => {
    return loadConfig();
  });

  ipcMain.handle('save-config', async (_event, config) => {
    saveConfig(config);
    return true;
  });

  // ── Auth Handlers ─────────────────────────────────────────────────
  ipcMain.handle('logout', async () => {
    // 1. Properly end the bot session and release file locks
    try {
      const { logoutBot } = require('./index');
      await logoutBot();
    } catch (err) {
      console.error('Error stopping bot on logout:', err.message);
    }

    // 2. Wait 1 second to ensure all file handles are completely closed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Clear auth files
    const authPath = path.join(__dirname, 'auth_info_v2');
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to remove auth directory:', err.message);
      }
    }
    app.relaunch();
    app.exit();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
