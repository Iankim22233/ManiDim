const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');   // keep rendering/timing smooth in VMs and when partly covered
if (process.env.MANIDIM_IMPORT) app.setPath('userData', path.join(require('os').tmpdir(), 'manidim-devprofile'));   // dev: keep test imports out of the real profile
const SHOT = process.env.MANIDIM_SHOT;           // dev: capture a screenshot of the window and quit

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1100, minHeight: 700, backgroundColor: '#000', title: 'ManiDim', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, sandbox: true },
  });
  const query = {};
  for (const a of process.argv.slice(1)) { const m = /^--(\w+)=(.*)$/.exec(a); if (m) query[m[1]] = m[2]; }
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  win.webContents.on('before-input-event', (e, input) => {
    // swallow browser shortcuts that would interfere with playing
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); return; }
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && ['r', 'w', 'p', 's'].includes(input.key.toLowerCase())))) e.preventDefault();
  });
  win.webContents.session.on('will-download', (event, item) => {
    const p = dialog.showSaveDialogSync(win, { defaultPath: item.getFilename(), filters: [{ name: 'ManiDim package', extensions: ['madim'] }, { name: 'All files', extensions: ['*'] }] });
    if (p) item.setSavePath(p); else item.cancel();
  });
  if (process.env.MANIDIM_KEYBOT) {
    win.webContents.on('console-message', (e, level, msg) => { if (msg.startsWith('KEYBOTDBG')) console.log(msg); else if (msg.startsWith('KEYBOT')) { console.log(msg); app.quit(); } });
    setTimeout(() => { console.log('KEYBOT timeout'); app.quit(); }, Number(process.env.MANIDIM_KEYBOT) * 1000);
  }
  if (process.env.MANIDIM_IMPORT) {      // dev: import files ('|'-separated paths) through the same code as the Import button
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      const fs = require('fs');
      const list = process.env.MANIDIM_IMPORT.split('|').map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }));
      win.webContents.executeJavaScript(`window.__devImport(${JSON.stringify(list)})`);
    }, 1500));
  }
  if (SHOT) {
    const wait = Number(process.env.MANIDIM_WAIT || 6000);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('[renderer]', msg); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(SHOT, img.toPNG());
      app.quit();
    }, wait));
  }
  return win;
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
