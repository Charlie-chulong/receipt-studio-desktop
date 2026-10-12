import { validateReceipt } from './model.js';
import { calculateReceipt } from './money.js';

const METADATA = [
  [/^(?:老板(?:ID)?|客户)\s*[:：]\s*(.+)$/i, 'bossId', '老板 / 客户'],
  [/^(?:派单客服|客服|派单)\s*[:：]\s*(.+)$/, 'dispatcher', '派单客服'],
  [/^(?:账户(?:编号)?|账号|编号)\s*[:：]\s*(.+)$/, 'accountNumber', '账户 / 编号'],
  [/^游戏\s*[:：]\s*(.+)$/, 'game', '游戏'],
  [/^(?:支付方式|付款方式)\s*[:：]\s*(微信支付|支付宝|现金)$/, 'paymentMethod', '支付方式'],
];
const DECIMAL = '(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?';
const FINAL_PRICE = new RegExp(`^(.*?)\\s*(?:[¥￥]\\s*(${DECIMAL})(?:\\s*元)?|(${DECIMAL})\\s*元)\\s*$`);
const COUPON = new RegExp(`^(?:优惠|减免)\\s*[:：]?\\s*(?:[¥￥]\\s*)?(${DECIMAL})\\s*元$`);
const PAYMENT_FACT = /^(?:(?:已经|尚未|已|未|待)\s*)?(?:支付|付款|收款|到账|退款)/;

export function parseOrderText(text, currentReceipt) {
  if (typeof text !== 'string') throw new Error('订单文本：请输入文本后再提取');
  if (text.length > 20000) throw new Error('订单文本：最多 20000 个字符，请分段提取');
  const receipt = validateReceipt(currentReceipt);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 200) throw new Error('订单文本：最多 200 行，请删除无关聊天内容');
  const warnings = [];
  const items = [];
  const seen = new Set();
  let recognized = 0;
  const warn = (index, line, detail) => warnings.push(`第 ${index + 1} 行「${line.slice(0, 100)}」：${detail}`);
  const applyField = (field, value, label, index, line) => {
    if (seen.has(field)) {
      warn(index, line, `${label}重复，已保留首次识别值，请手动确认`);
      return;
    }
    try {
      const candidate = validateReceipt({ ...receipt, [field]: value });
      receipt[field] = candidate[field];
      seen.add(field);
      recognized += 1;
    } catch (error) {
      warn(index, line, error.message);
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let handled = false;
    for (const [pattern, field, label] of METADATA) {
      const match = pattern.exec(line);
      if (!match) continue;
      applyField(field, match[1].trim(), label, index, line);
      handled = true;
      break;
    }
    if (handled) continue;
    const time = /^(开始时间|结单时间)\s*[:：]\s*(.+)$/.exec(line);
    if (time) {
      applyField(time[1] === '开始时间' ? 'startedAt' : 'issuedAt', time[2].trim().replace(' ', 'T'), time[1], index, line);
      continue;
    }
    if (/^(?:微信支付|支付宝|现金)$/.test(line)) {
      applyField('paymentMethod', line, '支付方式', index, line);
      continue;
    }
    if (/^(?:优惠|减免)/.test(line)) {
      const match = COUPON.exec(line);
      if (!match) {
        warn(index, line, '优惠有歧义，请使用「优惠18元」这样的明确金额');
        continue;
      }
      if (seen.has('couponAmount')) {
        warn(index, line, '优惠重复，未叠加，请手动确认最终优惠金额');
        continue;
      }
      try {
        const candidate = validateReceipt({ ...receipt, fees: { ...receipt.fees, couponAmount: match[1] } });
        receipt.fees.couponAmount = candidate.fees.couponAmount;
        seen.add('couponAmount');
        recognized += 1;
      } catch (error) {
        warn(index, line, error.message);
      }
      continue;
    }
    if (PAYMENT_FACT.test(line) || /^(?:老板|客户|客服|派单|账户|账号|编号|游戏|订单(?:号|编号)?|日期|时间|开始时间|结单时间|开单|已付|实付|合计|总计|应付|加急|折扣)/.test(line) || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(line)) {
      warn(index, line, '非项目或含状态 / 费用歧义，未作为消费金额，请手动确认');
      continue;
    }
    const match = FINAL_PRICE.exec(line);
    if (!match) {
      warn(index, line, '未识别，请为项目写明行末总价，例如「陪玩 2小时168元」');
      continue;
    }
    const name = match[1].replace(/^项目\s*[:：]\s*/, '').trim();
    if (!name || !/[\p{L}]/u.test(name) || /[¥￥]|\d\s*元/.test(name) || /\d(?:[eE])?$/.test(match[1]) || /[.+-]$/.test(name) || /(?:单价|每小时|每局|每单|\/小时|\/局|起价|定金|押金|余额)/.test(name)) {
      warn(index, line, '金额或项目有歧义，未自动提取，请确认行末金额是该项目总价');
      continue;
    }
    if (items.length >= 80) {
      warn(index, line, '超过 80 个项目，未追加；请分开制单');
      continue;
    }
    const item = { id: `parsed-item-${index + 1}`, name, amount: match[2] ?? match[3] };
    try {
      const candidate = validateReceipt({ ...receipt, items: [item] });
      items.push(candidate.items[0]);
      recognized += 1;
    } catch (error) {
      warn(index, line, error.message);
    }
  }
  if (items.length) receipt.items = items;
  try {
    calculateReceipt(receipt);
  } catch (error) {
    warnings.push(`费用需要确认：${error.message}`);
  }
  if (!recognized) warnings.push('未提取到可确认的信息，原小票内容保持不变');
  return { receipt, warnings, recognized };
}
