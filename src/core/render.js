import { validateReceipt } from './model.js';
import { calculateReceipt } from './money.js';
import { RECEIPT_THEMES } from './themes.js';

const WIDTH = 1080;
const MAX_HEIGHT = 16000;
const LEFT = 112;
const RIGHT = WIDTH - LEFT;
const CONTENT = RIGHT - LEFT;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 24000000;

async function decodeImage(dataUrl, label) {
  const image = new Image();
  image.decoding = 'async';
  if (typeof image.decode === 'function') {
    image.src = dataUrl;
    try {
      await image.decode();
    } catch {
      throw new Error(`${label}：图片无法解码，请重新选择有效的 PNG、JPEG 或 WebP 图片`);
    }
  } else {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`${label}：图片无法解码，请重新选择图片`));
      image.src = dataUrl;
    });
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`${label}：图片每边须不超过 8192 像素，总像素须不超过 2400 万，请先缩小图片`);
  }
  return image;
}

function paperPath(ctx, shape, width, height) {
  ctx.beginPath();
  if (shape === 'arch') {
    ctx.moveTo(0, 150);
    ctx.bezierCurveTo(0, -50, width, -50, width, 150);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
  } else if (shape === 'tag') {
    ctx.moveTo(80, 0);
    ctx.lineTo(width - 80, 0);
    ctx.lineTo(width, 100);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.lineTo(0, 100);
  } else if (shape === 'chamfer') {
    ctx.moveTo(44, 0);
    ctx.lineTo(width - 44, 0);
    ctx.lineTo(width, 44);
    ctx.lineTo(width, height - 44);
    ctx.lineTo(width - 44, height);
    ctx.lineTo(44, height);
    ctx.lineTo(0, height - 44);
    ctx.lineTo(0, 44);
  } else if (shape === 'stamp') {
    const step = 36;
    const wave = (x1, y1, x2, y2, inwardX, inwardY) => {
      const distance = Math.hypot(x2 - x1, y2 - y1);
      const count = Math.ceil(distance / step);
      for (let index = 0; index < count; index += 1) {
        const start = index / count;
        const end = (index + 1) / count;
        ctx.quadraticCurveTo(x1 + (x2 - x1) * (start + end) / 2 + inwardX, y1 + (y2 - y1) * (start + end) / 2 + inwardY, x1 + (x2 - x1) * end, y1 + (y2 - y1) * end);
      }
    };
    ctx.moveTo(0, 0);
    wave(0, 0, width, 0, 0, 20);
    wave(width, 0, width, height, -20, 0);
    wave(width, height, 0, height, 0, -20);
    wave(0, height, 0, 0, 20, 0);
  } else if (shape === 'waist') {
    ctx.moveTo(0, 0);
    ctx.lineTo(width, 0);
    ctx.bezierCurveTo(width - 92, height * 0.3, width - 92, height * 0.7, width, height);
    ctx.lineTo(0, height);
    ctx.bezierCurveTo(92, height * 0.7, 92, height * 0.3, 0, 0);
  } else if (shape === 'notch') {
    const center = height * 0.42;
    ctx.moveTo(0, 0);
    ctx.lineTo(width, 0);
    ctx.lineTo(width, center - 30);
    ctx.arc(width, center, 30, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.lineTo(0, center + 30);
    ctx.arc(0, center, 30, Math.PI / 2, -Math.PI / 2, true);
  } else {
    ctx.rect(0, 0, width, height);
  }
  ctx.closePath();
}

function wrappedLines(ctx, value, width) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }) : null;
  const result = [];
  for (const paragraph of value.split('\n')) {
    if (paragraph === '') {
      result.push('');
      continue;
    }
    const glyphs = segmenter ? Array.from(segmenter.segment(paragraph), entry => entry.segment) : Array.from(paragraph);
    let line = '';
    for (const glyph of glyphs) {
      if (ctx.measureText(glyph).width > width) throw new Error('文字无法放入纸张，请缩短内容或更换字体');
      if (line && ctx.measureText(line + glyph).width > width) {
        result.push(line);
        line = glyph;
      } else {
        line += glyph;
      }
    }
    result.push(line);
  }
  return result;
}

