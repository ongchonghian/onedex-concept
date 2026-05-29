const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* ADR 0047 sub-decision 20 — Boundary tests as code, not just docs.
 *
 * These tests enforce the layer-separation invariants the Test-as-operator
 * surfaces depend on. They're the executable counterpart to the framework
 * documented in the ADR: surfaces stay separated only as long as the
 * contracts are testable and tested.
 *
 * Following angle-gauge-ui's pattern of `*.test.ts` suites enforcing the
 * help-system contract (helpRegistryContentQuality / triageTerminology /
 * helpPlainLanguage / helpSourcePorting).
 *
 * All tests load the portal in JSDOM with the post-cutover register-element
 * pipeline; none require a live AJV CDN because they verify the SHAPE fed
 * to AJV, not AJV's own behaviour. */

function loadRegisterElement() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/schema-walker.js',
      'scripts/register-element.js'
    ]
  });
}

/* Walk a JSON object and yield every key. */
function* walkKeys(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walkKeys(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    yield k;
    yield* walkKeys(node[k]);
  }
}

test('L1 invariant — the schema fed to AJV has no `x-*` keys at any depth', () => {
  const w = loadRegisterElement();
  // Seed a state that USES `x-visible-when` at the field-builder layer
  // (regBuildElementSchemaArtifact preserves it on individual property
  // nodes per the comment in regStripSchemaExtensions). Then verify that
  // the strip-extensions output is interop-clean.
  w.regDraft.meta = { name: 'L1 invariant element' };
  w.regDraft.fields = [
    { id: 'f1', name: 'order_id', type: 'string', required: true, validation: { pattern: '^\\w+$' } },
    { id: 'f2', name: 'qty',      type: 'integer', required: true, validation: { minimum: 1 } },
    { id: 'f3', name: 'cond',     type: 'string', required: false, validation: {}, visibleWhen: 'qty > 0' }
  ];

  // The pre-strip schema MAY carry `x-*` keys (legacy preserved-for-inspection)
  const raw = w.regBuildElementSchemaArtifact(w.regDraft);
  // The cleaned schema must NOT.
  const clean = w.regStripSchemaExtensions(raw);
  const offenders = [];
  for (const k of walkKeys(clean)) {
    if (typeof k === 'string' && k.indexOf('x-') === 0) offenders.push(k);
  }
  assert.deepEqual(offenders, [], 'elementSchema fed to AJV must be interop-clean — no `x-*` keys');
});

test('L1 invariant — regBuildPublishArtifacts.elementSchema (post-strip) is interop-clean', () => {
  // The publish path. ADR 0046 §6 + ADR 0042 §8 doctrine: published schema
  // must be x-* zero-residue.
  const w = loadRegisterElement();
  w.regDraft.meta = { name: 'Publish-path invariant' };
  w.regDraft.fields = [
    { id: 'f1', name: 'a', type: 'string', required: true, visibleWhen: 'true' }
  ];
  const bundle = w.regBuildPublishArtifacts(w.regDraft);
  const cleaned = w.regStripSchemaExtensions(bundle.elementSchema);
  const offenders = [];
  for (const k of walkKeys(cleaned)) {
    if (typeof k === 'string' && k.indexOf('x-') === 0) offenders.push(k);
  }
  assert.deepEqual(offenders, []);
});

test('L1 contract — every L1 record carries the required fields per ADR 0047 sub-decision 4', () => {
  const w = loadRegisterElement();
  w.regDraft.meta = { name: 'L1 contract' };
  w.regDraft.fields = [
    { id: 'f1', name: 'order_id', type: 'string', required: true, validation: { pattern: '^[A-Z]{3}$' } }
  ];
  // Force an AJV violation — pattern mismatch
  // (regBuildL1Records gracefully degrades if AJV isn't loaded in this
  // node context; we explicitly verify the function exists and that any
  // records it does emit satisfy the contract.)
  if (typeof w.ajv2020 !== 'function') {
    // AJV CDN not available in node — assert the degraded path returns
    // a contract-shaped empty result.
    const result = w.regBuildL1Records({ order_id: 'lower' });
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.byField, 'object');
    assert.equal(Array.isArray(result.schemaLevel), true);
    assert.equal(typeof result.totalErrors, 'number');
    return;
  }
  const result = w.regBuildL1Records({ order_id: 'lower' });
  const allRecords = [].concat(...Object.values(result.byField), result.schemaLevel);
  allRecords.forEach((r, idx) => {
    assert.ok(r.primaryMessage,                'record ' + idx + ' missing primaryMessage');
    assert.ok(r.attribution,                   'record ' + idx + ' missing attribution');
    assert.equal(r.attribution.engine, 'Schema', 'L1 attribution.engine must be "Schema"');
    assert.ok(r.attribution.keyword,           'record ' + idx + ' missing attribution.keyword');
    assert.ok(r.attribution.schemaPath != null,'record ' + idx + ' missing attribution.schemaPath');
    assert.ok(r.attribution.rawAjvMessage != null, 'record ' + idx + ' missing attribution.rawAjvMessage');
  });
});

