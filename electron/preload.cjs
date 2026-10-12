const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('receiptDesktop', Object.freeze({
  offline: true,
  savePng: (bytes, name) => ipcRenderer.invoke('receipt:save-png', bytes, name),
  getAuthorProfile: () => ipcRenderer.invoke('receipt:author'),
  getNotices: () => ipcRenderer.invoke('receipt:notices'),
  openExternal: url => ipcRenderer.invoke('receipt:open-external', url),
}));
