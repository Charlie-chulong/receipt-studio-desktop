export const RECEIPT_THEMES = Object.freeze({
  cute: Object.freeze({ name: '柔彩手账', description: '粉彩纸胶带', paperColor: '#FFF8EE', accentColor: '#E788A3', font: 'Microsoft YaHei', shape: 'default', motif: 'tape' }),
  classic: Object.freeze({ name: '奶油小票', description: '奶油色蝴蝶结', paperColor: '#FFFAF0', accentColor: '#C4A276', font: 'Microsoft YaHei', shape: 'notch', motif: 'bow' }),
  strawberry: Object.freeze({ name: '草莓奶糖', description: '草莓粉 · 小果实', paperColor: '#FFF2F4', accentColor: '#D8718E', font: 'Microsoft YaHei', shape: 'stamp', motif: 'strawberry' }),
  mint: Object.freeze({ name: '薄荷软糖', description: '薄荷绿 · 叶子星星', paperColor: '#F0F8F3', accentColor: '#69A88F', font: 'Microsoft YaHei', shape: 'chamfer', motif: 'mint' }),
  peach: Object.freeze({ name: '蜜桃来信', description: '蜜桃色 · 爱心信封', paperColor: '#FFF1E8', accentColor: '#E69574', font: 'Microsoft YaHei', shape: 'arch', motif: 'letter' }),
  bear: Object.freeze({ name: '奶油熊熊', description: '饼干色 · 小熊印章', paperColor: '#FFF5E7', accentColor: '#B58661', font: 'Microsoft YaHei', shape: 'tag', motif: 'bear' }),
  cherry: Object.freeze({ name: '樱桃气泡', description: '樱桃红 · 双果实', paperColor: '#FFF3F0', accentColor: '#C97079', font: 'Microsoft YaHei', shape: 'waist', motif: 'cherry' }),
  lemon: Object.freeze({ name: '柠檬汽水', description: '柠檬黄 · 小切片', paperColor: '#FFFBE6', accentColor: '#B99B46', font: 'Microsoft YaHei', shape: 'notch', motif: 'lemon' }),
  cloud: Object.freeze({ name: '晴空棉花', description: '浅蓝色 · 软云朵', paperColor: '#F0F7FD', accentColor: '#7AA6C0', font: 'Microsoft YaHei', shape: 'arch', motif: 'cloud' }),
  almond: Object.freeze({ name: '杏仁花园', description: '淡杏色 · 小花瓣', paperColor: '#FAF2E9', accentColor: '#AB866E', font: 'Microsoft YaHei', shape: 'stamp', motif: 'flower' }),
});

export const RECEIPT_THEME_IDS = Object.freeze(Object.keys(RECEIPT_THEMES));

export function applyReceiptTheme(receipt, id) {
  if (!Object.hasOwn(RECEIPT_THEMES, id)) throw new Error('请选择有效的小票主题');
  const preset = RECEIPT_THEMES[id];
  receipt.theme = id;
  receipt.paperColor = preset.paperColor;
  receipt.accentColor = preset.accentColor;
  receipt.font = preset.font;
  receipt.shape = preset.shape;
}
