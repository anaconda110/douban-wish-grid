import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);
const tag = process.env.GITHUB_REF_NAME || process.argv[2];
const expectedTag = `v${packageJson.version}`;

if (!tag) {
  console.error('缺少 release tag：请在参数或 GITHUB_REF_NAME 中提供，例如 v1.8.0');
  process.exit(1);
}

if (tag !== expectedTag) {
  console.error(`发布 tag 与 package.json 版本不一致：${tag} !== ${expectedTag}`);
  process.exit(1);
}

console.log(`Release version OK: ${tag}`);
