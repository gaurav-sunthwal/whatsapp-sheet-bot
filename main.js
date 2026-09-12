const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { startBot, getGroups, loadConfig, saveConfig, backfillSelectedGroups } = require('./index');
const { getCsvPath, readCsvText, DEFAULT_CSV_PATH } = require('./sheets');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b1326',
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  try {
    const config = loadConfig();
    if (!config.csvPath || config.csvPath.includes('/Users/admin/')) {
      config.csvPath = DEFAULT_CSV_PATH;
      saveConfig(config);
    }
  } catch (_) {
    // ignore
  }

  startBot((type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-update', { type, data });
    }
  });

  ipcMain.handle('get-csv-data', async () => readCsvText());

  ipcMain.handle('get-csv-path', async () => getCsvPath());

  ipcMain.handle('open-csv-file', async () => {
    const csvPath = getCsvPath();
    if (!fs.existsSync(csvPath)) {
      const { initSheetHeaders } = require('./sheets');
      await initSheetHeaders(csvPath);
    }
    await shell.openPath(csvPath);
    return true;
  });

  ipcMain.handle('choose-csv-path', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Choose CSV save location',
      defaultPath: getCsvPath(),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const config = loadConfig();
    config.csvPath = result.filePath;
    saveConfig(config);
    return result.filePath;
  });

  ipcMain.handle('get-groups', async () => await getGroups());
  ipcMain.handle('get-config', async () => loadConfig());
  ipcMain.handle('save-config', async (_event, config) => {
    saveConfig(config);
    return true;
  });
  ipcMain.handle('backfill-history', async (_event, groupJids) => await backfillSelectedGroups(groupJids));

  ipcMain.handle('logout', async () => {
    try {
      const { logoutBot } = require('./index');
      await logoutBot();
    } catch (err) {
      console.error('Error stopping bot on logout:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

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
