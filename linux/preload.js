// Da’imun for Linux: gives the shared web page the same bridge the Windows app uses
// (window.chrome.webview.postMessage), plus the saved chart before the page's own script runs.
const { ipcRenderer } = require('electron');

window.__DAIMUN_LINUX__ = true;
window.chrome = window.chrome || {};
window.chrome.webview = { postMessage: (s) => ipcRenderer.send('page-message', String(s)) };
try {
  const data = ipcRenderer.sendSync('initial-data');
  if (data) window.__ISTIQAMAH_DATA__ = JSON.parse(data);
} catch (e) { /* start with the browser copy */ }