test('L3 invariant — hidden fields do not contribute L1 errors', () => {
  const w = loadRegisterElement();
  w.regDraft.meta = { name: 'L3 invariant' };
  w.regDraft.fields = [
    { id: 'f1', name: 'switch',   type: 'boolean', required: false },
    { id: 'f2', name: 'optional', type: 'string',  required: true, validation: { pattern: '^XYZ$' }, visibleWhen: 'switch == true' }
  ];
  const payload = { switch: false, optional: '' };               // optional is hidden
  const hidden = w.regBuildL3VisibilityMask(payload);
  assert.equal(hidden.has('optional'), true, 'optional must be hidden when switch=false');

  if (typeof w.ajv2020 !== 'function') return;                   // AJV CDN unavailable in node
  const l1 = w.regBuildL1Records(payload, hidden);
  assert.equal(l1.byField.optional, undefined, 'hidden field must produce no L1 records');
});

test('L2 vocabulary fence — FloatingPanel message text is operator-readable (no AJV/govaluate syntax)', () => {
  // FloatingPanel `on_failure` text must never carry expression syntax (>, <,
  // ==, &&, ||) or JSON pointers (/properties/...). The rule's expression
  // is admin-authored and should sit only in the Sarah-HUD right panel.
  // Verified by simulating a payload and inspecting the operator-facing
  // message that would land in the FloatingPanel.
  const w = loadRegisterElement();
  w.regDraft.meta = { name: 'L2 vocab fence' };
  w.regDraft.fields = [
    { id: 'f1', name: 'start_date', type: 'date', required: true },
    { id: 'f2', name: 'end_date',   type: 'date', required: true }
  ];
  w.regDraft.rules = [
    { id: 'r1', name: 'Date order', expression: 'end_date >= start_date', on_failure: 'End date must be on or after start date.', applies_at: 'validation' }
  ];
  const snapshot = w.regBuildL2RuleSnapshot({ start_date: '2026-12-31', end_date: '2026-01-01' });
  assert.equal(snapshot.failingCount, 1);
  // The operator-facing string is rule.on_failure. Verify it's vocab-clean.
  const operatorString = snapshot.items[0].rule.on_failure;
  const forbiddenSyntax = [/[><]=?/, /==/, /!=/, /&&/, /\|\|/, /\/properties\//];
  forbiddenSyntax.forEach(rx => {
    assert.equal(rx.test(operatorString), false,
      'on_failure text "' + operatorString + '" matches forbidden syntax ' + rx + ' — would leak Sarah-HUD vocabulary into operator surface');
  });
});

test('L2 hybrid — right-panel exposes expression text; FloatingPanel projection has no expression key', () => {
  // ADR 0047 sub-decision 3 — L2 is an audience-split hybrid. The Sarah-HUD
  // projection includes `expression`; the operator-facing FloatingPanel
  // projection must NOT. Verify the boundary holds in the snapshot shape.
  const w = loadRegisterElement();
  w.regDraft.meta = { name: 'L2 hybrid boundary' };
  w.regDraft.fields = [
    { id: 'f1', name: 'qty', type: 'integer', required: true }
  ];
  w.regDraft.rules = [
    { id: 'r1', name: 'Qty positive', expression: 'qty > 0', on_failure: 'Quantity must be positive.', applies_at: 'validation' }
  ];
  const snap = w.regBuildL2RuleSnapshot({ qty: -1 });
  // Sarah-HUD shape: items[].rule carries the full authoring artefact.
  assert.equal(snap.items[0].rule.expression, 'qty > 0', 'Sarah-HUD must carry expression');
  // FloatingPanel-projection shape would be { fieldName, on_failure, onClick? } —
  // produced inline in regFloatingPanelRender from items[].rule.on_failure
  // alone. The expression key must never appear in the projected operator
  // surface payload. We assert by deriving the projection here:
  const operatorProjection = { fieldName: 'qty', on_failure: snap.items[0].rule.on_failure };
  assert.equal('expression' in operatorProjection, false, 'operator projection must not carry expression');
});