function drawMotif(ctx, motif, accent, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  const ellipse = (cx, cy, rx, ry, rotation = 0) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();
  };
  const heart = () => {
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.bezierCurveTo(-27, -1, -15, -23, 0, -9);
    ctx.bezierCurveTo(15, -23, 27, -1, 0, 15);
    ctx.fill();
  };
  if (motif === 'tape') {
    ctx.rotate(-0.12);
    ctx.fillStyle = '#F6D984';
    ctx.fillRect(-44, -14, 88, 28);
    ctx.fillStyle = accent;
    for (const dot of [-22, 0, 22]) ellipse(dot, 0, 3, 3);
  } else if (motif === 'bow') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-39, -21);
    ctx.quadraticCurveTo(-50, 0, -39, 21);
    ctx.lineTo(0, 0);
    ctx.lineTo(39, -21);
    ctx.quadraticCurveTo(50, 0, 39, 21);
    ctx.closePath();
    ctx.fill();
    ellipse(0, 0, 8, 10);
  } else if (motif === 'strawberry') {
    ctx.beginPath();
    ctx.moveTo(0, 33);
    ctx.bezierCurveTo(-36, 8, -27, -23, 0, -13);
    ctx.bezierCurveTo(27, -23, 36, 8, 0, 33);
    ctx.fill();
    ctx.fillStyle = '#69957B';
    ctx.beginPath();
    ctx.moveTo(-20, -18);
    ctx.lineTo(-5, -15);
    ctx.lineTo(0, -31);
    ctx.lineTo(6, -15);
    ctx.lineTo(20, -18);
    ctx.lineTo(0, -5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFF8EE';
    for (const [cx, cy] of [[-10, 0], [10, 0], [-13, 12], [0, 9], [13, 12], [0, 23]]) ellipse(cx, cy, 2, 3);
  } else if (motif === 'mint') {
    ellipse(-10, -2, 12, 23, -0.55);
    ellipse(11, -4, 12, 23, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, 30);
    ctx.stroke();
    for (const cx of [-39, 39]) {
      ctx.beginPath();
      ctx.moveTo(cx, -11);
      ctx.lineTo(cx + 4, -4);
      ctx.lineTo(cx + 11, 0);
      ctx.lineTo(cx + 4, 4);
      ctx.lineTo(cx, 11);
      ctx.lineTo(cx - 4, 4);
      ctx.lineTo(cx - 11, 0);
      ctx.lineTo(cx - 4, -4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (motif === 'letter') {
    ctx.fillStyle = '#FFF8EE';
    ctx.beginPath();
    ctx.roundRect(-37, -24, 74, 48, 5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-35, -21);
    ctx.lineTo(0, 3);
    ctx.lineTo(35, -21);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.translate(0, 8);
    ctx.scale(0.6, 0.6);
    heart();
  } else if (motif === 'bear') {
    ellipse(-23, -20, 12, 12);
    ellipse(23, -20, 12, 12);
    ellipse(0, 3, 32, 28);
    ctx.fillStyle = '#FFF5E7';
    ellipse(0, 14, 13, 10);
    ctx.fillStyle = '#543F34';
    ellipse(-12, -1, 3, 4);
    ellipse(12, -1, 3, 4);
    ellipse(0, 11, 4, 3);
  } else if (motif === 'cherry') {
    ellipse(-17, 14, 16, 16);
    ellipse(18, 15, 16, 16);
    ctx.strokeStyle = '#69957B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-17, 1);
    ctx.quadraticCurveTo(-10, -17, 7, -29);
    ctx.quadraticCurveTo(23, -12, 18, 1);
    ctx.stroke();
    ctx.fillStyle = '#69957B';
    ellipse(16, -23, 13, 6, -0.4);
    ctx.fillStyle = '#FFF8EE';
    ellipse(-22, 8, 3, 4, 0.4);
    ellipse(13, 9, 3, 4, 0.4);
  } else if (motif === 'lemon') {
    ellipse(0, 0, 31, 31);
    ctx.fillStyle = '#FFF7BF';
    ellipse(0, 0, 25, 25);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 5, Math.sin(angle) * 5);
      ctx.lineTo(Math.cos(angle) * 22, Math.sin(angle) * 22);
      ctx.stroke();
    }
    ctx.fillStyle = accent;
    for (const [cx, cy] of [[-44, -8], [42, 15]]) ellipse(cx, cy, 4, 4);
  } else if (motif === 'cloud') {
    ellipse(-23, 9, 17, 14);
    ellipse(-7, -3, 22, 21);
    ellipse(18, 1, 18, 17);
    ellipse(27, 12, 15, 11);
    ctx.fillRect(-24, 7, 52, 17);
    ctx.fillStyle = '#FFFDF8';
    ellipse(-12, -7, 9, 4, -0.35);
    ctx.fillStyle = accent;
    for (const cx of [-46, 48]) ellipse(cx, -15, 3, 3);
  } else if (motif === 'flower') {
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3;
      ellipse(Math.cos(angle) * 18, Math.sin(angle) * 18, 13, 10, angle);
    }
    ctx.fillStyle = '#F6D984';
    ellipse(0, 0, 10, 10);
  }
  ctx.restore();
}

