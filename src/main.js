import './style.css';
import { createDefaultReceipt, validateReceipt } from './core/model.js';
import { RECEIPT_THEMES, applyReceiptTheme } from './core/themes.js';
import { calculateReceipt } from './core/money.js';
import { parseOrderText } from './core/parser.js';
import { renderReceipt } from './core/render.js';
import { loadDraft, saveDraft } from './storage.js';

const iconNames = ['receipt-text', 'shield-check', 'circle-user-round', 'folder-open', 'file-down', 'image-down', 'clipboard-list', 'arrow-up-right', 'notebook-pen', 'list-plus', 'plus', 'calculator', 'palette', 'image-plus', 'upload', 'x', 'message-square-text', 'rotate-ccw', 'hard-drive', 'scan-line', 'scan-text', 'book-open', 'trash-2', 'chevron-up', 'chevron-down', 'copy', 'external-link'];
const iconPositions = new Map(iconNames.map((name, index) => [name, `${(index % 6) * 20}% ${Math.floor(index / 6) * 25}%`]));
const $ = (id) => document.getElementById(id);
const bridge = window.receiptDesktop;
const MAX_URL = 12 * 1024 * 1024;
const MAX_DESIGN = 66 * 1024 * 1024;
let receipt = createDefaultReceipt();
let revision = 0;
let renderedRevision = -1;
let persistedRevision = 0;
let renderedCanvas = null;
let renderPromise = null;
let renderError = '';
let currentValid = null;
let saveTimer;
let queuedSave = null;
let saving = false;
let initialized = false;
let exportBusy = false;
let uploadTarget = null;
let candidate = null;
let notificationTimer;
let authorPromise;

