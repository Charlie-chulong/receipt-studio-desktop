import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultReceipt, validateReceipt } from '../src/core/model.js';
import { applyReceiptTheme, RECEIPT_THEME_IDS } from '../src/core/themes.js';
import { calculateReceipt } from '../src/core/money.js';
import { parseOrderText } from '../src/core/parser.js';

function order(amounts = ['100.00'], feeChanges = {}) {
  const receipt = createDefaultReceipt();
  receipt.items = amounts.map((amount, index) => ({ id: `item-${index + 1}`, name: `服务 ${index + 1}`, amount }));
  Object.assign(receipt.fees, feeChanges);
  return receipt;
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=';

test('blank receipt contains no invented purchases or identity and defaults are independent', () => {
  const blank = createDefaultReceipt();
  assert.equal(blank.title, '结单小票');
  assert.deepEqual(blank.items, [{ id: 'item-1', name: '', amount: '0.00' }]);
  for (const field of ['subtitle', 'startedAt', 'issuedAt', 'bossId', 'accountNumber', 'game', 'dispatcher', 'paymentMethod', 'note', 'footer']) assert.equal(blank[field], '');
  assert.equal(calculateReceipt(blank).total, '0.00');
  blank.items[0].name = '修改';
  blank.background.scale = 2;
  assert.equal(createDefaultReceipt().items[0].name, '');
  assert.equal(createDefaultReceipt().background.scale, 1);
});

test('screenshot order parses into editable candidate and computes 216.00 without multiplying hours', () => {
  const original = createDefaultReceipt();
  original.footer = '原有页脚';
  const before = structuredClone(original);
  const result = parseOrderText('老板：小葵\n三角洲护航 2小时168元\n指定陪玩 晚间档66元\n优惠18元\n微信支付', original);
  assert.equal(result.recognized, 5);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.receipt.bossId, '小葵');
  assert.equal(result.receipt.paymentMethod, '微信支付');
  assert.equal(result.receipt.footer, '原有页脚');
  assert.deepEqual(result.receipt.items.map(item => [item.name, item.amount]), [['三角洲护航 2小时', '168.00'], ['指定陪玩 晚间档', '66.00']]);
  assert.equal(result.receipt.fees.couponAmount, '18.00');
  assert.equal(calculateReceipt(result.receipt).subtotal, '234.00');
  assert.equal(calculateReceipt(result.receipt).total, '216.00');
  result.receipt.items[0].name = '手工确认';
  result.receipt.background.scale = 2;
  assert.deepEqual(original, before);
});

test('rush is always based on original subtotal; before/after rush discount gives 70 and 60', () => {
  const receipt = order(['100'], { rushEnabled: true, rushMultiplier: '1.2', discountEnabled: true, discountRate: '5', discountBeforeRush: true });
  const before = calculateReceipt(receipt);
  assert.equal(before.subtotal, '100.00');
  assert.equal(before.rush, '20.00');
  assert.equal(before.discount, '50.00');
  assert.equal(before.total, '70.00');
  assert.match(before.formula, /加急费不打折/);
  receipt.fees.discountBeforeRush = false;
  const after = calculateReceipt(receipt);
  assert.equal(after.rush, '20.00');
  assert.equal(after.discount, '60.00');
  assert.equal(after.total, '60.00');
});

test('all four coupon/discount/rush precedence combinations have exact consumer amounts', () => {
  for (const [discountBeforeRush, couponBeforeDiscount, total, discount] of [
    [true, true, '65.00', '45.00'], [true, false, '60.00', '50.00'],
    [false, true, '55.00', '55.00'], [false, false, '50.00', '60.00'],
  ]) {
    const result = calculateReceipt(order(['100'], { rushEnabled: true, rushMultiplier: '1.2', discountEnabled: true, discountRate: '5', couponAmount: '10', discountBeforeRush, couponBeforeDiscount }));
    assert.equal(result.total, total);
    assert.equal(result.discount, discount);
    assert.equal(result.coupon, '10.00');
    assert.equal(result.rush, '20.00');
    assert.match(result.formula, couponBeforeDiscount ? /先减优惠/ : /最后减优惠/);
  }
});

