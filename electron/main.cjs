const { app, BrowserWindow, protocol, net, session, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const APP_URL = 'app://bundle/index.html';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('ReceiptStudioDesktop');
app.setAppUserModelId('local.receipt.studio');
app.setPath('userData', process.env.RECEIPT_SMOKE_USERDATA || path.join(app.getPath('appData'), 'ReceiptStudioDesktop'));
let mainWindow;

function trusted(event) {
  return mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === APP_URL;
}
function requireTrusted(event) {
  if (!trusted(event)) throw new Error('此操作仅允许来自软件主页面。');
}
function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('链接格式不正确。');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持无账号密码的 HTTP/HTTPS 公开链接。');
  return url.href;
}
function shortText(value, label, max = 200) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new Error(`${label}尚未填写或格式不正确。`);
  return value.trim();
}
function profileImage(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 12 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('作者图片必须是本地 PNG/JPG/WebP 图片。');
  return value;
}
async function readAuthorProfile() {
  let raw;
  try { raw = JSON.parse(await fs.readFile(path.join(app.getAppPath(), 'author-profile.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('作者固定介绍资料尚未提供；请提供昵称和简介后再生成分发安装包。');
    throw new Error(`作者资料无法读取：${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('作者资料格式不正确。');
  const name = shortText(raw.name, '作者名称');
  const bio = shortText(raw.bio, '作者简介', 6000);
  if (!Array.isArray(raw.contacts || []) || (raw.contacts || []).length > 10) throw new Error('作者联系方式格式不正确。');
  const contacts = (raw.contacts || []).map(c => ({ label: shortText(c.label, '联系方式名称', 40), value: shortText(c.value, '联系方式', 500), ...(c.url ? { url: publicUrl(c.url) } : {}) }));
  const illustration = profileImage(raw.illustration);
  return { name, bio, contacts, avatar: profileImage(raw.avatar), qrCode: profileImage(raw.qrCode), illustration, illustrationCaption: illustration ? shortText(raw.illustrationCaption, '角色插图说明') : undefined };
}

function registerBridge() {
  ipcMain.handle('receipt:author', async event => { requireTrusted(event); return readAuthorProfile(); });
  ipcMain.handle('receipt:notices', async event => {
    requireTrusted(event);
    const [usage, thirdParty] = await Promise.all([
      fs.readFile(path.join(app.getAppPath(), 'SOFTWARE_LICENSE.txt'), 'utf8'),
      fs.readFile(path.join(app.getAppPath(), 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
    ]);
    return `${usage}\n\n${thirdParty}`;
  });
  ipcMain.handle('receipt:open-external', async (event, value) => {
    requireTrusted(event);
    await shell.openExternal(publicUrl(value));
  });
  ipcMain.handle('receipt:save-png', async (event, bytes, suggestedName) => {
    requireTrusted(event);
    if (!Array.isArray(bytes) || bytes.length < 33 || bytes.length > 64 * 1024 * 1024 || bytes.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('PNG 数据格式不正确或文件过大。');
    const data = Buffer.from(bytes);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('仅允许保存完整 PNG 图片。');
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (width < 1 || width > 2400 || height < 1 || height > 16000) throw new Error('小票图片尺寸超出允许范围。');
    const name = typeof suggestedName === 'string' ? path.basename(suggestedName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) : '结单小票.png';
    const filename = name.toLowerCase().endsWith('.png') ? name : `${name || '结单小票'}.png`;
    const result = await dialog.showSaveDialog(mainWindow, { title: '保存结单小票', defaultPath: path.join(app.getPath('pictures'), filename), filters: [{ name: 'PNG 图片', extensions: ['png'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (result.canceled || !result.filePath) return { saved: false };
    const target = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : `${result.filePath}.png`;
    const temporary = path.join(path.dirname(target), `.receipt-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, data, { flag: 'wx' });
      await fs.rename(temporary, target);
    } catch (error) {
      try { await fs.unlink(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('无法清理本次导出的临时文件', cleanupError); }
      throw new Error(`图片保存失败：${error.message}`);
    }
    return { saved: true, path: target };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1360, height: 940, minWidth: 980, minHeight: 700, title: '小票工坊', backgroundColor: '#fff8ee', titleBarStyle: 'hidden', titleBarOverlay: { color: '#fffaf3', symbolColor: '#362b2a', height: 36 }, autoHideMenuBar: true, show: false, icon: path.join(app.getAppPath(), 'build/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) event.preventDefault(); });
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow, { type: 'warning', title: '仍有未保存内容', message: '当前内容尚未保存，或图片正在导出。', detail: '留在软件中可继续处理；放弃并退出可能丢失当前修改。', buttons: ['留在软件', '放弃并退出'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice === 1) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.loadURL(APP_URL).catch(error => { dialog.showErrorBox('小票工坊启动失败', `无法加载本地软件页面。\n${error.message}`); app.quit(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(() => {
    const root = path.join(app.getAppPath(), 'dist');
    protocol.handle('app', async request => {
      const url = new URL(request.url);
      if (url.host !== 'bundle' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
      const filename = path.resolve(root, `.${pathname}`);
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
      try {
        const result = await net.fetch(pathToFileURL(filename).href);
        const headers = new Headers(result.headers);
        headers.set('Content-Security-Policy', CSP);
        return new Response(result.body, { status: result.status, headers });
      } catch { return new Response('本地资源不存在', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === mainWindow?.webContents && permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === mainWindow?.webContents && permission === 'clipboard-sanitized-write');
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.on('will-download', (event, item, contents) => {
      if (contents !== mainWindow?.webContents || !item.getURL().startsWith('blob:app://bundle/') || !item.getFilename().toLowerCase().endsWith('.json')) {
        event.preventDefault();
        return;
      }
      item.setSaveDialogOptions({ title: '保存小票设计', defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())), filters: [{ name: '小票设计 JSON', extensions: ['json'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    });
    registerBridge();
    createWindow();
  }).catch(error => { dialog.showErrorBox('小票工坊启动失败', error.message); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
