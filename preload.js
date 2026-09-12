const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onBotUpdate: (callback) => ipcRenderer.on('bot-update', (_event, value) => callback(value)),
  getCsvData: () => ipcRenderer.invoke('get-csv-data'),
  getCsvPath: () => ipcRenderer.invoke('get-csv-path'),
  openCsvFile: () => ipcRenderer.invoke('open-csv-file'),
  chooseCsvPath: () => ipcRenderer.invoke('choose-csv-path'),
  logout: () => ipcRenderer.invoke('logout'),
  getGroups: () => ipcRenderer.invoke('get-groups'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  backfillHistory: (groupJids) => ipcRenderer.invoke('backfill-history', groupJids),
});