test('half-up applies to payable discounted cents and original-base rush independently', () => {
  const discounted = calculateReceipt(order(['0.05'], { discountEnabled: true, discountRate: '5' }));
  assert.equal(discounted.total, '0.03');
  assert.equal(discounted.discount, '0.02');
  const rushed = calculateReceipt(order(['0.05'], { rushEnabled: true, rushMultiplier: '1.1' }));
  assert.equal(rushed.rush, '0.01');
  assert.equal(rushed.total, '0.06');
  assert.equal(calculateReceipt(order(['0.1', '0.2'])).total, '0.30');
});

test('no coupon clamping: applicable base is validated for both orders', () => {
  assert.throws(() => calculateReceipt(order(['100'], { couponAmount: '100.01' })), /优惠金额.*不能超过/);
  assert.throws(() => calculateReceipt(order(['100'], { discountEnabled: true, discountRate: '5', couponAmount: '50.01' })), /折扣后优惠/);
  assert.throws(() => calculateReceipt(order(['100'], { rushEnabled: true, rushMultiplier: '1.2', discountBeforeRush: true, couponBeforeDiscount: true, couponAmount: '100.01' })), /折扣前优惠/);
  assert.equal(calculateReceipt(order(['100'], { couponAmount: '100' })).total, '0.00');
  assert.equal(calculateReceipt(order(['100'], { discountEnabled: true, discountRate: '0' })).total, '0.00');
  assert.equal(calculateReceipt(order(['100'], { discountEnabled: true, discountRate: '0', couponBeforeDiscount: true, couponAmount: '100' })).total, '0.00');
});

test('disabled fee switches do not apply configured multipliers or discount rates', () => {
  const result = calculateReceipt(order(['168', '66'], { rushMultiplier: '100', discountRate: '0', couponAmount: '18' }));
  assert.equal(result.total, '216.00');
  assert.equal(result.rush, '0.00');
  assert.equal(result.discount, '0.00');
});

test('large exact sums stay exact without JS float money math', () => {
  const receipt = order(Array(80).fill('999999999.99'), { rushEnabled: true, rushMultiplier: '100' });
  const result = calculateReceipt(receipt);
  assert.equal(result.subtotal, '79999999999.20');
  assert.equal(result.rush, '7919999999920.80');
  assert.equal(result.total, '7999999999920.00');
});

test('import validation clones, normalizes money/colors/newlines and preserves literal text', () => {
  const receipt = order(['1.2']);
  receipt.title = '<script>alert(1)</script>';
  receipt.note = '第一行\r\n第二行';
  receipt.paperColor = '#fff8ee';
  receipt.logo = png;
  receipt.stickers = [{ id: 'sticker-1', dataUrl: png, x: 0, y: 1, width: 0.5, rotation: 360 }];
  const before = structuredClone(receipt);
  const imported = validateReceipt(JSON.parse(JSON.stringify(receipt)));
  assert.equal(imported.items[0].amount, '1.20');
  assert.equal(imported.paperColor, '#FFF8EE');
  assert.equal(imported.note, '第一行\n第二行');
  assert.equal(imported.title, '<script>alert(1)</script>');
  imported.items[0].name = '改名';
  imported.stickers[0].x = 1;
  assert.deepEqual(receipt, before);
});