export async function renderReceipt(canvas, value) {
  const receipt = validateReceipt(value);
  const totals = calculateReceipt(receipt);
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('预览画布不可用，请重新打开应用');
  const jobs = [];
  if (receipt.logo) jobs.push(['logo', receipt.logo, '顶部图片']);
  if (receipt.footerImage) jobs.push(['footer', receipt.footerImage, '底部图片']);
  if (receipt.background.dataUrl) jobs.push(['background', receipt.background.dataUrl, '背景图片']);
  receipt.stickers.forEach((sticker, index) => jobs.push([`sticker-${index}`, sticker.dataUrl, `贴纸 ${index + 1}`]));
  const decoded = new Map(await Promise.all(jobs.map(async ([key, dataUrl, label]) => [key, await decodeImage(dataUrl, label)])));
  const document = canvas.ownerDocument ?? globalThis.document;
  const surface = document?.createElement('canvas') ?? (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(WIDTH, 1) : null);
  if (!surface) throw new Error('无法创建完整图片画布，请在桌面应用中重试');
  const ctx = surface.getContext('2d');
  if (!ctx) throw new Error('无法取得图片绘制上下文，请重新打开应用');
  const motif = RECEIPT_THEMES[receipt.theme].motif;
  const ink = '#362B2A';
  const accent = receipt.accentColor;
  const secondary = '#5C514C';
  const commands = [];
  let y = receipt.shape === 'arch' ? 180 : 100;
  const font = (size, weight = '400') => `${weight} ${size}px "${receipt.font}"`;
  const text = (value, { size = 38, weight = '500', color = ink, x = LEFT, width = CONTENT, lineHeight = Math.ceil(size * 1.5), align = 'left', gap = 0 } = {}) => {
    ctx.font = font(size, weight);
    const lines = wrappedLines(ctx, value, width);
    const top = y;
    commands.push(context => {
      context.font = font(size, weight);
      context.fillStyle = color;
      context.textAlign = align;
      context.textBaseline = 'top';
      lines.forEach((line, index) => context.fillText(line, align === 'right' ? x + width : align === 'center' ? x + width / 2 : x, top + index * lineHeight));
    });
    y += lines.length * lineHeight + gap;
  };
  const separator = (gap = 28) => {
    const top = y + gap / 2;
    commands.push(context => {
      context.save();
      context.strokeStyle = accent;
      context.lineWidth = 2;
      context.setLineDash([8, 9]);
      context.beginPath();
      context.moveTo(LEFT, top);
      context.lineTo(RIGHT, top);
      context.stroke();
      context.restore();
    });
    y += gap;
  };
  const assetBlock = (key, maxHeight, gap) => {
    const image = decoded.get(key);
    if (!image) return;
    const scale = Math.min(CONTENT / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const top = y;
    commands.push(context => context.drawImage(image, LEFT + (CONTENT - width) / 2, top, width, height));
    y += height + gap;
  };
  const decorationTop = y + 24;
  commands.push(context => {
    drawMotif(context, motif, accent, LEFT + 45, decorationTop);
    drawMotif(context, motif, accent, RIGHT - 45, decorationTop);
  });
  y += 88;
  assetBlock('logo', 300, 30);
  if (receipt.title) text(receipt.title, { size: 60, weight: '700', gap: 12 });
  if (receipt.subtitle) text(receipt.subtitle, { size: 34, color: secondary, gap: 16 });
  separator(38);
  const fields = [
    ['开始时间', receipt.startedAt.replace('T', ' ')],
    ['结单时间', receipt.issuedAt.replace('T', ' ')],
    [receipt.fieldLabels.bossId, receipt.bossId],
    [receipt.fieldLabels.accountNumber, receipt.accountNumber],
    [receipt.fieldLabels.game, receipt.game],
    [receipt.fieldLabels.dispatcher, receipt.dispatcher],
    ['支付方式', receipt.paymentMethod],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    text(label, { size: 30, color: secondary, gap: 2 });
    text(value, { size: 38, gap: 16 });
  }
  separator(36);
  const headerTop = y;
  commands.push(context => {
    context.font = font(30, '700');
    context.fillStyle = secondary;
    context.textBaseline = 'top';
    context.textAlign = 'left';
    context.fillText('项目明细', LEFT, headerTop);
    context.textAlign = 'right';
    context.fillText('金额（元）', RIGHT, headerTop);
  });
  y += 56;
  for (const item of receipt.items) {
    const top = y;
    text(item.name, { size: 38, width: 570, gap: 16 });
    commands.push(context => {
      context.font = font(38, '500');
      context.fillStyle = ink;
      context.textAlign = 'right';
      context.textBaseline = 'top';
      context.fillText(item.amount, RIGHT, top);
    });
  }
  separator(36);
  const summary = (label, amount, negative = false) => {
    const top = y;
    commands.push(context => {
      context.font = font(36, '500');
      context.fillStyle = ink;
      context.textBaseline = 'top';
      context.textAlign = 'left';
      context.fillText(label, LEFT, top);
      context.textAlign = 'right';
      context.fillText(`${negative ? '−' : ''}${amount}`, RIGHT, top);
    });
    y += 56;
  };
  summary('项目合计', totals.subtotal);
  if (receipt.fees.rushEnabled) summary(`加急费（原价 × ${receipt.fees.rushMultiplier}）`, totals.rush);
  if (receipt.fees.discountEnabled) summary(`折扣减免（${receipt.fees.discountRate} 折）`, totals.discount, true);
  if (totals.coupon !== '0.00') summary('优惠减免', totals.coupon, true);
  y += 16;
  const totalTop = y;
  ctx.font = font(58, '700');
  if (ctx.measureText(`¥ ${totals.total}`).width > CONTENT - 180) throw new Error('合计金额太长，无法完整显示，请减少项目金额或拆分小票');
  commands.push(context => {
    context.save();
    context.globalAlpha = 0.12;
    context.fillStyle = accent;
    context.fillRect(LEFT - 20, totalTop - 12, CONTENT + 40, 94);
    context.restore();
    context.fillStyle = ink;
    context.textBaseline = 'top';
    context.textAlign = 'left';
    context.font = font(38, '700');
    context.fillText('应付合计', LEFT, totalTop + 12);
    context.textAlign = 'right';
    context.font = font(58, '700');
    context.fillText(`¥ ${totals.total}`, RIGHT, totalTop);
  });
  y += 112;
  text(totals.formula, { size: 28, color: secondary, gap: 28 });
  if (receipt.showNote && receipt.note) {
    separator(30);
    text('备注', { size: 32, weight: '700', gap: 8 });
    text(receipt.note, { size: 36, gap: 24 });
  }
  if (receipt.footer || decoded.has('footer')) separator(34);
  if (receipt.footer) text(receipt.footer, { size: 34, color: secondary, gap: 24 });
  assetBlock('footer', 500, 24);
  const height = Math.ceil(Math.max(1000, y + 100));
  if (height > MAX_HEIGHT) throw new Error(`小票完整高度为 ${height} 像素，超过 16000 像素上限。请减少项目或备注内容后再导出；未生成截断图片`);
  surface.width = WIDTH;
  surface.height = height;
  ctx.clearRect(0, 0, WIDTH, height);
  ctx.save();
  paperPath(ctx, receipt.shape, WIDTH, height);
  ctx.fillStyle = receipt.paperColor;
  ctx.fill();
  ctx.clip();
  const background = decoded.get('background');
  if (background) {
    const scale = Math.max(WIDTH / background.naturalWidth, height / background.naturalHeight) * receipt.background.scale;
    const width = background.naturalWidth * scale;
    const backgroundHeight = background.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha = receipt.background.opacity;
    ctx.drawImage(background, (WIDTH - width) / 2 + receipt.background.offsetX * WIDTH, (height - backgroundHeight) / 2 + receipt.background.offsetY * height, width, backgroundHeight);
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(86, 76, WIDTH - 172, height - 152, 22);
  ctx.stroke();
  ctx.restore();
  for (const command of commands) command(ctx);
  drawMotif(ctx, motif, accent, WIDTH / 2, height - 48, 0.55);
  receipt.stickers.forEach((sticker, index) => {
    if (!sticker.width) return;
    const image = decoded.get(`sticker-${index}`);
    const width = sticker.width * WIDTH;
    const stickerHeight = width * image.naturalHeight / image.naturalWidth;
    ctx.save();
    ctx.translate(sticker.x * WIDTH, sticker.y * height);
    ctx.rotate(sticker.rotation * Math.PI / 180);
    ctx.drawImage(image, -width / 2, -stickerHeight / 2, width, stickerHeight);
    ctx.restore();
  });
  ctx.restore();
  const target = canvas.getContext('2d');
  if (!target) throw new Error('预览画布不可用，图片未更新');
  canvas.width = WIDTH;
  canvas.height = height;
  target.drawImage(surface, 0, 0);
  return { width: WIDTH, height };
}
