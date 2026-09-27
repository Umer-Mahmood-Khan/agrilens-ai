// Builds dist/: a static, serverless copy of AgriLens for free static hosting
// (Hugging Face Static Spaces, GitHub Pages, Netlify...). The pipeline runs in the
// browser and visitors call OpenAI or Gemini directly with their own API key.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const replace = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`build-static: expected to find ${from}`);
  return text.replaceAll(from, to);
};

await rm(dist, { recursive: true, force: true });
await mkdir(new URL('lib/', dist), { recursive: true });

for (const file of await readdir(new URL('public/', root))) {
  if (file !== 'index.html') await cp(new URL(`public/${file}`, root), new URL(file, dist));
}
for (const file of await readdir(new URL('lib/', root))) {
  let code = await readFile(new URL(`lib/${file}`, root), 'utf8');
  if (file === 'recommendations.mjs') code = replace(code, "'../public/soil.mjs'", "'../soil.mjs'");
  await writeFile(new URL(`lib/${file}`, dist), code);
}

// Relative asset paths so the site also works under a sub-path (e.g. GitHub Pages).
let html = await readFile(new URL('public/index.html', root), 'utf8');
for (const asset of ['favicon.svg', 'styles.css', 'refinement.css', 'app.js']) html = replace(html, `"/${asset}"`, `"${asset}"`);
const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src https://api.openai.com https://generativelanguage.googleapis.com; object-src 'none'; base-uri 'none'; form-action 'self'";
html = replace(html, '<head>', `<head>\n  <meta name="agrilens-static" content="1">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
await writeFile(new URL('index.html', dist), html);

// Hugging Face Static Space configuration (ignored by other hosts).
await writeFile(new URL('README.md', dist), `---
title: AgriLens AI
emoji: 🌾
colorFrom: green
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Wheat photos and soil reports to three next steps
---

# AgriLens AI

Evidence-backed wheat decision support: a crop photo and optional soil report become three next steps, with linked references.

- **Sample walkthrough:** works immediately, no key needed.
- **Your own field:** enter your own OpenAI or Google Gemini API key. It goes straight from your browser to your provider and is never stored.

Decision support, not agronomic advice. Source code: https://github.com/Umer-Mahmood-Khan/agrilens-ai
`);
console.log('Static site written to dist/');
