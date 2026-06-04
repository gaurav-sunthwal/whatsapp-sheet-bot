const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onBotUpdate: (callback) => ipcRenderer.on('bot-update', (_event, value) => callback(value)),
  getCsvData: () => ipcRenderer.invoke('get-csv-data'),
  openCsvFile: () => ipcRenderer.invoke('open-csv-file'),
  logout: () => ipcRenderer.invoke('logout'),
  getGroups: () => ipcRenderer.invoke('get-groups'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
});
