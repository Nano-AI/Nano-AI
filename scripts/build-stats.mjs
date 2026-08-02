// Builds assets/stats-{light,dark}.svg — the README's one plate, drawn in the
// same print language as nano-ai.github.io (paper/ink/cobalt, Bayer dot fills,
// registration crosshairs).
//
//   node scripts/build-stats.mjs            # needs GITHUB_TOKEN in the env
//
// Two dimensions, both measured, neither decorative:
//   bar LENGTH  = how many public repos lead with that language
//   bar DENSITY = how recently one of them was pushed to
// So a long pale bar means "a lot of it, none of it lately". The step wedge in
// the footer is the legend.
//
// Self-hosted on purpose: the shared github-readme-stats instance 503s for days
// at a time, and a committed SVG can't go down. Refreshed by .github/workflows/stats.yml.

import { writeFileSync, mkdirSync } from 'node:fs';

const USER = 'Nano-AI';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.error('set GITHUB_TOKEN'); process.exit(1); }

// Things that don't show up as a repo's primary language but are very much in use.
// Hand-maintained — the bars above are measured, this line is declared.
const ALSO = [
  'Spring Boot · React · Next.js · Astro · Node · Docker',
  'Unity · Godot · OpenGL · SDL2 · RayLib · NumPy · pandas',
];

const QUERY = `{
  user(login: "${USER}") {
    createdAt
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes { pushedAt primaryLanguage { name } }
    }
  }
}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY }),
});
const json = await res.json();
if (json.errors) { console.error(JSON.stringify(json.errors, null, 2)); process.exit(1); }
const user = json.data.user;

// Rank by repos led, not bytes — byte counts drown in vendored bundles and
// notebook outputs (they put JavaScript at 38% and Jupyter at 35% here).
const SKIP = new Set(['HTML', 'CSS', 'SCSS']);
const byLang = new Map();
for (const r of user.repositories.nodes) {
  const l = r.primaryLanguage?.name;
  if (!l || SKIP.has(l)) continue;
  const cur = byLang.get(l) || { n: 0, pushed: 0 };
  cur.n++;
  cur.pushed = Math.max(cur.pushed, Date.parse(r.pushedAt) || 0);
  byLang.set(l, cur);
}
const ranked = [...byLang.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
const top = ranked.slice(0, 6);
const max = top[0][1].n;

const MONTH = 30.44 * 864e5;
const CUTOFFS = [36 * MONTH, 18 * MONTH, 6 * MONTH]; // → shade 0,1,2,3 (pale → dark)
const shadeFor = (pushed) => {
  const age = Date.now() - pushed;
  return CUTOFFS.reduce((s, c) => (age < c ? s + 1 : s), 0);
};

// --- geometry ----------------------------------------------------------------
const W = 840, H = 384, PAD = 40;
const BAR_X = 210, BAR_W = 440, BAR_H = 13;
const ROW_Y = 128, ROW_STEP = 26;
const RULE_TOP = 96, RULE_MID = 290;

const MONO = 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace';
const SANS = 'Archivo,Inter,Helvetica Neue,Helvetica,Arial,sans-serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 4×4 ordered dither, thresholded off the real Bayer matrix. Levels are spread
// 1/4/8/13 of 16 cells so the four steps read as four steps — 2/4/6/8 all
// rendered as the same mid-tone at this size.
const BAYER_M = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const LEVELS = [1, 4, 8, 13];   // never 16 — a solid fill stops being 1-bit
const BAYER = LEVELS.map((k) => {
  const on = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER_M[y][x] < k) on.push([x, y]);
  return on;
});

function card({ paper, ink, cobalt, muted, hairline }) {
  const patterns = BAYER.map((dots, i) =>
    `<pattern id="d${i}" width="4" height="4" patternUnits="userSpaceOnUse">` +
    dots.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${cobalt}"/>`).join('') +
    `</pattern>`
  ).join('');

  // Registration crosshairs, 13px at a 16px inset — lifted from Base.astro.
  const reg = [[16, 16], [W - 29, 16], [16, H - 29], [W - 29, H - 29]].map(([x, y]) =>
    `<g opacity="0.5" fill="${hairline}"><rect x="${x + 6}" y="${y}" width="1" height="13"/><rect x="${x}" y="${y + 6}" width="13" height="1"/></g>`
  ).join('');

  const rows = top.map(([name, { n, pushed }], i) => {
    const y = ROW_Y + i * ROW_STEP;
    const w = Math.max(16, Math.round((n / max) * BAR_W));
    const shade = shadeFor(pushed);
    return [
      `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="12.5" fill="${ink}">${esc(name)}</text>`,
      `<rect x="${BAR_X}" y="${y - 10}" width="${BAR_W}" height="${BAR_H}" fill="none" stroke="${hairline}" stroke-width="1"/>`,
      `<rect x="${BAR_X}" y="${y - 10}" width="${w}" height="${BAR_H}" fill="url(#d${shade})"/>`,
      `<rect x="${BAR_X + w - 1}" y="${y - 10}" width="1" height="${BAR_H}" fill="${cobalt}"/>`,
      `<text x="${W - PAD}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${muted}">${n} repo${n === 1 ? '' : 's'}</text>`,
    ].join('');
  }).join('');

  // Step wedge: the legend for bar density. One baseline, right-aligned, so it
  // sits in the footer row instead of colliding with the tools line.
  const SW = 22, SH = 9, GAP = 3, BASE = H - 22;
  const endMo = W - PAD, endSwatch = endMo - 32, startSwatch = endSwatch - (SW * 4 + GAP * 3);
  const wedge = BAYER.map((_, i) =>
    `<rect x="${startSwatch + i * (SW + GAP)}" y="${BASE - SH + 1}" width="${SW}" height="${SH}" fill="url(#d${i})"/>` +
    `<rect x="${startSwatch + i * (SW + GAP)}" y="${BASE - SH + 1}" width="${SW}" height="${SH}" fill="none" stroke="${hairline}" stroke-width="1"/>`
  ).join('') +
    `<text x="${startSwatch - 8}" y="${BASE}" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="0.8" fill="${muted}">3Y+</text>` +
    `<text x="${startSwatch - 34}" y="${BASE}" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="1.2" fill="${muted}">DENSITY = LAST PUSH</text>` +
    `<text x="${endMo}" y="${BASE}" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="0.8" fill="${muted}">6 MO</text>`;

  const alsoLines = ALSO.map((line, i) =>
    `<text x="${PAD + 150}" y="${314 + i * 19}" font-family="${MONO}" font-size="11.5" fill="${ink}">${esc(line)}</text>`
  ).join('');

  const since = new Date(user.createdAt).getUTCFullYear();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${top.map(([n, v]) => `${n}: ${v.n} repos`).join(', ')}. Also using ${ALSO.join(', ')}.">
