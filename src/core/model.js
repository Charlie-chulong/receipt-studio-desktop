import Big from 'big.js';
import { RECEIPT_THEME_IDS } from './themes.js';

const MAX_IMAGE_LENGTH = 12 * 1024 * 1024;
const MAX_ASSET_LENGTH = 64 * 1024 * 1024;
const SHORT_FIELDS = ['title', 'subtitle', 'issuedAt', 'bossId', 'accountNumber', 'game', 'dispatcher', 'paymentMethod', 'footer'];
const DEFAULT_FIELD_LABELS = Object.freeze({ bossId: '老板 / 客户', accountNumber: '账户 / 编号', game: '游戏 / 服务', dispatcher: '派单客服' });

function fail(field, detail) {
  throw new Error(`${field}：${detail}`);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, '必须为对象');
  return value;
}

function text(value, field, max = 200) {
  if (typeof value !== 'string') fail(field, '必须为文本');
  const normalized = value.replace(/\r\n?/g, '\n');
  if (Array.from(normalized).length > max) fail(field, `最多 ${max} 个字符，请缩短后重试`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) fail(field, '不能包含控制字符');
  return normalized;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(field, '必须为 true 或 false');
  return value;
}

function number(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(field, `必须为 ${min} 到 ${max} 之间的有限数值`);
  return value;
}

