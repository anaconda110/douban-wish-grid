import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const packagePath = join(projectRoot, 'package.json');
const sourcePath = join(projectRoot, 'src', 'douban-wish-grid.user.js');
const distDirectory = join(projectRoot, 'dist');
const extensionDirectory = join(distDirectory, 'douban-wish-grid-extension');
const userscriptOutputPath = join(distDirectory, 'douban-wish-grid.user.js');
const extensionZipPath = join(distDirectory, 'douban-wish-grid-extension.zip');

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const source = readFileSync(sourcePath, 'utf8');
const metadata = parseUserscriptMetadata(source);
const version = packageJson.version;
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

for (const key of ['name', 'description', 'version', 'match', 'run-at']) {
  if (!metadata[key]) {
    throw new Error(`用户脚本元数据缺少 @${key}`);
  }
}

const userscript = source.replace(
  /^\/\/ @version\s+.*$/m,
  `// @version      ${version}`
);
const contentScript = source.slice(metadata.headerLength).replace(/^\s+/, '');
const manifest = {
  manifest_version: 3,
  name: metadata.name,
  version,
  description: metadata.description,
  content_scripts: [
    {
      matches: metadata.match,
      js: ['content.js'],
      run_at: metadata['run-at']
    }
  ]
};

rmSync(distDirectory, { recursive: true, force: true });
mkdirSync(extensionDirectory, { recursive: true });
writeFileSync(userscriptOutputPath, userscript, 'utf8');
writeFileSync(join(extensionDirectory, 'content.js'), contentScript, 'utf8');
writeFileSync(
  join(extensionDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);
writeFileSync(
  extensionZipPath,
  createZip([
    {
      name: 'douban-wish-grid-extension/',
      data: Buffer.alloc(0),
      directory: true
    },
    {
      name: 'douban-wish-grid-extension/content.js',
      data: Buffer.from(contentScript, 'utf8')
    },
    {
      name: 'douban-wish-grid-extension/manifest.json',
      data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    }
  ])
);

const digest = (filePath) =>
  createHash('sha256').update(readFileSync(filePath)).digest('hex');

console.log(`Built Douban Wish Grid v${version}`);
console.log(`  ${userscriptOutputPath}`);
console.log(`  ${join(extensionDirectory, 'content.js')}`);
console.log(`  ${join(extensionDirectory, 'manifest.json')}`);
console.log(`  ${extensionZipPath}`);
console.log(`  SHA-256 ${digest(extensionZipPath)}`);

function parseUserscriptMetadata(text) {
  const headerMatch = /^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\r?\n?/m.exec(text);
  if (!headerMatch) {
    throw new Error('找不到用户脚本元数据块');
  }

  const result = {};
  const repeatedKeys = new Set(['match', 'include', 'exclude', 'require', 'resource', 'connect']);
  for (const line of headerMatch[1].split(/\r?\n/)) {
    const match = /^\/\/\s+@([^\s]+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (repeatedKeys.has(key)) {
      result[key] ||= [];
      result[key].push(value.trim());
    } else {
      result[key] = value.trim();
    }
  }
  result.headerLength = headerMatch[0].length;
  return result;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const dosTime = 0;
  const dosDate = (1 << 5) | 1;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const sourceData = entry.data;
    const method = entry.directory ? 0 : 8;
    const compressed = entry.directory ? sourceData : deflateRawSync(sourceData, { level: 9 });
    const crc = crc32(sourceData);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(sourceData.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(sourceData.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.directory ? 0x41ed0010 : 0x81a40000, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