<defs>${patterns}</defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${paper}" stroke="${hairline}" stroke-width="1"/>
${reg}
<text x="${PAD}" y="44" font-family="${MONO}" font-size="10" letter-spacing="2.2" fill="${cobalt}">PLATE 08 — LEDGER</text>
<text x="${W - PAD}" y="44" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="1.4" fill="${muted}">GITHUB.COM/${USER.toUpperCase()}</text>
<text x="${PAD}" y="78" font-family="${SANS}" font-size="24" font-weight="700" fill="${ink}">What I build with</text>
<rect x="${PAD}" y="${RULE_TOP}" width="${W - PAD * 2}" height="1" fill="${hairline}"/>
${rows}
<rect x="${PAD}" y="${RULE_MID}" width="${W - PAD * 2}" height="1" fill="${hairline}"/>
<text x="${PAD}" y="314" font-family="${MONO}" font-size="9.5" letter-spacing="1.4" fill="${muted}">ALSO IN ROTATION</text>
${alsoLines}
${wedge}
<text x="${PAD}" y="${H - 22}" font-family="${MONO}" font-size="9.5" letter-spacing="1.2" fill="${muted}">${user.repositories.totalCount} PUBLIC REPOS · ${ranked.length} LANGUAGES · SINCE ${since}</text>
</svg>
`;
}

mkdirSync(new URL('../assets/', import.meta.url), { recursive: true });
const out = (n, s) => writeFileSync(new URL(`../assets/${n}`, import.meta.url), s);

out('stats-light.svg', card({ paper: '#F4F3EE', ink: '#191714', cobalt: '#1E3FD8', muted: '#6E6A61', hairline: '#D9D6CC' }));
out('stats-dark.svg', card({ paper: '#16181A', ink: '#E8E5DD', cobalt: '#5B78FF', muted: '#8A877E', hairline: '#2C2E31' }));
console.log('wrote assets/stats-{light,dark}.svg —', top.map(([n, v]) => `${n}:${v.n}/s${shadeFor(v.pushed)}`).join(' '));
