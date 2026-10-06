// Zero-dependency bundler: inlines src/ ES modules + CSS into dist/planboard.html.
//   node build.mjs          write dist/planboard.html
//   node build.mjs --check  exit 1 if dist/planboard.html is stale
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist', 'planboard.html');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

function loadModules(entry) {
  const mods = new Map();
  const order = [];
  const visit = (file, stack) => {
    if (mods.has(file)) return;
    if (stack.includes(file)) throw new Error(`Import cycle: ${[...stack, file].map((f) => relative(SRC, f)).join(' -> ')}`);
    const src = readFileSync(file, 'utf8');
    const imports = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = resolve(dirname(file), m[2]);
      const names = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [a, b] = s.split(/\s+as\s+/);
          return b ? `${a}: ${b}` : a;
        });
      imports.push({ dep, names });
      visit(dep, [...stack, file]);
    }
    let code = src.replace(IMPORT_RE, '');
    if (/^\s*import\b/m.test(code)) throw new Error(`${relative(SRC, file)}: unsupported import syntax`);
    const exports = [];
    code = code.replace(EXPORT_RE, (m, kind, name) => {
      exports.push(name);
      return m.replace(/^export\s+/, '');
    });
    if (/^\s*export\b/m.test(code)) throw new Error(`${relative(SRC, file)}: unsupported export syntax`);
    mods.set(file, { imports, exports, code });
    order.push(file);
  };
  visit(entry, []);
  return { mods, order };
}

export function bundleJS(entry = join(SRC, 'main.js')) {
  const { mods, order } = loadModules(entry);
  for (const f of order) {
    for (const i of mods.get(f).imports) {
      for (const n of i.names) {
        const name = n.split(':')[0].trim();
        if (!mods.get(i.dep).exports.includes(name)) throw new Error(`${relative(SRC, f)}: '${name}' is not exported by ${relative(SRC, i.dep)}`);
      }
    }
  }
  const varOf = (f) => '__' + relative(SRC, f).replace(/\.js$/, '').replace(/[^\w]/g, '_');
  const parts = order.map((f) => {
    const m = mods.get(f);
    const head = m.imports.map((i) => `const { ${i.names.join(', ')} } = ${varOf(i.dep)};`).join('\n');
    return `// ---- ${relative(SRC, f)}\nconst ${varOf(f)} = (() => {\n${head}\n${m.code.trim()}\nreturn { ${m.exports.join(', ')} };\n})();`;
  });
  return `(() => {\n'use strict';\n${parts.join('\n\n')}\n})();\n`;
}

export function bundleCSS() {
  const dir = join(SRC, 'styles');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => `/* ---- ${f} */\n${readFileSync(join(dir, f), 'utf8').trim()}`)
    .join('\n\n');
}

export function build() {
  const tpl = readFileSync(join(SRC, 'index.html'), 'utf8');
  const js = bundleJS().replace(/<\/(script)/gi, '<\\/$1');
  const css = bundleCSS().replace(/<\/(style)/gi, '<\\/$1');
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  return tpl
    .replace(/@version/g, () => version)
    .replace('/*@css*/', () => css)
    .replace('/*@js*/', () => js);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = build();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch (e) {
      /* missing */
    }
    if (current !== html) {
      console.error('dist/planboard.html is stale — run `npm run build` and commit the result.');
      process.exit(1);
    }
    console.log('dist/planboard.html is up to date.');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, html);
    console.log(`Wrote ${relative(ROOT, OUT)} (${(html.length / 1024).toFixed(1)} KB)`);
  }
}