function decimal(value, field, places, min, max, fixed = false) {
  if (typeof value !== 'string' || !new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`).test(value) || value.length > 24) {
    fail(field, `请输入非负十进制文本，最多 ${places} 位小数（不接受指数、符号或空格）`);
  }
  const parsed = new Big(value);
  if (parsed.lt(min) || parsed.gt(max)) fail(field, `必须在 ${min} 到 ${max} 之间`);
  return fixed ? parsed.toFixed(2) : parsed.toString();
}

function enumeration(value, field, allowed) {
  if (!allowed.includes(value)) fail(field, `仅支持 ${allowed.join(' / ')}`);
  return value;
}

function color(value, field) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(field, '请输入 #RRGGBB 格式颜色');
  return value.toUpperCase();
}

function image(value, field, assets, nullable = true) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_LENGTH) fail(field, '图片须为本地图片数据，单张不能超过 12 MiB');
  const prefix = /^data:image\/(?:png|jpeg|webp);base64,/.exec(value);
  const payload = prefix ? value.slice(prefix[0].length) : '';
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    fail(field, '仅接受完整的 PNG、JPEG、WebP base64 图片，不接受网址或 SVG');
  }
  assets.total += value.length;
  if (assets.total > MAX_ASSET_LENGTH) fail('图片素材', '总大小不能超过 64 MiB，请减少或压缩素材');
  return value;
}

function identifier(value, field, seen) {
  const id = text(value, field, 100);
  if (!id.trim()) fail(field, '不能为空');
  if (seen.has(id)) fail(field, '标识重复，请为每个条目使用不同标识');
  seen.add(id);
  return id;
}

function datetime(value, label) {
  if (value === '') return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) fail(label, '请输入有效的本地日期时间 YYYY-MM-DDTHH:mm');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (Number(year) < 1 || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) {
    fail(label, '日期或时间不存在，请重新选择');
  }
  return value;
}

export function createDefaultReceipt() {
  return {
    version: 1,
    title: '结单小票', subtitle: '', startedAt: '', issuedAt: '', bossId: '', accountNumber: '', game: '', dispatcher: '', paymentMethod: '',
    fieldLabels: { ...DEFAULT_FIELD_LABELS },
    note: '', footer: '', showNote: true,
    theme: 'cute', shape: 'default', font: 'Microsoft YaHei', paperColor: '#FFF8EE', accentColor: '#E788A3',
    logo: null, footerImage: null,
    background: { dataUrl: null, scale: 1, opacity: 0.15, offsetX: 0, offsetY: 0 },
    stickers: [], items: [{ id: 'item-1', name: '', amount: '0.00' }],
    fees: { rushEnabled: false, rushMultiplier: '1.2', discountEnabled: false, discountRate: '10', discountBeforeRush: false, couponAmount: '0.00', couponBeforeDiscount: false },
  };
}

export function validateReceipt(value) {
  const source = object(value, '小票');
  if (source.version !== 1) fail('版本', '仅支持版本 1 的小票设计');
  const receipt = { version: 1 };
  for (const field of SHORT_FIELDS) receipt[field] = text(source[field], field);
  receipt.startedAt = datetime(text(source.startedAt === undefined ? '' : source.startedAt, '开始时间'), '开始时间');
  receipt.issuedAt = datetime(receipt.issuedAt, '结单时间');
  const labels = source.fieldLabels === undefined ? DEFAULT_FIELD_LABELS : object(source.fieldLabels, '字段名称');
  receipt.fieldLabels = {};
  for (const [field, label] of Object.entries(DEFAULT_FIELD_LABELS)) {
    const name = text(labels[field], `${label}字段名称`, 40).trim();
    if (!name) fail(`${label}字段名称`, '不能为空');
    receipt.fieldLabels[field] = name;
  }
  receipt.note = text(source.note, '备注', 4000);
  receipt.showNote = boolean(source.showNote, '显示备注');
  receipt.theme = enumeration(source.theme, '主题', RECEIPT_THEME_IDS);
  receipt.shape = enumeration(source.shape, '纸张形状', ['default', 'notch', 'tag', 'waist', 'arch', 'stamp', 'chamfer']);
  receipt.font = enumeration(source.font, '字体', ['Microsoft YaHei', 'SimSun', 'KaiTi']);
  receipt.paperColor = color(source.paperColor, '纸张颜色');
  receipt.accentColor = color(source.accentColor, '强调颜色');
  const assets = { total: 0 };
  receipt.logo = image(source.logo, '顶部图片', assets);
  receipt.footerImage = image(source.footerImage, '底部图片', assets);
  const background = object(source.background, '背景');
  receipt.background = {
    dataUrl: image(background.dataUrl, '背景图片', assets),
    scale: number(background.scale, '背景缩放', 0.25, 3),
    opacity: number(background.opacity, '背景透明度', 0, 1),
    offsetX: number(background.offsetX, '背景横向偏移', -1, 1),
    offsetY: number(background.offsetY, '背景纵向偏移', -1, 1),
  };
  if (!Array.isArray(source.stickers) || source.stickers.length > 30) fail('贴纸', '须为数组，最多 30 张');
  const stickerIds = new Set();
  receipt.stickers = source.stickers.map((entry, index) => {
    const sticker = object(entry, `贴纸 ${index + 1}`);
    return {
      id: identifier(sticker.id, `贴纸 ${index + 1} 标识`, stickerIds),
      dataUrl: image(sticker.dataUrl, `贴纸 ${index + 1}`, assets, false),
      x: number(sticker.x, `贴纸 ${index + 1} 横坐标`, 0, 1),
      y: number(sticker.y, `贴纸 ${index + 1} 纵坐标`, 0, 1),
      width: number(sticker.width, `贴纸 ${index + 1} 宽度`, 0, 1),
      rotation: number(sticker.rotation, `贴纸 ${index + 1} 旋转角度`, -Number.MAX_VALUE, Number.MAX_VALUE) % 360,
    };
  });
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 80) fail('项目', '须包含 1 到 80 个项目');
  const itemIds = new Set();
  receipt.items = source.items.map((entry, index) => {
    const item = object(entry, `项目 ${index + 1}`);
    return {
      id: identifier(item.id, `项目 ${index + 1} 标识`, itemIds),
      name: text(item.name, `项目 ${index + 1} 名称`, 400),
      amount: decimal(item.amount, `项目 ${index + 1} 金额`, 2, '0', '999999999.99', true),
    };
  });
  const fees = object(source.fees, '费用设置');
  receipt.fees = {
    rushEnabled: boolean(fees.rushEnabled, '加急开关'),
    rushMultiplier: decimal(fees.rushMultiplier, '加急倍率', 4, '1', '100'),
    discountEnabled: boolean(fees.discountEnabled, '折扣开关'),
    discountRate: decimal(fees.discountRate, '折扣', 2, '0', '10'),
    discountBeforeRush: boolean(fees.discountBeforeRush, '折扣与加急顺序'),
    couponAmount: decimal(fees.couponAmount, '优惠金额', 2, '0', '999999999.99', true),
    couponBeforeDiscount: boolean(fees.couponBeforeDiscount, '优惠与折扣顺序'),
  };
  return receipt;
}