test('changing themes preserves orders, fees and images, and saved custom styles survive import', () => {
  const receipt = order(['168.00', '66.00'], { couponAmount: '18.00' });
  receipt.bossId = '已填写的客户';
  receipt.logo = png;
  receipt.background.dataUrl = png;
  receipt.stickers = [{ id: 'sticker', dataUrl: png, x: 0.2, y: 0.8, width: 0.1, rotation: 15 }];
  const business = { bossId: receipt.bossId, items: structuredClone(receipt.items), fees: structuredClone(receipt.fees), logo: receipt.logo, background: structuredClone(receipt.background), stickers: structuredClone(receipt.stickers) };
  for (const id of RECEIPT_THEME_IDS) {
    applyReceiptTheme(receipt, id);
    receipt.accentColor = '#915B67';
    receipt.shape = 'waist';
    const restored = validateReceipt(JSON.parse(JSON.stringify(receipt)));
    assert.equal(restored.theme, id);
    assert.equal(restored.accentColor, '#915B67');
    assert.equal(restored.shape, 'waist');
    assert.deepEqual({ bossId: restored.bossId, items: restored.items, fees: restored.fees, logo: restored.logo, background: restored.background, stickers: restored.stickers }, business);
    assert.equal(calculateReceipt(restored).total, '216.00');
  }
  const before = structuredClone(receipt);
  assert.throws(() => applyReceiptTheme(receipt, '__proto__'), /有效/);
  assert.deepEqual(receipt, before);
});

test('strict decimal import rejects exponent, negatives, whitespace, precision and overflow', () => {
  for (const value of ['-1', '+1', '1e2', ' 1', '1 ', '01', '.5', '1.', '0.001', '1000000000', '', 1, null]) {
    const receipt = order();
    receipt.items[0].amount = value;
    assert.throws(() => validateReceipt(receipt), /金额/);
  }
  for (const changes of [
    { couponAmount: '-0.01' }, { couponAmount: '1000000000' },
    { rushMultiplier: '0.99' }, { rushMultiplier: '100.0001' }, { rushMultiplier: '1.00001' },
    { discountRate: '10.01' }, { discountRate: '1.001' }, { discountRate: 'NaN' },
  ]) assert.throws(() => validateReceipt(order(['100'], changes)), /优惠金额|加急倍率|折扣/);
  assert.equal(validateReceipt(order(['999999999.99'], { rushMultiplier: '100', discountRate: '10.00' })).fees.discountRate, '10');
});

test('required structure, supported options, counts and text limits reject invalid imports', () => {
  for (const change of [
    { version: 2 }, { version: '1' }, { theme: 'remote' }, { shape: 'oval' }, { font: 'RemoteFont' },
    { paperColor: '#fff' }, { showNote: 'true' }, { title: '字'.repeat(201) }, { note: '字'.repeat(4001) },
    { items: [] }, { items: Array.from({ length: 81 }, (_, index) => ({ id: `i${index}`, name: '', amount: '0' })) },
    { items: [{ id: 'same', name: '', amount: '0' }, { id: 'same', name: '', amount: '0' }] },
    { items: [{ id: 'i', name: '字'.repeat(401), amount: '0' }] },
    { stickers: Array(31).fill({}) }, { title: 'a\u0000b' },
  ]) assert.throws(() => validateReceipt({ ...createDefaultReceipt(), ...change }), Error);
  const missing = createDefaultReceipt();
  delete missing.fees;
  assert.throws(() => validateReceipt(missing), /费用设置/);
  const boundary = order(Array(80).fill('0'));
  boundary.note = '字'.repeat(4000);
  boundary.items[0].name = '𠀀'.repeat(400);
  assert.equal(validateReceipt(boundary).items.length, 80);
  for (const shape of ['default', 'notch', 'tag', 'waist', 'arch', 'stamp', 'chamfer']) assert.equal(validateReceipt({ ...boundary, shape }).shape, shape);
});

test('local datetime validation handles leap years and rejects normalized invalid dates', () => {
  for (const field of ['startedAt', 'issuedAt']) {
    for (const value of ['2025-02-29T12:00', '2026-04-31T12:00', '2026-13-01T12:00', '2026-01-01T24:00', '2026-01-01T12:60', '2026-01-01', '2026-01-01T12:00Z']) {
      assert.throws(() => validateReceipt({ ...createDefaultReceipt(), [field]: value }));
    }
    assert.equal(validateReceipt({ ...createDefaultReceipt(), [field]: '2024-02-29T12:00' })[field], '2024-02-29T12:00');
    assert.equal(validateReceipt({ ...createDefaultReceipt(), [field]: '2026-03-08T02:30' })[field], '2026-03-08T02:30');
  }
});