function refreshIcons() {
  for (const element of document.querySelectorAll('i[data-icon]:not(.app-icon)')) {
    const position = iconPositions.get(element.dataset.icon);
    if (position === undefined) throw new Error(`界面图标不存在：${element.dataset.icon}`);
    element.classList.add('app-icon');
    element.setAttribute('aria-hidden', 'true');
    element.style.maskPosition = position;
  }
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function icon(name) {
  const element = node('i');
  element.dataset.icon = name;
  return element;
}
function actionButton(label, iconName, action, id) {
  const button = node('button', 'icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.action = action;
  button.dataset.id = id;
  button.append(icon(iconName));
  return button;
}
function report(message, failure = false) {
  clearTimeout(notificationTimer);
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  (dialogs.at(-1) || document.body).append($('notification'));
  $('notification').textContent = message;
  $('notification').classList.toggle('failure', failure);
  $('notification').hidden = false;
  notificationTimer = setTimeout(() => { $('notification').hidden = true; }, failure ? 9000 : 5500);
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function getField(path) { return path.split('.').reduce((value, key) => value[key], receipt); }
function setField(path, value) {
  const parts = path.split('.');
  const key = parts.pop();
  const target = parts.reduce((value, part) => value[part], receipt);
  target[key] = value;
}
function newId() { return crypto.randomUUID(); }
function bindFields() {
  for (const input of document.querySelectorAll('[data-field]')) {
    const value = getField(input.dataset.field);
    if (input.type === 'checkbox') input.checked = value;
    else if (input.type === 'radio') input.checked = input.value === value;
    else input.value = value;
  }
  updateDependentControls();
}
function updateDependentControls() {
  for (const input of document.querySelectorAll('[data-custom-label]')) {
    input.setAttribute('aria-label', receipt.fieldLabels[input.dataset.customLabel]);
  }
  for (const output of document.querySelectorAll('[data-output]')) {
    const value = getField(output.dataset.output);
    output.textContent = `${Math.round(value * 100)}%`;
  }
  for (const input of $('background-controls').querySelectorAll('input')) input.disabled = !receipt.background.dataUrl;
  document.querySelector('[data-field="fees.rushMultiplier"]').disabled = !receipt.fees.rushEnabled;
  document.querySelector('[data-field="fees.discountRate"]').disabled = !receipt.fees.discountEnabled;
  document.querySelector('[data-field="fees.discountBeforeRush"]').disabled = !(receipt.fees.rushEnabled && receipt.fees.discountEnabled);
  document.querySelector('[data-field="fees.couponBeforeDiscount"]').disabled = !receipt.fees.discountEnabled;
  for (const target of ['logo', 'footerImage', 'background']) {
    const exists = target === 'background' ? receipt.background.dataUrl : receipt[target];
    $(`${target}-status`).textContent = exists ? '已添加 · 随设计保存' : '未添加';
    document.querySelector(`[data-remove-asset="${target}"]`).disabled = !exists;
  }
  $('add-item').disabled = receipt.items.length >= 80;
  $('add-sticker').disabled = receipt.stickers.length >= 30;
  $('item-count').textContent = `${receipt.items.length} / 80`;
  $('sticker-count').textContent = `${receipt.stickers.length} / 30`;
}
function renderItems() {
  $('item-list').replaceChildren();
  receipt.items.forEach((item, index) => {
    const row = node('div', 'item-row');
    const heading = node('div', 'item-heading');
    heading.append(node('span', 'item-number', String(index + 1).padStart(2, '0')));
    const tools = node('div', 'row-tools');
    const up = actionButton('项目上移', 'chevron-up', 'item-up', item.id);
    up.disabled = index === 0;
    const down = actionButton('项目下移', 'chevron-down', 'item-down', item.id);
    down.disabled = index === receipt.items.length - 1;
    const remove = actionButton('删除项目', 'trash-2', 'item-remove', item.id);
    remove.disabled = receipt.items.length === 1;
    tools.append(up, down, remove);
    heading.append(tools);
    const fields = node('div', 'item-fields');
    const nameLabel = node('label', '', '项目内容');
    const name = node('textarea');
    name.rows = 2;
    name.maxLength = 400;
    name.placeholder = '服务名称、时长或说明';
    name.value = item.name;
    name.dataset.itemId = item.id;
    name.dataset.itemField = 'name';
    nameLabel.append(name);
    const amountLabel = node('label', '', '总价 / 元');
    const amount = node('input');
    amount.inputMode = 'decimal';
    amount.value = item.amount;
    amount.dataset.itemId = item.id;
    amount.dataset.itemField = 'amount';
    amount.setAttribute('aria-label', `第 ${index + 1} 项总价`);
    amountLabel.append(amount);
    fields.append(nameLabel, amountLabel);
    row.append(heading, fields);
    $('item-list').append(row);
  });
  updateDependentControls();
  refreshIcons();
}
function slider(label, value, min, max, step, id, field) {
  const wrapper = node('label', 'sticker-slider', label);
  const output = node('output', '', field === 'rotation' ? `${value}°` : `${Math.round(value * 100)}%`);
  output.dataset.stickerOutput = field;
  const input = node('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.dataset.stickerId = id;
  input.dataset.stickerField = field;
  wrapper.append(output, input);
  return wrapper;
}
function renderStickers() {
  $('sticker-list').replaceChildren();
  receipt.stickers.forEach((sticker, index) => {
    const row = node('div', 'sticker-row');
    const heading = node('div', 'sticker-title');
    const image = node('img', 'sticker-thumb');
    image.src = sticker.dataUrl;
    image.alt = `贴纸 ${index + 1}`;
    heading.append(image, node('strong', '', `贴纸 ${index + 1}`));
    const tools = node('div', 'row-tools');
    const up = actionButton('贴纸向下层移动', 'chevron-up', 'sticker-up', sticker.id);
    up.disabled = index === 0;
    const down = actionButton('贴纸向上层移动', 'chevron-down', 'sticker-down', sticker.id);
    down.disabled = index === receipt.stickers.length - 1;
    tools.append(up, down, actionButton('移除贴纸', 'trash-2', 'sticker-remove', sticker.id));
    heading.append(tools);
    row.append(heading,
      slider('横向位置', sticker.x, 0, 1, 0.005, sticker.id, 'x'),
      slider('纵向位置', sticker.y, 0, 1, 0.005, sticker.id, 'y'),
      slider('宽度比例', sticker.width, 0, 1, 0.005, sticker.id, 'width'),
      slider('旋转角度', sticker.rotation, -360, 360, 1, sticker.id, 'rotation'));
    $('sticker-list').append(row);
  });
  updateDependentControls();
  refreshIcons();
}
function updateExportButton() {
  $('export-png').disabled = !initialized || exportBusy || !currentValid || Boolean(renderError) || renderedRevision !== revision || Boolean(renderPromise);
  $('save-design').disabled = !initialized || exportBusy || !currentValid;
}
function saveStatus(text, failure = false) {
  $('save-status').textContent = text;
  $('save-status').parentElement.classList.toggle('failure', failure);
}
function enqueueSave(normalized) {
  clearTimeout(saveTimer);
  saveStatus('尚未保存 · 正在等待输入结束');
  const targetRevision = revision;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    queuedSave = { receipt: normalized, revision: targetRevision };
    void drainSaves();
  }, 650);
}
async function drainSaves() {
  if (saving) return;
  saving = true;
  try {
    while (queuedSave) {
      const pending = queuedSave;
      queuedSave = null;
      if (pending.revision !== revision) continue;
      saveStatus('正在保存到本机…');
      try {
        const date = await saveDraft(pending.receipt);
        persistedRevision = pending.revision;
        if (pending.revision === revision) saveStatus(`已保存到本机 · ${new Date(date).toLocaleTimeString('zh-CN', { hour12: false })}`);
      } catch (error) {
        if (pending.revision === revision) saveStatus(`自动保存失败：${errorMessage(error)}。请保存设计备份。`, true);
      }
    }
  } finally { saving = false; }
}
function changed({ persist = true } = {}) {
  revision += 1;
  currentValid = null;
  renderError = '';
  clearTimeout(saveTimer);
  saveTimer = null;
  queuedSave = null;
  $('validation-error').hidden = true;
  try {
    const normalized = validateReceipt(receipt);
    const amounts = calculateReceipt(normalized);
    currentValid = normalized;
    $('total-amount').textContent = `¥ ${amounts.total}`;
    $('amount-breakdown').replaceChildren(...[
      ['项目合计', amounts.subtotal], ['加急', amounts.rush], ['折扣减免', amounts.discount], ['优惠减免', amounts.coupon],
    ].map(([label, amount]) => node('span', '', `${label} ¥${amount}`)));
    $('formula').textContent = amounts.formula;
    if (persist) enqueueSave(normalized);
    $('receipt-preview').classList.add('stale');
    $('preview-state').hidden = false;
    $('preview-state').textContent = '正在更新整张小票…';
    $('render-status').textContent = '图片处理中';
    requestRender();
  } catch (error) {
    renderError = errorMessage(error);
    $('total-amount').textContent = '—';
    $('amount-breakdown').replaceChildren();
    $('formula').textContent = '请修正输入后继续计算。金额支持最多两位小数，不支持负数。';
    $('validation-error').textContent = renderError;
    $('validation-error').hidden = false;
    $('receipt-preview').classList.add('stale');
    $('preview-state').hidden = false;
    $('preview-state').textContent = '输入尚未有效；右侧旧预览不可导出';
    $('render-status').textContent = '等待修正';
    if (persist) saveStatus('有未保存的无效输入 · 上次有效草稿保留', true);
  }
  updateDependentControls();
  updateExportButton();
}
function requestRender() {
  if (renderPromise) return;
  renderPromise = drainRenders().finally(() => {
    renderPromise = null;
    updateExportButton();
  });
  updateExportButton();
}
async function drainRenders() {
  while (currentValid && renderedRevision !== revision) {
    const targetRevision = revision;
    const snapshot = currentValid;
    const canvas = document.createElement('canvas');
    try {
      const dimensions = await renderReceipt(canvas, snapshot);
      if (targetRevision !== revision) continue;
      if (dimensions.width !== canvas.width || dimensions.height !== canvas.height || canvas.width > 2400 || canvas.height > 16000) throw new Error('小票图片尺寸异常，无法安全导出');
      const preview = $('receipt-preview');
      preview.width = canvas.width;
      preview.height = canvas.height;
      preview.getContext('2d').drawImage(canvas, 0, 0);
      preview.classList.remove('stale');
      renderedCanvas = canvas;
      renderedRevision = targetRevision;
      renderError = '';
      preview.setAttribute('aria-label', `${snapshot.title}，完整小票预览，最终金额 ${calculateReceipt(snapshot).total} 元`);
      $('preview-state').hidden = true;
      $('render-status').textContent = `${canvas.width} × ${canvas.height} · 可导出`;
    } catch (error) {
      if (targetRevision !== revision) continue;
      renderError = errorMessage(error);
      $('validation-error').textContent = `预览失败：${renderError}`;
      $('validation-error').hidden = false;
      $('preview-state').hidden = false;
      $('preview-state').textContent = '预览未完成，不能导出旧图或部分图片';
      $('render-status').textContent = '图片生成失败';
      break;
    }
  }
}
function applyReceipt(next) {
  receipt = next;
  bindFields();
  renderItems();
  renderStickers();
  changed();
}
function safeFilename(extension) {
  const title = receipt.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 50) || '结单小票';
  return `${title}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = node('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function lockEditing(locked) {
  exportBusy = locked;
  document.querySelector('.editor-scroll').inert = locked;
  $('load-design').disabled = locked || !initialized;
  $('extract-button').disabled = locked;
  $('export-png').querySelector('span').textContent = locked ? '正在导出…' : '导出 PNG';
  updateExportButton();
}
async function exportPng() {
  if (exportBusy || !currentValid) return;
  lockEditing(true);
  try {
    while (renderPromise) await renderPromise;
    if (renderError || renderedRevision !== revision || !renderedCanvas) throw new Error(renderError || '最新小票尚未生成');
    const targetRevision = revision;
    const blob = await new Promise((resolve, reject) => renderedCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png'));
    if (targetRevision !== revision) throw new Error('导出期间设计发生变化，请重新导出');
    if (blob.size > 64 * 1024 * 1024) throw new Error('PNG 超过 64MB，请减小图片或内容后重试');
    const filename = safeFilename('png');
    if (bridge?.savePng) {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const result = await bridge.savePng(bytes, filename);
      report(result.saved ? `PNG 已保存${result.path ? `：${result.path}` : ''}` : '已取消 PNG 保存，未写入文件');
    } else {
      downloadBlob(blob, filename);
      report('PNG 下载已发起；请在浏览器中确认文件是否保存');
    }
  } catch (error) { report(`导出失败：${errorMessage(error)}`, true); }
  finally { lockEditing(false); }
}
async function decodeAsset(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_URL || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('仅支持不超过 12MB 的 PNG、JPG 或 WebP 图片数据');
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new Error('图片无法解码，文件可能已损坏'); }
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 24000000) throw new Error('图片过大：边长上限 8192 像素，总面积上限 2400 万像素');
}
async function validateAllAssets(next) {
  const urls = [next.logo, next.footerImage, next.background.dataUrl, ...next.stickers.map((item) => item.dataUrl)].filter(Boolean);
  for (const url of new Set(urls)) await decodeAsset(url);
  return next;
}
async function readImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 9 * 1024 * 1024) throw new Error('请选择不超过 9MB 的本机 PNG、JPG 或 WebP 文件');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片文件'));
    reader.readAsDataURL(file);
  });
  await decodeAsset(dataUrl);
  return dataUrl;
}
function openDialog(id) { $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function invalidateCandidate() {
  candidate = null;
  $('apply-candidate').disabled = true;
  $('parse-result').hidden = true;
  $('parse-error').hidden = true;
}
function showCandidate(result) {
  $('candidate-fields').replaceChildren();
  const labels = { title: '标题', subtitle: '副标题', ...result.receipt.fieldLabels, paymentMethod: '支付方式', startedAt: '开始时间', issuedAt: '结单时间' };
  for (const [field, label] of Object.entries(labels)) {
    const line = node('div', 'candidate-field');
    line.append(node('span', '', label), node('strong', '', result.receipt[field] || '未填写'));
    $('candidate-fields').append(line);
  }
  $('candidate-items').replaceChildren(...result.receipt.items.map((item) => node('li', '', `${item.name || '未命名项目'} · ¥ ${item.amount}`)));
  const money = calculateReceipt(result.receipt);
  $('candidate-total').textContent = `优惠 ¥ ${result.receipt.fees.couponAmount} · 预计合计 ¥ ${money.total}`;
  $('parse-warnings').replaceChildren(node('strong', '', `识别 ${result.recognized} 处。未识别或有歧义的内容：`));
  if (result.warnings.length) {
    const list = node('ul');
    for (const warning of result.warnings) list.append(node('li', '', warning));
    $('parse-warnings').append(list);
  } else $('parse-warnings').append(node('p', '', '无额外提示，仍请核对客户和项目金额。'));
  $('parse-result').hidden = false;
}
async function showAuthor() {
  openDialog('about-dialog');
  $('author-content').replaceChildren(node('p', 'helper', '正在读取随软件打包的作者资料…'));
  if (!authorPromise) authorPromise = (async () => {
    if (!bridge?.getAuthorProfile) throw new Error('浏览器开发预览没有固定作者资料。正式安装包须由提供者填写真实作者信息。');
    const profile = await bridge.getAuthorProfile();
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || typeof profile.bio !== 'string' || !profile.bio.trim() || !Array.isArray(profile.contacts)) throw new Error('真实作者资料尚未提供；开发状态不会展示虚构作者。');
    for (const asset of [profile.avatar, profile.qrCode, profile.illustration].filter(Boolean)) await decodeAsset(asset);
    return profile;
  })().catch((error) => { authorPromise = null; throw error; });
  try {
    const profile = await authorPromise;
    const content = $('author-content');
    content.replaceChildren();
    const layout = node('div', `author-layout${profile.illustration ? ' has-illustration' : ''}`);
    const details = node('div', 'author-details');
    if (profile.illustration) {
      const figure = node('figure', 'author-illustration');
      const image = node('img');
      image.src = profile.illustration;
      image.alt = profile.illustrationCaption;
      figure.append(image);
      layout.append(figure);
    }
    layout.append(details);
    content.append(layout);
    const heading = node('div', 'author-heading');
    if (profile.avatar) {
      const image = node('img', 'author-avatar');
      image.src = profile.avatar;
      image.alt = `${profile.name} 的头像`;
      heading.append(image);
    }
    heading.append(node('h3', '', profile.name));
    details.append(heading, node('p', 'author-bio', profile.bio));
    if (profile.qrCode) {
      const image = node('img', 'author-qr');
      image.src = profile.qrCode;
      image.alt = '作者提供的联系二维码';
      const contact = node('section', 'author-contact');
      contact.setAttribute('aria-label', '微信联系');
      const caption = node('div', 'author-qr-caption');
      caption.append(node('strong', '', '微信联系'), node('p', '', '扫码添加微信'));
      contact.append(image, caption);
      details.append(contact);
    }
    for (const contact of profile.contacts) {
      if (!contact || typeof contact.label !== 'string' || typeof contact.value !== 'string') throw new Error('作者联系资料格式不正确');
      const row = node('div', 'contact-row');
      const words = node('div');
      words.append(node('small', '', contact.label), node('strong', '', contact.value));
      const copy = actionButton(`复制${contact.label}${contact.url ? '链接' : ''}`, 'copy', 'copy-contact', '');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(contact.url || contact.value); report(contact.url ? '链接已复制' : '联系信息已复制'); }
        catch { report('无法访问剪贴板，请稍后重试或使用打开主页按钮', true); }
      });
      row.append(words, copy);
      if (contact.url) {
        let url;
        try { url = new URL(contact.url); } catch { throw new Error('作者链接格式不正确'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('作者链接仅支持 HTTP 或 HTTPS');
        const link = actionButton(`打开${contact.label}链接`, 'external-link', 'open-contact', '');
        link.classList.remove('icon-button');
        link.append(node('span', '', '打开主页'));
        link.addEventListener('click', async () => {
          try {
            if (!bridge?.openExternal) throw new Error('外部链接仅在桌面软件中打开；浏览器预览不会跳转');
            await bridge.openExternal(url.href);
          } catch (error) { report(errorMessage(error), true); }
        });
        row.append(link);
      }
      details.append(row);
    }
    refreshIcons();
  } catch (error) {
    $('author-content').replaceChildren(node('div', 'author-unavailable', '作者资料尚未就绪'), node('p', 'helper', errorMessage(error)));
  }
}

for (const [id, preset] of Object.entries(RECEIPT_THEMES)) {
  const label = node('label');
  label.style.setProperty('--theme-paper', preset.paperColor);
  label.style.setProperty('--theme-accent', preset.accentColor);
  const input = node('input');
  input.type = 'radio';
  input.name = 'receipt-theme';
  input.value = id;
  input.dataset.field = 'theme';
  const swatch = node('span', 'theme-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  const words = node('span', 'theme-copy', preset.name);
  words.append(node('small', '', preset.description));
  label.append(input, swatch, words);
  $('theme-options').append(label);
}

for (const input of document.querySelectorAll('[data-field]')) input.addEventListener('input', () => {
  if (!initialized || exportBusy) return;
  if (input.type === 'radio' && !input.checked) return;
  const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
  if (input.dataset.field === 'theme') {
    applyReceiptTheme(receipt, value);
    bindFields();
  } else setField(input.dataset.field, value);
  changed();
});
$('item-list').addEventListener('input', (event) => {
  const input = event.target;
  const item = receipt.items.find((entry) => entry.id === input.dataset.itemId);
  if (!item || exportBusy) return;
  item[input.dataset.itemField] = input.value;
  changed();
});
$('sticker-list').addEventListener('input', (event) => {
  const input = event.target;
  const sticker = receipt.stickers.find((entry) => entry.id === input.dataset.stickerId);
  if (!sticker || exportBusy) return;
  const field = input.dataset.stickerField;
  sticker[field] = Number(input.value);
  input.parentElement.querySelector('output').textContent = field === 'rotation' ? `${sticker[field]}°` : `${Math.round(sticker[field] * 100)}%`;
  changed();
});
for (const kind of ['item', 'sticker']) $(kind === 'item' ? 'item-list' : 'sticker-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || exportBusy) return;
  const entries = kind === 'item' ? receipt.items : receipt.stickers;
  const index = entries.findIndex((entry) => entry.id === button.dataset.id);
  if (index < 0) return;
  const action = button.dataset.action;
  if (action.endsWith('-remove')) {
    if (kind === 'item' && entries.length === 1) return;
    entries.splice(index, 1);
  } else {
    const other = index + (action.endsWith('-up') ? -1 : 1);
    if (other < 0 || other >= entries.length) return;
    [entries[index], entries[other]] = [entries[other], entries[index]];
  }
  if (kind === 'item') renderItems(); else renderStickers();
  changed();
});
$('add-item').addEventListener('click', () => {
  if (receipt.items.length >= 80) return;
  receipt.items.push({ id: newId(), name: '', amount: '0.00' });
  renderItems();
  changed();
  $('item-list').lastElementChild.querySelector('textarea').focus();
});
for (const button of document.querySelectorAll('[data-upload]')) button.addEventListener('click', () => {
  uploadTarget = button.dataset.upload;
  $('image-file').value = '';
  $('image-file').click();
});
for (const button of document.querySelectorAll('[data-remove-asset]')) button.addEventListener('click', () => {
  if (button.dataset.removeAsset === 'background') receipt.background.dataUrl = null;
  else receipt[button.dataset.removeAsset] = null;
  changed();
});
$('image-file').addEventListener('change', async () => {
  const file = $('image-file').files[0];
  const target = uploadTarget;
  if (!file || !target) return;
  const startRevision = revision;
  try {
    const dataUrl = await readImage(file);
    if (exportBusy) throw new Error('正在导出，请稍后重新添加图片');
    if (revision !== startRevision) throw new Error('读取期间设计已改变，请重新选择图片');
    const next = structuredClone(receipt);
    if (target === 'sticker') {
      if (next.stickers.length >= 30) throw new Error('贴纸最多 30 张');
      next.stickers.push({ id: newId(), dataUrl, x: 0.5, y: 0.5, width: 0.2, rotation: 0 });
    } else if (target === 'background') next.background.dataUrl = dataUrl;
    else next[target] = dataUrl;
    const normalized = validateReceipt(next);
    calculateReceipt(normalized);
    receipt = next;
    if (target === 'sticker') renderStickers();
    changed();
    report('图片已添加，正在更新小票');
  } catch (error) { report(`图片未添加：${errorMessage(error)}`, true); }
});
$('load-design').addEventListener('click', () => { $('design-file').value = ''; $('design-file').click(); });
$('design-file').addEventListener('change', async () => {
  const file = $('design-file').files[0];
  if (!file) return;
  const startRevision = revision;
  try {
    if (file.size > MAX_DESIGN) throw new Error('设计文件超过 66MB 上限');
    const normalized = validateReceipt(JSON.parse(await file.text()));
    calculateReceipt(normalized);
    await validateAllAssets(normalized);
    if (revision !== startRevision || exportBusy) throw new Error('读取期间当前设计发生变化，请重新选择文件');
    applyReceipt(normalized);
    report('设计已载入，正在生成完整预览');
  } catch (error) { report(`载入失败，当前设计未改变：${errorMessage(error)}`, true); }
});
$('save-design').addEventListener('click', () => {
  try {
    const normalized = validateReceipt(receipt);
    calculateReceipt(normalized);
    downloadBlob(new Blob([JSON.stringify(normalized, null, 2)], { type: 'application/json' }), safeFilename('json'));
    report('设计 JSON 下载已发起；请确认文件保存位置');
  } catch (error) { report(`设计无法保存：${errorMessage(error)}`, true); }
});
$('export-png').addEventListener('click', () => { void exportPng(); });
$('extract-button').addEventListener('click', () => { invalidateCandidate(); openDialog('extract-dialog'); });
$('order-text').addEventListener('input', invalidateCandidate);
$('fill-order-example').addEventListener('click', () => {
  if ($('order-text').value.trim()) {
    report('请先清空原始订单文字，再填入示例；已粘贴的内容不会被覆盖', true);
    return;
  }
  $('order-text').value = $('order-example-text').textContent;
  invalidateCandidate();
  $('order-text').focus();
});
$('parse-text').addEventListener('click', () => {
  invalidateCandidate();
  try {
    const text = $('order-text').value.trim();
    if (!text) throw new Error('请先粘贴真实订单文字');
    const result = parseOrderText(text, validateReceipt(receipt));
    result.receipt = validateReceipt(result.receipt);
    calculateReceipt(result.receipt);
    showCandidate(result);
    if (result.recognized <= 0) throw new Error('未识别到明确的订单字段；请手动填写，或补充字段标签与“元”单位');
    candidate = result.receipt;
    $('apply-candidate').disabled = false;
  } catch (error) {
    $('parse-error').textContent = errorMessage(error);
    $('parse-error').hidden = false;
  }
});
$('apply-candidate').addEventListener('click', () => {
  if (!candidate) return;
  applyReceipt(candidate);
  candidate = null;
  closeDialog('extract-dialog');
  report('已应用提取内容，请继续核对或编辑');
});
$('reset-receipt').addEventListener('click', () => openDialog('reset-dialog'));
$('confirm-reset').addEventListener('click', () => {
  applyReceipt(createDefaultReceipt());
  closeDialog('reset-dialog');
  report('已清空，准备输入新订单');
});
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
$('extract-dialog').addEventListener('close', () => { candidate = null; });
$('about-button').addEventListener('click', () => { void showAuthor(); });
$('notices-button').addEventListener('click', async () => {
  openDialog('notices-dialog');
  $('notices-content').textContent = '正在读取随软件打包的许可声明…';
  try {
    if (!bridge?.getNotices) throw new Error('浏览器开发预览未挂载桌面许可声明。正式桌面软件从本机安装包读取完整许可文件。');
    $('notices-content').textContent = await bridge.getNotices();
  } catch (error) { $('notices-content').textContent = errorMessage(error); }
});
window.addEventListener('beforeunload', (event) => {
  if (!initialized) return;
  if (exportBusy || revision !== persistedRevision) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function initialize() {
  document.querySelector('.editor-scroll').inert = true;
  $('load-design').disabled = true;
  $('save-design').disabled = true;
  refreshIcons();
  let restored = false;
  try {
    const draft = await loadDraft();
    if (draft) {
      const normalized = validateReceipt(draft.receipt);
      calculateReceipt(normalized);
      await validateAllAssets(normalized);
      receipt = normalized;
      restored = true;
      const date = new Date(draft.savedAt);
      saveStatus(`已恢复本机草稿${Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString('zh-CN', { hour12: false })}`}`);
    } else saveStatus('首次使用 · 还没有本机草稿');
  } catch (error) {
    saveStatus(`草稿未恢复：${errorMessage(error)}`, true);
    report('本机草稿未能恢复，保留原存储不覆盖；编辑后将保存新内容。', true);
  }
  bindFields();
  renderItems();
  renderStickers();
  initialized = true;
  document.querySelector('.editor-scroll').inert = false;
  $('load-design').disabled = false;
  changed({ persist: false });
  persistedRevision = revision;
  if (restored) $('preview-state').textContent = '正在恢复整张小票与图片…';
}
void initialize();
