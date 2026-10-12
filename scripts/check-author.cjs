const fs = require('node:fs');
const path = require('node:path');
try {
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'author-profile.json'), 'utf8'));
  if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || typeof profile.bio !== 'string' || !profile.bio.trim()) throw new Error('昵称和简介不能为空');
  if (profile.name.length > 200 || profile.bio.length > 6000) throw new Error('作者资料文字过长');
  if (profile.contacts != null && (!Array.isArray(profile.contacts) || profile.contacts.length > 10)) throw new Error('联系方式格式不正确');
  console.log(`已核对固定作者介绍：${profile.name}`);
} catch (error) {
  console.error(`无法生成分发安装包：请先提供真实作者昵称、简介及可选联系资料。${error.code === 'ENOENT' ? '' : `\n${error.message}`}`);
  process.exitCode = 1;
}
