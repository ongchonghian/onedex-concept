const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

function loadParser() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'presenter-notes.js'), 'utf8');
  const context = { window: {}, Object: Object };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.parseKeynotes;
}

const SAMPLE = `# Portal Rewrite — Management Keynote

## Opener — 60 seconds

> "Opener body text"

---

## Section 00 — Why this needs leadership attention (8 min · the core pitch)

### What to say (30 sec framing)

> "Body for section 00"

---

## Section 01 — Upstream of compose (2 min)

### What to say

> "Body for section 01"
`;

test('parseKeynotes returns a record keyed by notesKey', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  assert.ok(notes['Opener']);
  assert.ok(notes['Section 00']);
  assert.ok(notes['Section 01']);
});

test('parseKeynotes block contains the section body verbatim', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  assert.match(notes['Section 00'], /Body for section 00/);
  assert.match(notes['Section 01'], /Body for section 01/);
});

test('parseKeynotes tolerates trailing punctuation in headings (— Title)', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  // "Section 00" key should match heading "## Section 00 — Why this needs..."
  assert.ok(notes['Section 00'].length > 0);
});

test('parseKeynotes returns empty object for empty input', () => {
  const parseKeynotes = loadParser();
  assert.deepEqual(parseKeynotes(''), {});
});