test('import rejects remote, SVG, unsupported and malformed image encodings', () => {
  for (const value of ['https://example.com/logo.png', 'file:///logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,AAAA', 'data:image/png;base64,???', 'data:image/png;base64,', 'data:image/png;base64,AAA']) {
    assert.throws(() => validateReceipt({ ...createDefaultReceipt(), logo: value }), /顶部图片/);
  }
  const oversized = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`;
  assert.throws(() => validateReceipt({ ...createDefaultReceipt(), footerImage: oversized }), /12 MiB/);
  for (const change of [{ scale: 0.24 }, { scale: 3.01 }, { opacity: -0.01 }, { opacity: 1.01 }, { offsetX: Infinity }, { offsetY: -1.01 }]) {
    const receipt = createDefaultReceipt();
    Object.assign(receipt.background, change);
    assert.throws(() => validateReceipt(receipt), /背景/);
  }
  const receipt = createDefaultReceipt();
  receipt.stickers = [{ id: 's1', dataUrl: png, x: 0.5, y: 0.5, width: 0.2, rotation: 0 }];
  for (const change of [{ x: 1.01 }, { y: NaN }, { width: -0.1 }, { rotation: Infinity }, { dataUrl: null }]) {
    assert.throws(() => validateReceipt({ ...receipt, stickers: [{ ...receipt.stickers[0], ...change }] }), /贴纸/);
  }
  assert.equal(validateReceipt({ ...receipt, stickers: [{ ...receipt.stickers[0], rotation: 721 }] }).stickers[0].rotation, 1);
});

test('parser extracts explicit metadata and currency totals but not account IDs or dates', () => {
  const result = parseOrderText('客户：阿青\n派单客服：小林\n账户：16866\n游戏：三角洲\n支付方式：支付宝\n项目：护航 2小时 ¥168\n2026-10-12\n订单号：666\n总计168元', createDefaultReceipt());
  assert.equal(result.recognized, 6);
  assert.equal(result.receipt.accountNumber, '16866');
  assert.equal(result.receipt.dispatcher, '小林');
  assert.equal(result.receipt.game, '三角洲');
  assert.equal(result.receipt.items.length, 1);
  assert.equal(result.receipt.items[0].amount, '168.00');
  assert.equal(result.warnings.length, 3);
});

test('ambiguity warns, never multiplies unit prices, never invents paid status, retains existing items', () => {
  const current = order(['99']);
  const result = parseOrderText('每小时陪玩50元\n护航 单价50元\n押金50元 服务100元\n优惠5折\n已支付100元\n三角洲 2小时\n老板：甲\n老板：乙', current);
  assert.equal(result.recognized, 1);
  assert.equal(result.receipt.bossId, '甲');
  assert.deepEqual(result.receipt.items, validateReceipt(current).items);
  assert.equal(result.receipt.paymentMethod, '');
  assert.equal(result.receipt.fees.couponAmount, '0.00');
  assert.equal(result.warnings.length, 7);
  assert.match(result.warnings.at(-1), /重复/);
});

test('payment and refund facts at different stages never become service charges', () => {
  const result = parseOrderText('已支付100元\n未付款50元\n待付款66元\n已经到账168元\n尚未收款200元\n退款10元\n陪玩100元', createDefaultReceipt());
  assert.deepEqual(result.receipt.items.map(({ name, amount }) => ({ name, amount })), [{ name: '陪玩', amount: '100.00' }]);
  assert.equal(calculateReceipt(result.receipt).total, '100.00');
  assert.equal(result.receipt.paymentMethod, '');
});

test('parser duplicates do not silently sum coupons or replace first payment method', () => {
  const result = parseOrderText('优惠10元\n减免20元\n现金\n微信支付', order(['100']));
  assert.equal(result.recognized, 2);
  assert.equal(result.receipt.fees.couponAmount, '10.00');
  assert.equal(result.receipt.paymentMethod, '现金');
  assert.equal(result.warnings.length, 2);
  assert.equal(calculateReceipt(result.receipt).total, '90.00');
});

test('invalid extracted amounts and names warn instead of corrupting editable candidate', () => {
  const original = order(['10']);
  const result = parseOrderText(`护航1000000000元\n${'字'.repeat(401)}20元\n优惠999999999.99元`, original);
  assert.equal(result.recognized, 1);
  assert.deepEqual(result.receipt.items, validateReceipt(original).items);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings.at(-1), /费用需要确认/);
  assert.equal(original.fees.couponAmount, '0.00');
  assert.throws(() => parseOrderText('a'.repeat(20001), original), /20000/);
  assert.throws(() => parseOrderText('\n'.repeat(200), original), /200 行/);
});

test('parser never extracts a valid-looking suffix from malformed decimal prices', () => {
  for (const line of ['护航001元', '护航-1元', '护航- 1元', '护航+1元', '护航0.001元', '护航1e2元', '护航 ¥1.001元']) {
    const original = order(['10']);
    const result = parseOrderText(line, original);
    assert.equal(result.recognized, 0, line);
    assert.deepEqual(result.receipt.items, validateReceipt(original).items, line);
    assert.ok(result.warnings.length > 0, line);
  }
});

test('design imports retain custom names and both times without inventing a start for older designs', () => {
  const legacy = order(['168.00', '66.00'], { couponAmount: '18.00' });
  legacy.issuedAt = '2026-10-13T14:43';
  delete legacy.startedAt;
  delete legacy.fieldLabels;
  const restored = validateReceipt(JSON.parse(JSON.stringify(legacy)));
  assert.equal(restored.startedAt, '');
  assert.equal(restored.issuedAt, legacy.issuedAt);
  assert.deepEqual(restored.items, legacy.items);
  assert.equal(calculateReceipt(restored).total, '216.00');
  restored.startedAt = '2026-10-13T12:43';
  restored.fieldLabels = { bossId: '客户昵称', accountNumber: '订单编号', game: '服务内容', dispatcher: '接待人员' };
  const imported = validateReceipt(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(imported.fieldLabels, restored.fieldLabels);
  assert.equal(imported.startedAt, restored.startedAt);
  assert.equal(imported.issuedAt, restored.issuedAt);
  imported.fieldLabels.game = '其他服务';
  assert.equal(restored.fieldLabels.game, '服务内容');
  for (const name of ['', '   ', '字'.repeat(41), null]) {
    assert.throws(() => validateReceipt({ ...restored, fieldLabels: { ...restored.fieldLabels, game: name } }));
  }
  assert.throws(() => validateReceipt({ ...restored, startedAt: null }));
});

test('time extraction requires explicit valid labels, preserves first values and never turns times into charges', () => {
  const original = order(['100']);
  original.startedAt = '2026-10-12T09:00';
  original.issuedAt = '2026-10-12T10:00';
  original.fieldLabels.bossId = '客户昵称';
  const result = parseOrderText('开始时间：2026-10-13 12:43\n结单时间：2026-10-13T14:43\n开始时间：2026-10-13 13:00\n结单时间：2026-02-30 14:43\n开始时间：100元\n陪玩168元', original);
  assert.equal(result.recognized, 3);
  assert.equal(result.receipt.startedAt, '2026-10-13T12:43');
  assert.equal(result.receipt.issuedAt, '2026-10-13T14:43');
  assert.equal(result.receipt.fieldLabels.bossId, '客户昵称');
  assert.deepEqual(result.receipt.items.map(({ name, amount }) => ({ name, amount })), [{ name: '陪玩', amount: '168.00' }]);
  assert.equal(calculateReceipt(result.receipt).total, '168.00');
  assert.equal(result.warnings.length, 3);
  const invalid = parseOrderText('开始时间：2026-02-30 12:43\n结单时间：2026-10-13 25:00', original);
  assert.equal(invalid.recognized, 0);
  assert.equal(invalid.receipt.startedAt, original.startedAt);
  assert.equal(invalid.receipt.issuedAt, original.issuedAt);
});
