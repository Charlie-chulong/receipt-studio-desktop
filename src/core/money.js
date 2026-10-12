import Big from 'big.js';
import { validateReceipt } from './model.js';

const rounded = value => value.round(2, Big.roundHalfUp);
const money = value => value.toFixed(2);

export function calculateReceipt(value) {
  const receipt = validateReceipt(value);
  const fees = receipt.fees;
  const subtotal = receipt.items.reduce((sum, item) => sum.plus(item.amount), new Big(0));
  const rush = fees.rushEnabled ? rounded(subtotal.times(new Big(fees.rushMultiplier).minus(1))) : new Big(0);
  const coupon = new Big(fees.couponAmount);
  const discountable = fees.discountBeforeRush ? subtotal : subtotal.plus(rush);
  const independentRush = fees.discountBeforeRush ? rush : new Big(0);
  const discountBase = fees.couponBeforeDiscount ? discountable.minus(coupon) : discountable;
  if (fees.couponBeforeDiscount && discountBase.lt(0)) {
    throw new Error(`优惠金额：折扣前优惠不能超过可优惠基数 ¥${money(discountable)}，请减少优惠金额或调整费用顺序`);
  }
  const discounted = fees.discountEnabled ? rounded(discountBase.times(new Big(fees.discountRate).div(10))) : discountBase;
  const discount = discountBase.minus(discounted);
  const afterDiscount = discounted.plus(independentRush);
  if (!fees.couponBeforeDiscount && coupon.gt(afterDiscount)) {
    throw new Error(`优惠金额：折扣后优惠不能超过应付金额 ¥${money(afterDiscount)}，请减少优惠金额或调整费用顺序`);
  }
  const total = fees.couponBeforeDiscount ? afterDiscount : afterDiscount.minus(coupon);
  const steps = [`项目合计 ¥${money(subtotal)}`];
  if (fees.rushEnabled) steps.push(`原价加急 ×${fees.rushMultiplier}，加急费 ¥${money(rush)}`);
  steps.push(fees.discountBeforeRush ? '折扣基数为项目原价（加急费不打折）' : '折扣基数为项目原价与加急费之和');
  if (fees.couponBeforeDiscount) steps.push(`先减优惠 ¥${money(coupon)}`);
  if (fees.discountEnabled) steps.push(`再按 ${fees.discountRate} 折，折扣减免 ¥${money(discount)}`);
  else steps.push('不打折');
  if (fees.discountBeforeRush && fees.rushEnabled) steps.push(`加回不打折的加急费 ¥${money(rush)}`);
  if (!fees.couponBeforeDiscount) steps.push(`最后减优惠 ¥${money(coupon)}`);
  steps.push(`应付 ¥${money(total)}（每阶段四舍五入至分）`);
  return {
    subtotal: money(subtotal), rush: money(rush), discount: money(discount), coupon: money(coupon), total: money(total),
    formula: steps.join('；'),
  };
}
