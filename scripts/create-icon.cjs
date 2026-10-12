const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="16" y="16" width="480" height="480" rx="116" fill="#fff8ee"/><path d="M144 96h224v324l-28-20-28 20-28-20-28 20-28-20-28 20-28-20-28 20z" fill="#ffffff" stroke="#362b2a" stroke-width="14" stroke-linejoin="round"/><path d="M187 165h138M187 212h99M187 260h138" fill="none" stroke="#e788a3" stroke-width="18" stroke-linecap="round"/><path d="M190 321h60" stroke="#362b2a" stroke-width="14" stroke-linecap="round"/><circle cx="316" cy="333" r="29" fill="#f6d984"/></svg>';
const target = path.join(__dirname, '..', 'build');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'icon.png'), new Resvg(svg).render().asPng());
console.log('已生成原绘软件图标');
