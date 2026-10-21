/**
 * 构建脚本：把需要公开发布的静态文件拷进 dist/
 * 用 Node 而不是 shell 的 cp，保证 Windows / Linux 行为一致。
 * 不拷贝：api/、scripts/、supabase/、netlify/、*.bak、.env*
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const FILES = ['index.html', 'manifest.json', 'icon.svg'];
const DIRS = ['vendor', 'assets'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const name of FILES) {
    const src = path.join(root, name);
    if (!existsSync(src)) {
        console.error(`[build] 缺少文件: ${name}`);
        process.exit(1);
    }
    await cp(src, path.join(dist, name));
    console.log(`[build] file  ${name}`);
}

for (const name of DIRS) {
    const src = path.join(root, name);
    if (!existsSync(src)) {
        console.error(`[build] 缺少目录: ${name}`);
        process.exit(1);
    }
    await cp(src, path.join(dist, name), { recursive: true });
    console.log(`[build] dir   ${name}/`);
}

const BANNED = [/\.bak$/i, /^\.env/i, /^api$/i, /^supabase$/i, /^scripts$/i, /^netlify$/i];
const leaked = (await readdir(dist)).filter((n) => BANNED.some((re) => re.test(n)));
if (leaked.length) {
    console.error(`[build] 检测到不该发布的文件: ${leaked.join(', ')}`);
    process.exit(1);
}

console.log('[build] 完成');
