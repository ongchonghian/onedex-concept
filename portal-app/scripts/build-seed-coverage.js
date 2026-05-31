#!/usr/bin/env node
/* ============================================================
   build-seed-coverage.js — regenerates docs/seed-coverage.md
   ============================================================
   Reads portal-app/scripts/state.js as text, extracts every SCENE_SEEDS
   top-level key, parses each one's screen slots (which are populated vs
   null), and emits a markdown coverage matrix to:

       design-concepts/docs/seed-coverage.md

   Run from anywhere; resolves paths from this file's location.

     node portal-app/scripts/build-seed-coverage.js

   Pure read-only; never mutates state.js.

   Limitations (deliberate — keeps the tool dependency-free):
     · Regex-based parsing, not a JS AST. Works as long as SCENE_SEEDS keys
       are quoted strings at the top of their entry and screen slots use the
       standard names (detail / inbox / drafts / etc.).
     · "Populated" check is shallow: detects whether a slot exists and is
       non-null. Doesn't validate the inner shape — that's the doctor's job.
     · USERS / ORGS / USER_ORG_AFFILIATIONS / ORG_DEX_MEMBERSHIPS counts come
       from the same regex pass.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const STATE_JS = path.join(HERE, 'state.js');
const OUT_MD = path.resolve(HERE, '..', '..', 'docs', 'seed-coverage.md');

const SCREEN_SLOTS = ['detail', 'inbox', 'message-detail', 'dashboard', 'drafts', 'participants', 'agreements', 'messages'];
const DEX_LABELS = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' };

function _extractTopBlock(src, blockName) {
  // Finds `const <blockName> = { ... };` at column 0 and returns the inner body
  // string. Skips comments inline so apostrophes inside comments (e.g. "Bea's
  // scenes") don't trick the brace walker into a fake string state.
  const re = new RegExp(`^const ${blockName}\\s*=\\s*\\{`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, inStr = null, esc = false;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (esc) { esc = false; i++; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    // Skip line + block comments BEFORE checking string/brace state.
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i); }
    i++;
  }
  return null;
}

function _stripCommentsAndStrings(src) {
  // Replace comment + string contents with whitespace of equal length so
  // character offsets stay aligned with the original source. Used by the
  // top-level-entry finder to ignore braces/keys inside strings or comments.
  let out = '';
  let i = 0, n = src.length;
  while (i < n) {
    const ch = src[i];
    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      out += ' '.repeat(i - start);
      continue;
    }
    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      if (i < n - 1) i += 2;
      // Preserve newlines inside the block so line numbers stay roughly stable
      out += src.slice(start, i).replace(/[^\n]/g, ' ');
      continue;
    }
    // String literal (single/double/backtick)
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch, start = i; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      if (i < n) i++;
      out += q + ' '.repeat(Math.max(0, i - start - 2)) + q;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function _topLevelEntries(blockBody) {
  // Operate on a stripped copy so braces inside comments/strings don't perturb
  // depth tracking. Keys are still read from the ORIGINAL source via offset.
  const stripped = _stripCommentsAndStrings(blockBody);
  const entries = [];
  let i = 0, n = stripped.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(stripped[i])) i++;
    if (i >= n) break;
    // Key — quoted string or identifier
    let key = null;
    if (blockBody[i] === '"' || blockBody[i] === "'") {
      // Find matching quote in the ORIGINAL (stripped quotes are still present)
      const q = blockBody[i++];
      const ks = i;
      while (i < n && blockBody[i] !== q) {
        if (blockBody[i] === '\\') i++;
        i++;
      }
      key = blockBody.slice(ks, i);
      i++;
    } else {
      const ks = i;
      while (i < n && /[A-Za-z0-9_$-]/.test(blockBody[i])) i++;
      key = blockBody.slice(ks, i);
    }
    while (i < n && /\s/.test(stripped[i])) i++;
    if (stripped[i] !== ':') { i++; continue; }
    i++;
    while (i < n && /\s/.test(stripped[i])) i++;
    const valueStart = i;
    const ch = stripped[i];
    if (ch === '{' || ch === '[') {
      const open = ch, close = ch === '{' ? '}' : ']';
      let depth = 1; i++;
      while (i < n && depth > 0) {
        const c = stripped[i];
        if (c === open) depth++;
        else if (c === close) depth--;
        i++;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++;
      while (i < n && blockBody[i] !== q) {
        if (blockBody[i] === '\\') i++;
        i++;
      }
      if (i < n) i++;
    } else {
      while (i < n && stripped[i] !== ',' && stripped[i] !== '\n') i++;
    }
    const valueEnd = i;
    const value = blockBody.slice(valueStart, valueEnd).trim();
    if (key) entries.push({ key, valueStart, valueEnd, value });
  }
  return entries;
}

function _slotIsPopulated(seedValue, slotName) {
  // Look for `"slotName"|slotName:` at the top level of the seed object.
  const re = new RegExp(`(?:^|[,{\\s])(?:'${slotName}'|"${slotName}"|${slotName})\\s*:\\s*([^,\\n]*)`, 'm');
  const m = re.exec(seedValue);
  if (!m) return null; // not present
  const v = m[1].trim();
  if (v === 'null' || v === '[]' || v === '{}') return false; // explicit empty
  return true;
}

function _countTopLevelKeys(blockBody) {
  return _topLevelEntries(blockBody).length;
}

function _classifyDex(key) {
  // Key shape: <userId>-<orgId>-<dexId>-<scenarioId>
  const parts = key.split('-');
  if (parts.length < 4) {
    return { legacy: true, key };
  }
  return {
    legacy: false,
    userId: parts[0],
    orgId: parts[1],
    dexId: parts[2],
    scenarioId: parts.slice(3).join('-'),
    key
  };
}

function _renderTable(rows) {
  // rows: [{ user, org, dex, scenario, slots: { detail: 'full'|'placeholder'|'absent' ... } }]
  const header = ['Scene key', 'User', 'Org', 'DEX', 'Scen'].concat(SCREEN_SLOTS);
  const sep = header.map(() => '---');
  const lines = [];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + sep.join(' | ') + ' |');
  for (const r of rows) {
    const slotCols = SCREEN_SLOTS.map(s => {
      const v = r.slots[s];
      if (v === 'full') return 'F';
      if (v === 'placeholder') return '·';
      return '—';
    });
    lines.push(`| \`${r.key}\` | ${r.user} | ${r.org} | ${r.dex} | ${r.scenario} | ` + slotCols.join(' | ') + ' |');
  }
  return lines.join('\n');
}

function main() {
  const src = fs.readFileSync(STATE_JS, 'utf8');

  const sceneBlock = _extractTopBlock(src, 'SCENE_SEEDS');
  if (!sceneBlock) {
    console.error('Could not locate SCENE_SEEDS block in state.js');
    process.exit(1);
  }
  const userBlock = _extractTopBlock(src, 'USERS');
  const orgBlock = _extractTopBlock(src, 'ORGS');
  const affBlock = _extractTopBlock(src, 'USER_ORG_AFFILIATIONS');
  const memBlock = _extractTopBlock(src, 'ORG_DEX_MEMBERSHIPS');

  const userCount = userBlock ? _countTopLevelKeys(userBlock) : 0;
  const orgCount = orgBlock ? _countTopLevelKeys(orgBlock) : 0;
  const affCount = affBlock ? _countTopLevelKeys(affBlock) : 0;
  const memCount = memBlock ? _countTopLevelKeys(memBlock) : 0;

  const sceneEntries = _topLevelEntries(sceneBlock);
  const rows = sceneEntries.map(e => {
    const classified = _classifyDex(e.key);
    const slots = {};
    SCREEN_SLOTS.forEach(s => {
      const populated = _slotIsPopulated(e.value, s);
      slots[s] = populated === null ? 'absent' : (populated ? 'full' : 'placeholder');
    });
    return {
      key: e.key,
      user: classified.userId || '?',
      org: classified.orgId || '?',
      dex: classified.dexId || '?',
      scenario: classified.scenarioId || (classified.legacy ? '(legacy)' : '?'),
      slots
    };
  });

  // Sort: dex → scenario → user
  const dexOrder = { tx: 0, bx: 1, hx: 2 };
  rows.sort((a, b) => (dexOrder[a.dex] || 9) - (dexOrder[b.dex] || 9) || a.scenario.localeCompare(b.scenario) || a.user.localeCompare(b.user));

  const fullCount = rows.reduce((n, r) => n + (r.slots.detail === 'full' ? 1 : 0), 0);
  const placeholderCount = rows.reduce((n, r) => n + (r.slots.detail === 'placeholder' || (r.slots.detail === 'absent' && r.slots.drafts !== 'absent') ? 1 : 0), 0);
  const totalScenes = rows.length;

  const today = new Date().toISOString().slice(0, 10);

  const md =
`# SCENE_SEEDS coverage

> **Auto-generated.** Run \`node portal-app/scripts/build-seed-coverage.js\` to regenerate.
> Last build: ${today}

## Roster

- **${userCount}** users
- **${orgCount}** orgs
- **${affCount}** user–org affiliations
- **${memCount}** org–DEX memberships

## Scene catalogue

- **${totalScenes}** total scenes in \`SCENE_SEEDS\`
- **${fullCount}** with full \`detail\` seed
- **${placeholderCount}** with placeholder slots (null screens) — render via per-DEX fallbacks

Legend: **F** = full seed · **·** = placeholder (null/empty) · **—** = slot absent

${_renderTable(rows)}

## Per-DEX coverage

${_perDexSummary(rows)}

## How to add a scene

See [seed-authoring.md](./seed-authoring.md). Quick path:

\`\`\`js
// in the browser console
const s = scaffoldScene('bea', 'bx', 'A');
copy(s.toJSCode());                       // copy to clipboard
// then paste into SCENE_SEEDS in portal-app/scripts/state.js
\`\`\`

Run the doctor (\`?doctor=1\` in the URL, or \`runSeedDoctor()\` in the console) after editing to catch orphan references.
`;

  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, md, 'utf8');
  console.log(`Wrote ${OUT_MD}`);
  console.log(`  ${totalScenes} scenes · ${fullCount} full · ${placeholderCount} placeholder`);
}

function _perDexSummary(rows) {
  const byDex = { tx: [], bx: [], hx: [] };
  rows.forEach(r => { if (byDex[r.dex]) byDex[r.dex].push(r); });
  const out = [];
  ['tx', 'bx', 'hx'].forEach(d => {
    const label = DEX_LABELS[d];
    const scenes = byDex[d];
    if (!scenes.length) {
      out.push(`- **${label}**: 0 scenes`);
      return;
    }
    const full = scenes.filter(r => r.slots.detail === 'full').length;
    out.push(`- **${label}**: ${scenes.length} scene${scenes.length === 1 ? '' : 's'} (${full} full)`);
    scenes.forEach(s => out.push(`  - \`${s.key}\``));
  });
  return out.join('\n');
}

main();
