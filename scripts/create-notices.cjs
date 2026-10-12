const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const packages = [
  ['big.js', 'LICENCE.md'],
  ['electron', 'dist/LICENSE'],
];
const sections = ['小票工坊 — 依赖组件许可证\n\n本软件应用代码未授予开源复用许可。以下开源组件用于桌面运行和金额计算，分别遵循其许可证。\n界面图标使用本项目通过 image 生成并整理的本地素材，不再使用图标库。\nElectron 所附 Chromium 等组件的完整许可文本随安装目录中的 LICENSES.chromium.html 一并提供。'];
for (const [name, filename] of packages) {
  const packageRoot = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const license = fs.readFileSync(path.join(packageRoot, filename), 'utf8');
  sections.push(`${name} ${pkg.version}\n${'='.repeat(48)}\n${license}`);
}
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n\n'));
console.log('已生成随软件分发的依赖组件许可证');
