/* Data Element registration flow — ADR 0039
 *
 * All logic for the +New element / +New version registration canvas.
 * Loaded after state.js + app.js so DATA_ELEMENTS_BY_DEX, FORK_SOURCE_SCHEMAS,
 * goto(), toast(), openOverlay(), closeOverlay(), currentDexCode() are in scope.
 *
 * Scope of Impl C (this file): on-ramp picker modal, element picker modal,
 * canvas chrome (4-tab nav), Schema tab (field-builder + JSON preview + live
 * Composer skeleton), Start-from-existing on-ramp wiring, autosave.
 * Other on-ramps (Sample / Form / NL): stubs, Impl D.
 * Compose complexity / Rules tab content: stubs, Impl E.
 * Review tab + Publish: stubs, Impl F.
 */

/* ---------- Module state ---------- */

/* Working draft — what Sarah is currently authoring. Mirrors the canonical
 * field-builder model documented in ADR 0039 §5 and FORK_SOURCE_SCHEMAS shape. */
const REG_INITIAL_STATE = Object.freeze({
  mode: 'new',                         // 'new' (greenfield) | 'version' (bump)
  dex: 'tx',                            // captured at flow start; URL-anchored per ADR 0001
  meta: { name: '', description: '', category: '', version: 'v1.0' },
  fields: [],
  governance: { residencyStrict: false },
  composeComplexity: null,             // 'simple' | 'high-stakes' (ADR 0025); null = not yet chosen
  rules: [],                            // ADR 0038 layer 2 — govaluate-style expression rules
  samplePayload: {},                    // sample object for live rule evaluation (Q7 lock)
  pack: null,                           // selected pack id (Q6 lock — sidecar on Review tab)
  source: { onramp: null, forkedFromElementId: null, forkedFromVersion: null },
  currentTab: 'schema',
  modifiedAt: null,
  // Smart Start assist run state (ADR 0040). Populated after the on-ramp
  // hands off; cleared on draft reset. `suggestions` is keyed by id for the
  // chip/popover to look up.
  assist: {
    status: 'idle',                    // 'idle' | 'running' | 'completed' | 'partial' | 'failed'
    suggestions: [],                   // list of Suggestion envelopes
    suggestionsById: {},               // index by id for fast lookup
    fieldIdToSuggestionId: {},         // map regDraft.fields[].id → suggestion.id
    ruleIdToSuggestionId: {},          // map regDraft.rules[].id → suggestion.id
    complexitySuggestionId: null,      // id of the complexity-pick suggestion, if any
    packSuggestionId: null,            // id of the pack-membership suggestion, if any
    runAt: null,
    runFingerprint: null,
    assistVersion: null,
    degradedSources: [],
    // Slice 6 — accept/edit/reject persistence + audit log (ADR 0040 Q8 + Q9).
    acceptStateById: {},               // suggestion.id → 'pending'|'accepted'|'edited'|'rejected'
    auditLog: []                       // append-only event stream (see regAuditLog_append shape)
  }
});

let regDraft = cloneRegState(REG_INITIAL_STATE);

const REG_STORAGE_KEY = 'registerElement.wip';
const REG_AUTOSAVE_DEBOUNCE_MS = 300;
let regAutosaveTimer = null;

function cloneRegState(s) {
  // Structured clone keeps the draft isolated from REG_INITIAL_STATE.
  return JSON.parse(JSON.stringify(s));
}

/* ---------- Field-builder data model + helpers ---------- */

/* Allowed field types for the v1 builder. Conditional schemas (oneOf, if/then)
 * are NOT in this list — they live in the JSON editor only per ADR 0039 §5. */
const REG_FIELD_TYPES = [
  { value: 'string',   label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'integer',  label: 'Integer' },
  { value: 'boolean',  label: 'True / False' },
  { value: 'date',     label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'enum',     label: 'Pick list' },
  { value: 'array',    label: 'List of values' },
  { value: 'object',   label: 'Nested object' }
];

let _regFieldIdCounter = 1;
function regNewFieldId() {
  return 'f_' + String(_regFieldIdCounter++).padStart(3, '0');
}

function regBlankField(name) {
  return {
    id: regNewFieldId(),
    name: name || '',
    type: 'string',
    required: false,
    description: '',
    validation: {},
    group: null
  };
}

/* Serialise the field-builder state to JSON Schema. */
function schemaFromFields(state) {
  const properties = {};
  const required = [];
  (state.fields || []).forEach(f => {
    if (!f.name) return;
    properties[f.name] = fieldToSchemaProperty(f);
    if (f.required) required.push(f.name);
  });
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: state.meta.name || 'Untitled element',
    type: 'object',
    properties: properties
  };
  if (required.length) schema.required = required;
  return schema;
}

function fieldToSchemaProperty(f) {
  const prop = {};
  switch (f.type) {
    case 'string':   prop.type = 'string'; break;
    case 'number':   prop.type = 'number'; break;
    case 'integer':  prop.type = 'integer'; break;
    case 'boolean':  prop.type = 'boolean'; break;
    case 'date':     prop.type = 'string'; prop.format = 'date'; break;
    case 'datetime': prop.type = 'string'; prop.format = 'date-time'; break;
    case 'enum':     prop.type = 'string'; prop.enum = (f.validation && f.validation.enumValues) || []; break;
    case 'array':    prop.type = 'array'; prop.items = { type: 'string' }; break;
    case 'object':   prop.type = 'object'; prop.properties = {}; break;
    default:         prop.type = 'string';
  }
  if (f.description) prop.description = f.description;
  const v = f.validation || {};
  if (v.pattern)   prop.pattern   = v.pattern;
  if (v.minimum !== undefined) prop.minimum = v.minimum;
  if (v.maximum !== undefined) prop.maximum = v.maximum;
  if (v.minLength !== undefined) prop.minLength = v.minLength;
  if (v.maxLength !== undefined) prop.maxLength = v.maxLength;
  if (f.examples && f.examples.length) prop.examples = f.examples;
  return prop;
}

/* Parse a JSON Schema (as produced above, or coming from a fork source) back
 * into the field-builder model. Lossy for constructs the builder can't express
 * (oneOf, allOf, dependencies, deep nesting > 3) — those round-trip via the
 * JSON editor in Impl D/E. */
function fieldsFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const props = schema.properties || {};
  const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out = [];
  Object.keys(props).forEach(name => {
    const p = props[name] || {};
    const f = regBlankField(name);
    f.required = requiredSet.has(name);
    f.description = p.description || '';
    f.examples = p.examples || undefined;
    // Type derivation honours format-hinted dates first, then primitive type.
    if (p.format === 'date')       f.type = 'date';
    else if (p.format === 'date-time') f.type = 'datetime';
    else if (Array.isArray(p.enum) && p.enum.length) { f.type = 'enum'; f.validation.enumValues = p.enum.slice(); }
    else if (p.type === 'array')   f.type = 'array';
    else if (p.type === 'object')  f.type = 'object';
    else if (p.type === 'boolean') f.type = 'boolean';
    else if (p.type === 'integer') f.type = 'integer';
    else if (p.type === 'number')  f.type = 'number';
    else                            f.type = 'string';
    if (p.pattern) f.validation.pattern = p.pattern;
    if (p.minimum !== undefined) f.validation.minimum = p.minimum;
    if (p.maximum !== undefined) f.validation.maximum = p.maximum;
    if (p.minLength !== undefined) f.validation.minLength = p.minLength;
    if (p.maxLength !== undefined) f.validation.maxLength = p.maxLength;
    out.push(f);
  });
  return out;
}

/* ---------- JSON syntax highlighter (inline, ~40 lines, no external dep) ----------
 * Per ADR 0034's no-build-step / no-network-dep constraint. Three classes:
 * .reg-json-key, .reg-json-string, .reg-json-number, .reg-json-keyword (true/false/null). */
function regHighlightJson(jsonText) {
  // Escape HTML first so a string value containing < or & doesn't break markup.
  const esc = jsonText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Match: keys ("foo":), strings ("..."), numbers, true/false/null. Order matters —
  // key match must precede string match because a key IS a string followed by `:`.
  return esc.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'reg-json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'reg-json-key' : 'reg-json-string';
      } else if (/true|false|null/.test(match)) {
        cls = 'reg-json-keyword';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

/* ---------- Autosave ---------- */

function regScheduleAutosave() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (regAutosaveTimer) clearTimeout(regAutosaveTimer);
  regAutosaveTimer = setTimeout(() => {
    try {
      regDraft.modifiedAt = new Date().toISOString();
      window.localStorage.setItem(REG_STORAGE_KEY, JSON.stringify(regDraft));
      regUpdateAutosaveIndicator();
    } catch (e) {
      // Silent — autosave is best-effort. Storage quota or private mode = no-op.
    }
  }, REG_AUTOSAVE_DEBOUNCE_MS);
}

function regLoadAutosaved() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(REG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}

function regClearAutosave() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.removeItem(REG_STORAGE_KEY); } catch (e) { /* ignore */ }
}

function regUpdateAutosaveIndicator() {
  const el = document.querySelector('[data-reg-autosave]');
  if (!el) return;
  if (!regDraft.modifiedAt) { el.textContent = ''; return; }
  el.textContent = 'Work in progress · autosaved';
}

/* ---------- Tab navigation ---------- */

const REG_TABS = ['schema', 'complexity', 'rules', 'review'];

/* User-facing labels for the 4 tabs. Used by the footer prev/next buttons
 * and by toasts that reference tabs by name. Kept here next to REG_TABS so
 * adding a tab in Phase 2 (Routing) is a single-source edit. */
const REG_TAB_LABELS = {
  schema:     'Schema',
  complexity: 'Compose complexity',
  rules:      'Rules',
  review:     'Review'
};

function regSwitchTab(tabId) {
  if (!REG_TABS.includes(tabId)) return;
  regDraft.currentTab = tabId;
  regRenderTabs();
  regRenderTabContent();
  // Render the active tab's content. Schema mounts once on open; complexity/
  // rules re-render every switch because their content reflects current schema
  // state (indicators, sample payload, suggested rules).
  if (typeof regRenderActiveTabContent === 'function') regRenderActiveTabContent();
  regRenderCanvasFooter();
  regScheduleAutosave();
}

/* Renders the footer's prev/next buttons based on the active tab's position
 * in REG_TABS. Schema (first) → no prev, next = Compose complexity. Complexity
 * → prev = Schema, next = Rules. Rules → prev = Compose complexity, next =
 * Review. Review (last) → prev = Rules, no next button — the Publish CTA
 * lives inside the Review tab body and lands in Impl F.
 *
 * "Back to catalogue" stays in the left slot regardless of tab; it's the
 * escape hatch, not a step-back. */
function regRenderCanvasFooter() {
  const prevBtn = document.querySelector('[data-reg-prev-btn]');
  const prevLabel = document.querySelector('[data-reg-prev-label]');
  const nextBtn = document.querySelector('[data-reg-next-btn]');
  const nextLabel = document.querySelector('[data-reg-next-label]');
  if (!prevBtn || !nextBtn) return;

  const idx = REG_TABS.indexOf(regDraft.currentTab);
  const prevTab = idx > 0 ? REG_TABS[idx - 1] : null;
  const nextTab = idx >= 0 && idx < REG_TABS.length - 1 ? REG_TABS[idx + 1] : null;

  if (prevTab) {
    prevBtn.hidden = false;
    if (prevLabel) prevLabel.textContent = REG_TAB_LABELS[prevTab];
    prevBtn.onclick = () => regSwitchTab(prevTab);
  } else {
    prevBtn.hidden = true;
    prevBtn.onclick = null;
  }

  if (nextTab) {
    nextBtn.hidden = false;
    if (nextLabel) nextLabel.textContent = REG_TAB_LABELS[nextTab];
    nextBtn.onclick = () => regSwitchTab(nextTab);
  } else {
    // Review tab — the next-button slot is hidden because the Publish CTA
    // lives inside the Review tab body itself (per Q9 / ADR 0039 §8).
    nextBtn.hidden = true;
    nextBtn.onclick = null;
  }
}

function regRenderTabs() {
  document.querySelectorAll('[data-reg-tab]').forEach(el => {
    const id = el.getAttribute('data-reg-tab');
    el.classList.toggle('active', id === regDraft.currentTab);
    el.setAttribute('aria-selected', id === regDraft.currentTab ? 'true' : 'false');

    // Smart Start assist count badge (ADR 0040 Q14 corollary c).
    // Removed first so re-renders don't accumulate badges.
    const existing = el.querySelector('.reg-tab-assist-count');
    if (existing) existing.parentNode.removeChild(existing);
    const count = (typeof regAssistCountForTab === 'function') ? regAssistCountForTab(id) : 0;
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'reg-tab-assist-count';
      badge.setAttribute('aria-label', count + ' Smart Start assist suggestion' + (count === 1 ? '' : 's'));
      badge.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i>' + count;
      el.appendChild(badge);
    }
  });
}

function regRenderTabContent() {
  document.querySelectorAll('[data-reg-tab-panel]').forEach(panel => {
    panel.hidden = panel.getAttribute('data-reg-tab-panel') !== regDraft.currentTab;
  });
}

/* ---------- Schema tab rendering ---------- */

function regRenderSchemaTab() {
  regRenderHeader();
  regRenderFields();
  regRenderGovernance();
  regRenderJsonPreview();
  regRenderSkeleton();
}

function regRenderHeader() {
  const nameInput = document.getElementById('reg-meta-name');
  const descInput = document.getElementById('reg-meta-description');
  const catInput  = document.getElementById('reg-meta-category');
  const verInput  = document.getElementById('reg-meta-version');
  if (nameInput && nameInput.value !== regDraft.meta.name)              nameInput.value = regDraft.meta.name || '';
  if (descInput && descInput.value !== regDraft.meta.description)        descInput.value = regDraft.meta.description || '';
  if (catInput && catInput.value !== regDraft.meta.category)             catInput.value = regDraft.meta.category || '';
  if (verInput && verInput.value !== regDraft.meta.version)              verInput.value = regDraft.meta.version || 'v1.0';
  // Page title reflects mode: greenfield vs version-of-X.
  const title = document.querySelector('[data-reg-page-title]');
  if (title) {
    if (regDraft.mode === 'version' && regDraft.source.forkedFromElementId) {
      const src = FORK_SOURCE_SCHEMAS[regDraft.source.forkedFromElementId];
      const name = src ? src.name : 'element';
      title.textContent = 'New version of ' + name;
    } else {
      title.textContent = regDraft.meta.name ? regDraft.meta.name : 'New element';
    }
  }
}

function regRenderFields() {
  const list = document.querySelector('[data-reg-field-list]');
  if (!list) return;
  list.innerHTML = '';
  // If the draft carries the grouping inferred during on-ramp extraction,
  // render group headings above each cluster. Groups appear in the order
  // recorded in _groupOrder so the layout matches the schema preview shown
  // before the user clicked "Use this schema". Ungrouped fields (e.g. added
  // later via "Add field") render under an "Other fields" trailing block.
  const groups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (groups.length) {
    const fieldsByGroup = new Map();
    const ungrouped = [];
    groups.forEach(g => fieldsByGroup.set(g.name, []));
    regDraft.fields.forEach((f, idx) => {
      const g = f.group;
      if (g && fieldsByGroup.has(g)) fieldsByGroup.get(g).push({ f, idx });
      else ungrouped.push({ f, idx });
    });
    groups.forEach(g => {
      const items = fieldsByGroup.get(g.name) || [];
      if (!items.length) return;
      list.appendChild(regBuildFieldGroupHeading(g, items.length));
      items.forEach(({ f, idx }) => list.appendChild(regBuildFieldRow(f, idx)));
    });
    if (ungrouped.length) {
      list.appendChild(regBuildFieldGroupHeading({ name: 'Other fields', rationale: '' }, ungrouped.length));
      ungrouped.forEach(({ f, idx }) => list.appendChild(regBuildFieldRow(f, idx)));
    }
  } else {
    regDraft.fields.forEach((f, idx) => list.appendChild(regBuildFieldRow(f, idx)));
  }
  // Empty-state message
  const empty = document.querySelector('[data-reg-field-empty]');
  if (empty) empty.hidden = regDraft.fields.length > 0;
}

function regBuildFieldGroupHeading(group, count) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-field-group-heading';
  const title = document.createElement('div');
  title.className = 'reg-field-group-heading-title';
  title.textContent = group.name;
  const badge = document.createElement('span');
  badge.className = 'reg-field-group-heading-count';
  badge.textContent = count;
  title.appendChild(badge);
  wrap.appendChild(title);
  if (group.rationale) {
    const desc = document.createElement('div');
    desc.className = 'reg-field-group-heading-rationale';
    desc.textContent = group.rationale;
    wrap.appendChild(desc);
  }
  return wrap;
}

function regBuildFieldRow(field, idx) {
  const row = document.createElement('div');
  row.className = 'reg-field-row';
  row.setAttribute('data-field-id', field.id);

  // Drag handle (visual only in Impl C; drag-reorder wires in Impl D polish)
  const handle = document.createElement('span');
  handle.className = 'reg-field-handle';
  handle.innerHTML = '<i class="ti ti-grip-vertical"></i>';
  handle.setAttribute('aria-hidden', 'true');
  row.appendChild(handle);

  // Name input
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'reg-field-name-input';
  nameInput.value = field.name;
  nameInput.placeholder = 'field_name';
  nameInput.setAttribute('aria-label', 'Field name');
  nameInput.addEventListener('input', () => {
    field.name = nameInput.value.trim().replace(/\s+/g, '_').toLowerCase();
    // Slice 6 — divergence from suggestion stamps 'edited' state + audit event.
    const sug = (typeof regAssistSuggestionForField === 'function')
      ? regAssistSuggestionForField(field) : null;
    if (sug) regAssist_maybeTrackEdit(sug, field);
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(nameInput);

  // Type select
  const typeSel = document.createElement('select');
  typeSel.className = 'reg-field-type-select';
  typeSel.setAttribute('aria-label', 'Field type');
  REG_FIELD_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.value;
    opt.textContent = t.label;
    if (t.value === field.type) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', () => {
    field.type = typeSel.value;
    const sug = (typeof regAssistSuggestionForField === 'function')
      ? regAssistSuggestionForField(field) : null;
    if (sug) regAssist_maybeTrackEdit(sug, field);
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(typeSel);

  // Required toggle
  const reqWrap = document.createElement('label');
  reqWrap.className = 'reg-field-required';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.checked = !!field.required;
  reqCheck.setAttribute('aria-label', 'Required field');
  reqCheck.addEventListener('change', () => {
    field.required = reqCheck.checked;
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  reqWrap.appendChild(reqCheck);
  reqWrap.appendChild(document.createTextNode('Required'));
  row.appendChild(reqWrap);

  // Description (inline below name input in narrow layouts; visible always for now)
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'reg-field-description-input';
  descInput.value = field.description || '';
  descInput.placeholder = 'Description (optional)';
  descInput.setAttribute('aria-label', 'Field description');
  descInput.addEventListener('input', () => {
    field.description = descInput.value;
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  row.appendChild(descInput);

  // Smart Start assist provenance chip (ADR 0040 Q14) — injected before the
  // delete button when this field has an associated assist suggestion.
  const assistSuggestion = regAssistSuggestionForField(field);
  if (assistSuggestion && typeof window.smartStartUi_buildChip === 'function') {
    const chip = window.smartStartUi_buildChip(assistSuggestion, {
      dexId: regDraft.dex,
      acceptState: regAssistAcceptStateForField(field)
    });
    row.appendChild(chip);
    row.classList.add('reg-field-row-has-assist');
  }

  // Delete button
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'reg-field-delete';
  del.setAttribute('aria-label', 'Delete field ' + (field.name || '(unnamed)'));
  del.innerHTML = '<i class="ti ti-trash"></i>';
  del.addEventListener('click', () => {
    regDraft.fields.splice(idx, 1);
    if (regDraft.assist && regDraft.assist.fieldIdToSuggestionId) {
      delete regDraft.assist.fieldIdToSuggestionId[field.id];
    }
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(del);

  // If the assist suggestion has caveats, wrap row + caveat banner together
  // so the banner renders above the field (per ADR 0040 Q14 corollary —
  // caveats must be visible without opening the popover).
  if (assistSuggestion && (assistSuggestion.caveats || []).length &&
      typeof window.smartStartUi_buildCaveatBanner === 'function') {
    const wrap = document.createElement('div');
    wrap.className = 'reg-field-row-assisted';
    wrap.setAttribute('data-field-id', field.id);
    const banner = window.smartStartUi_buildCaveatBanner(assistSuggestion);
    if (banner) wrap.appendChild(banner);
    wrap.appendChild(row);
    return wrap;
  }

  return row;
}

/* ---------- Smart Start assist integration (ADR 0040) ---------- */

/* Audit log — append-only event stream per ADR 0040 Q9. Events carry their
 * own ids so a future audit-log UI surface can address individual entries.
 * The log persists via the existing autosave path. */
function regAuditLog_newEventId() {
  return 'evt_' + Math.random().toString(36).slice(2, 11);
}

function regAuditLog_append(eventType, actor, payload) {
  if (!regDraft.assist) return null;
  if (!Array.isArray(regDraft.assist.auditLog)) regDraft.assist.auditLog = [];
  const evt = {
    eventId:   regAuditLog_newEventId(),
    eventType: eventType,
    timestamp: new Date().toISOString(),
    actor:     actor || 'unknown',
    payload:   payload || {}
  };
  regDraft.assist.auditLog.push(evt);
  return evt;
}

function regAuditLog_list() {
  return ((regDraft.assist && regDraft.assist.auditLog) || []).slice();
}

/* Convenience — current accept-state for a suggestion id. */
function regAssist_acceptStateFor(suggestionId) {
  if (!suggestionId || !regDraft.assist) return 'pending';
  return (regDraft.assist.acceptStateById && regDraft.assist.acceptStateById[suggestionId]) || 'pending';
}

function regAssist_setAcceptState(suggestionId, state) {
  if (!regDraft.assist) return;
  if (!regDraft.assist.acceptStateById) regDraft.assist.acceptStateById = {};
  regDraft.assist.acceptStateById[suggestionId] = state;
}

/* Mark the draft as having an in-flight assist run. Called from
 * registerOnramp_completeWithSeed before the engine call.
 * Slice 6: emits an assist-run-triggered audit event. */
function regBeginAssistRun() {
  if (!regDraft.assist) return;
  regDraft.assist.status = 'running';
  regAuditLog_append('assist-run-triggered', 'engine', {
    onramp: regDraft.source && regDraft.source.onramp,
    dexId:  regDraft.dex
  });
}

/* Render the degradation banner above the tab content. Slice 5 surfaces live
 * API failures + partial-run states per ADR 0040 Q10. Hidden when status is
 * 'completed' and degradedSources is empty.
 */
function regRenderAssistDegradationBanner() {
  const banner = document.getElementById('reg-assist-degradation-banner');
  if (!banner) return;
  const assist = regDraft.assist || {};
  const degraded = (assist.degradedSources || []).slice();
  const status = assist.status;
  if (!degraded.length && status !== 'partial' && status !== 'failed') {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  let msg, hint, isFailed = false;
  if (status === 'failed') {
    isFailed = true;
    msg = 'Smart Start assist could not run.';
    hint = 'Continue authoring manually or retry the on-ramp.';
  } else {
    msg = 'Smart Start assist ran with reduced inputs';
    hint = 'Affected sources: ' + degraded.join(', ') + '. Suggestions shown are grounded in what was reachable.';
  }
  banner.classList.toggle('is-failed', isFailed);
  banner.innerHTML =
    '<i class="ti ti-alert-triangle reg-assist-degradation-icon"></i>' +
    '<div class="reg-assist-degradation-text">' +
      '<strong>' + escapeHtml(msg) + '</strong>' +
      '<span class="reg-assist-degradation-hint"> · ' + escapeHtml(hint) + '</span>' +
    '</div>';
}

/* Apply the result of an assist run to the draft state. For Slice 1 this:
 *   - Stores the suggestions list + run metadata on regDraft.assist
 *   - Indexes suggestions by id for fast lookup
 *   - Links each schema/field suggestion to a matching field in regDraft.fields
 *     (by name). Unmatched field-suggestions are appended as new fields, so
 *     the engine can introduce fields the seed didn't have.
 *   - Re-renders the Schema tab + tab labels.
 */
function regApplyAssistRun(result) {
  if (!regDraft.assist) regDraft.assist = { suggestionsById: {}, fieldIdToSuggestionId: {} };
  const assist = regDraft.assist;
  result = result || {};
  assist.status         = result.status || 'completed';
  assist.runAt          = result.runAt || new Date().toISOString();
  assist.runFingerprint = result.runFingerprint || null;
  assist.assistVersion  = result.assistVersion || null;
  assist.degradedSources = result.degradedSources || [];
  assist.suggestions    = (result.suggestions || []).slice();
  assist.suggestionsById = {};
  assist.fieldIdToSuggestionId = {};

  // Index by id.
  assist.suggestions.forEach(s => { assist.suggestionsById[s.id] = s; });

  // Reset the per-target linkage maps before re-applying.
  assist.ruleIdToSuggestionId = {};
  assist.complexitySuggestionId = null;
  assist.packSuggestionId = null;
  // Slice 6 — accept-state map gets fresh entries per suggestion (pending by
  // default). We preserve any prior 'rejected' entries so a re-run doesn't
  // resurrect previously-rejected suggestions silently (Q8 corollary c).
  const priorAccept = assist.acceptStateById || {};
  assist.acceptStateById = {};
  assist.suggestions.forEach(s => {
    // If Sarah rejected this exact suggestion previously, carry that state
    // forward — re-runs don't undo deliberate human rejections.
    assist.acceptStateById[s.id] = priorAccept[s.id] === 'rejected' ? 'rejected' : 'pending';
  });

  // Audit: one suggestion-emitted event per suggestion.
  assist.suggestions.forEach(s => {
    regAuditLog_append('suggestion-emitted', 'engine', {
      suggestionId: s.id, tab: s.tab, kind: s.kind, confidence: s.confidence
    });
  });

  // Wire each schema/field suggestion to an existing field by name, or append
  // a new field for unmatched suggestions. The engine's grounding constraint
  // ensures every suggestion is defensible; we surface all of them.
  const fieldsByName = {};
  regDraft.fields.forEach(f => { if (f.name) fieldsByName[f.name] = f; });

  assist.suggestions.forEach(s => {
    // Slice 6 — skip applying previously-rejected suggestions per ADR 0040
    // Q8 corollary c. They stay in suggestionsById (the graveyard) and the
    // audit log preserves the rejection history; they don't get re-applied.
    if (assist.acceptStateById[s.id] === 'rejected') return;

    if (s.tab === 'schema' && s.kind === 'field') {
      const targetName = (s.payload && s.payload.name) || null;
      if (!targetName) return;
      let field = fieldsByName[targetName];
      if (!field) {
        // New field introduced by assist — append.
        field = regBlankField(targetName);
        // Seed-aligned fields take their meaningful defaults from the suggestion
        // payload. Sarah can edit any of these via the standard row inputs.
        if (s.payload.type) field.type = s.payload.type;
        if (typeof s.payload.required === 'boolean') field.required = s.payload.required;
        if (s.payload.description) field.description = s.payload.description;
        if (s.payload.validation) field.validation = Object.assign({}, s.payload.validation);
        if (s.payload.examples || s.payload.exampleValues) {
          field.examples = (s.payload.examples || s.payload.exampleValues).slice();
        }
        regDraft.fields.push(field);
        fieldsByName[targetName] = field;
      }
      assist.fieldIdToSuggestionId[field.id] = s.id;
      return;
    }

    if (s.tab === 'complexity' && s.kind === 'complexity-pick') {
      // Per Q5: pre-fill the suggestion so Sarah sees the engine's draft, but
      // never overwrite an explicit choice she already made.
      if (!regDraft.composeComplexity && s.payload && s.payload.choice) {
        regDraft.composeComplexity = s.payload.choice;
      }
      assist.complexitySuggestionId = s.id;
      return;
    }

    if (s.tab === 'pack' && s.kind === 'pack-membership') {
      if (!regDraft.pack && s.payload && s.payload.packId) {
        regDraft.pack = s.payload.packId;
      }
      assist.packSuggestionId = s.id;
      return;
    }

    if (s.tab === 'rules' && s.kind === 'validation-rule') {
      // Append a rule mirroring the suggestion payload. The link from rule.id
      // back to the suggestion id lets the chip render in regBuildRuleEditor.
      const rule = {
        id: 'r_' + Math.random().toString(36).slice(2, 9),
        name: (s.payload && s.payload.name) || '',
        expression: (s.payload && s.payload.expression) || '',
        on_failure: (s.payload && s.payload.on_failure) || '',
        applies_at: (s.payload && s.payload.appliesAt) || 'validation',
        scope: (s.payload && s.payload.scope) || null
      };
      regDraft.rules = regDraft.rules || [];
      regDraft.rules.push(rule);
      assist.ruleIdToSuggestionId[rule.id] = s.id;
      return;
    }
  });

  // Re-render every tab so chips, caveat banners, and badges appear wherever
  // suggestions landed.
  if (typeof regRenderFields === 'function') regRenderFields();
  if (typeof regRenderJsonPreview === 'function') regRenderJsonPreview();
  if (typeof regRenderSkeleton === 'function') regRenderSkeleton();
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  if (typeof regRenderTabs === 'function') regRenderTabs();
  if (typeof regRenderAssistDegradationBanner === 'function') regRenderAssistDegradationBanner();
  if (typeof regScheduleAutosave === 'function') regScheduleAutosave();
}

/* Look up the suggestion attached to a given rule.id. Returns null if the rule
 * wasn't sourced from assist. */
function regAssistSuggestionForRule(rule) {
  if (!rule || !regDraft.assist || !regDraft.assist.ruleIdToSuggestionId) return null;
  const sid = regDraft.assist.ruleIdToSuggestionId[rule.id];
  if (!sid) return null;
  return regDraft.assist.suggestionsById[sid] || null;
}

/* Look up the active Complexity / Pack suggestions. */
function regAssistComplexitySuggestion() {
  if (!regDraft.assist || !regDraft.assist.complexitySuggestionId) return null;
  return regDraft.assist.suggestionsById[regDraft.assist.complexitySuggestionId] || null;
}
function regAssistPackSuggestion() {
  if (!regDraft.assist || !regDraft.assist.packSuggestionId) return null;
  return regDraft.assist.suggestionsById[regDraft.assist.packSuggestionId] || null;
}

/* Resolve a field → suggestion lookup. Returns null when the field wasn't
 * sourced from assist. */
function regAssistSuggestionForField(field) {
  if (!field || !regDraft.assist || !regDraft.assist.fieldIdToSuggestionId) return null;
  const sid = regDraft.assist.fieldIdToSuggestionId[field.id];
  if (!sid) return null;
  return regDraft.assist.suggestionsById[sid] || null;
}

/* Return the accept-state for a field's assist suggestion. Slice 6 reads
 * from the persisted regDraft.assist.acceptStateById map. */
function regAssistAcceptStateForField(field) {
  const sid = field && regDraft.assist && regDraft.assist.fieldIdToSuggestionId
    ? regDraft.assist.fieldIdToSuggestionId[field.id]
    : null;
  if (!sid) return 'pending';
  return regAssist_acceptStateFor(sid);
}

/* ---------- Slice 6: Accept / Edit / Reject lifecycle ---------- */

/* The chip popover (smart-start-assist-ui.js) delegates here. This function
 * knows about regDraft and the audit log; the UI module stays presentation
 * only. */
function regAssist_handleAction(suggestion, action) {
  if (!suggestion || !regDraft.assist) return;
  if (action === 'accept')  return regAssist_acceptSuggestion(suggestion);
  if (action === 'reject')  return regAssist_rejectSuggestion(suggestion);
  if (action === 'edit')    return regAssist_beginEdit(suggestion);
  if (action === 'audit')   return regAssist_openAuditDetail(suggestion);
}

function regAssist_acceptSuggestion(suggestion) {
  regAssist_setAcceptState(suggestion.id, 'accepted');
  regAuditLog_append('suggestion-accepted', 'operator', {
    suggestionId: suggestion.id, tab: suggestion.tab, kind: suggestion.kind
  });
  regAssist_rerenderAll();
  regScheduleAutosave();
  if (typeof toast === 'function') {
    toast('Accepted · ' + regAssist_suggestionDisplay(suggestion));
  }
}

function regAssist_rejectSuggestion(suggestion) {
  regAssist_setAcceptState(suggestion.id, 'rejected');

  // Drop the artefact the suggestion put in the draft. The suggestion itself
  // stays in suggestionsById (graveyard) so a re-run can recognise it.
  if (suggestion.tab === 'schema' && suggestion.kind === 'field') {
    const fieldId = Object.keys(regDraft.assist.fieldIdToSuggestionId || {})
      .find(fid => regDraft.assist.fieldIdToSuggestionId[fid] === suggestion.id);
    if (fieldId) {
      regDraft.fields = (regDraft.fields || []).filter(f => f.id !== fieldId);
      delete regDraft.assist.fieldIdToSuggestionId[fieldId];
    }
  } else if (suggestion.tab === 'rules' && suggestion.kind === 'validation-rule') {
    const ruleId = Object.keys(regDraft.assist.ruleIdToSuggestionId || {})
      .find(rid => regDraft.assist.ruleIdToSuggestionId[rid] === suggestion.id);
    if (ruleId) {
      regDraft.rules = (regDraft.rules || []).filter(r => r.id !== ruleId);
      delete regDraft.assist.ruleIdToSuggestionId[ruleId];
    }
  } else if (suggestion.tab === 'complexity' && suggestion.kind === 'complexity-pick') {
    // Only revert if the current pick still matches what assist suggested AND
    // Sarah hasn't already chosen something different.
    if (regDraft.composeComplexity === (suggestion.payload && suggestion.payload.choice)) {
      regDraft.composeComplexity = null;
    }
    regDraft.assist.complexitySuggestionId = null;
  } else if (suggestion.tab === 'pack' && suggestion.kind === 'pack-membership') {
    if (regDraft.pack === (suggestion.payload && suggestion.payload.packId)) {
      regDraft.pack = null;
    }
    regDraft.assist.packSuggestionId = null;
  }

  regAuditLog_append('suggestion-rejected', 'operator', {
    suggestionId: suggestion.id, tab: suggestion.tab, kind: suggestion.kind
  });
  regAssist_rerenderAll();
  regScheduleAutosave();
  if (typeof toast === 'function') {
    toast('Rejected · ' + regAssist_suggestionDisplay(suggestion));
  }
}

function regAssist_beginEdit(suggestion) {
  // Close the popover and steer Sarah toward the right input. The 'edited'
  // state is set later, on the first input divergence (regAssist_maybeTrackEdit).
  if (suggestion.tab === 'schema' && suggestion.kind === 'field') {
    const fieldId = Object.keys(regDraft.assist.fieldIdToSuggestionId || {})
      .find(fid => regDraft.assist.fieldIdToSuggestionId[fid] === suggestion.id);
    if (fieldId) {
      // Find the name input for this row and focus it.
      const row = document.querySelector('.reg-field-row[data-field-id="' + fieldId + '"]');
      const nameInput = row && row.querySelector('.reg-field-name-input');
      if (nameInput) {
        // Switch to Schema tab first if not already.
        if (regDraft.currentTab !== 'schema' && typeof regSwitchTab === 'function') {
          regSwitchTab('schema');
        }
        setTimeout(() => nameInput.focus(), 50);
      }
    }
  } else if (suggestion.tab === 'rules' && suggestion.kind === 'validation-rule') {
    const ruleId = Object.keys(regDraft.assist.ruleIdToSuggestionId || {})
      .find(rid => regDraft.assist.ruleIdToSuggestionId[rid] === suggestion.id);
    if (ruleId) {
      if (regDraft.currentTab !== 'rules' && typeof regSwitchTab === 'function') {
        regSwitchTab('rules');
      }
      const node = document.querySelector('.reg-rule[data-rule-id="' + ruleId + '"] .reg-rule-name');
      if (node) setTimeout(() => node.focus(), 50);
    }
  }
  // No state change yet — that happens on first divergence.
}

function regAssist_openAuditDetail(suggestion) {
  // The full audit-log UI is post-v1 (ADR 0040 Q9). For now we log to the
  // console so power-users can inspect, and toast a pointer.
  console.info('[smart-start-assist] audit detail for ' + suggestion.id, {
    suggestion: suggestion,
    acceptState: regAssist_acceptStateFor(suggestion.id),
    auditLog: (regAuditLog_list() || []).filter(e =>
      e.payload && e.payload.suggestionId === suggestion.id
    )
  });
  if (typeof toast === 'function') {
    toast('Audit detail logged to console · full surface in Phase 2');
  }
}

/* Compare the current state of an artefact with the suggestion's payload and,
 * if Sarah has changed something, stamp acceptState='edited' + log it. Called
 * from input change handlers on field rows + rule editors. Idempotent —
 * already-edited suggestions don't re-emit the event. */
function regAssist_maybeTrackEdit(suggestion, current) {
  if (!suggestion || !suggestion.payload || !regDraft.assist) return;
  const sid = suggestion.id;
  const state = regAssist_acceptStateFor(sid);
  // Already-accepted or already-edited don't re-emit; rejected suggestions
  // are gone from the active state altogether.
  if (state === 'edited' || state === 'rejected') return;
  if (!regAssist_payloadDivergedFromCurrent(suggestion.payload, current)) return;
  regAssist_setAcceptState(sid, 'edited');
  regAuditLog_append('suggestion-edited', 'operator', {
    suggestionId: sid, tab: suggestion.tab, kind: suggestion.kind
  });
}

/* Shallow divergence check — compares each property the suggestion payload
 * carries against the corresponding property in the current artefact. */
function regAssist_payloadDivergedFromCurrent(payload, current) {
  if (!payload || !current) return false;
  // Compare common scalar fields directly.
  const keys = ['name', 'type', 'required', 'description', 'expression', 'on_failure'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (payload[k] === undefined) continue;
    if (JSON.stringify(payload[k]) !== JSON.stringify(current[k])) return true;
  }
  return false;
}

function regAssist_suggestionDisplay(s) {
  const p = s.payload || {};
  if (s.kind === 'field')           return p.name || 'field';
  if (s.kind === 'validation-rule') return p.name || 'rule';
  if (s.kind === 'complexity-pick') return 'complexity: ' + (p.choice || '');
  if (s.kind === 'pack-membership') return 'pack: ' + (p.packName || '');
  return s.id;
}

function regAssist_rerenderAll() {
  if (typeof regRenderFields === 'function') regRenderFields();
  if (typeof regRenderJsonPreview === 'function') regRenderJsonPreview();
  if (typeof regRenderSkeleton === 'function') regRenderSkeleton();
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  if (typeof regRenderTabs === 'function') regRenderTabs();
}

if (typeof window !== 'undefined') {
  window.regAssist_handleAction = regAssist_handleAction;
  window.regAssist_acceptStateFor = regAssist_acceptStateFor;
  window.regAssist_maybeTrackEdit = regAssist_maybeTrackEdit;
  window.regAuditLog_list = regAuditLog_list;
  // Console power-user helpers — same shape as smart-start-assist-live.js.
  window.smartStart = window.smartStart || {};
  window.smartStart.getAuditLog = regAuditLog_list;
}

/* Count of suggestions on a given tab — used for tab-label badges.
 * The Review tab is a sidecar host for the Pack picker (ADR 0039 §5);
 * pack-membership suggestions are counted toward Review since that's where
 * they render. */
function regAssistCountForTab(tab) {
  if (!regDraft.assist) return 0;
  const suggestions = regDraft.assist.suggestions || [];
  if (tab === 'review') {
    return suggestions.filter(s => s.tab === 'pack' || s.tab === 'review').length;
  }
  return suggestions.filter(s => s.tab === tab).length;
}

function regAddField() {
  regDraft.fields.push(regBlankField());
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  // Focus the new row's name input for fast typing.
  setTimeout(() => {
    const rows = document.querySelectorAll('[data-reg-field-list] .reg-field-row');
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    const input = last.querySelector('.reg-field-name-input');
    if (input) input.focus();
  }, 20);
}

function regRenderGovernance() {
  const check = document.getElementById('reg-residency-strict');
  if (!check) return;
  check.checked = !!regDraft.governance.residencyStrict;
  // Note: the downstream lock on the Compose complexity step (per Q11) wires
  // in Impl E. For Impl C the toggle just persists state.
}

function regRenderJsonPreview() {
  const target = document.querySelector('[data-reg-json-preview]');
  if (!target) return;
  const schema = schemaFromFields(regDraft);
  const text = JSON.stringify(schema, null, 2);
  target.innerHTML = regHighlightJson(text);
}

function regRenderSkeleton() {
  const target = document.querySelector('[data-reg-skeleton]');
  if (!target) return;
  target.innerHTML = '';

  // Skeleton transforms based on compose_complexity choice (Q5/Q8 lock).
  // Per ADR 0025: simple = single-page form, high-stakes = 3-step wizard with
  // a Review step. The transformation is the visceral feedback that makes the
  // complexity choice meaningful — flipping a card on the Compose complexity
  // tab visibly reshapes what operators will see.
  const isHighStakes = regDraft.composeComplexity === 'high-stakes';
  const compositeWrap = document.createElement('div');
  compositeWrap.className = 'reg-skeleton-composer' + (isHighStakes ? ' is-high-stakes' : '');

  if (isHighStakes) {
    const stepper = document.createElement('div');
    stepper.className = 'reg-skeleton-stepper';
    stepper.innerHTML = '<span class="reg-skeleton-step is-active">1 Fill</span><span class="reg-skeleton-step">2 Review</span><span class="reg-skeleton-step">3 Submit</span>';
    compositeWrap.appendChild(stepper);
  }

  if (!regDraft.fields.length) {
    const hint = document.createElement('div');
    hint.className = 'reg-skeleton-empty';
    hint.textContent = 'Add a field to see the Composer preview.';
    compositeWrap.appendChild(hint);
    target.appendChild(compositeWrap);
    return;
  }

  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'reg-skeleton-fields';

  // Mirror the Schema-tab grouping in the composer skeleton so the operator
  // sees the same logical structure the AI inferred at extraction time — not
  // just a flat list of inputs that loses all sense of "Applicant info /
  // Employment history / References" sections.
  const renderField = (f) => {
    if (!f.name) return;
    const wrap = document.createElement('label');
    wrap.className = 'reg-skeleton-field';
    const lbl = document.createElement('span');
    lbl.className = 'reg-skeleton-label';
    lbl.textContent = humanizeFieldName(f.name) + (f.required ? ' *' : '');
    wrap.appendChild(lbl);
    wrap.appendChild(regBuildSkeletonInput(f));
    if (f.description) {
      const hint = document.createElement('span');
      hint.className = 'reg-skeleton-hint';
      hint.textContent = f.description;
      wrap.appendChild(hint);
    }
    fieldsWrap.appendChild(wrap);
  };

  const groups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (groups.length) {
    const fieldsByGroup = new Map();
    const ungrouped = [];
    groups.forEach(g => fieldsByGroup.set(g.name, []));
    regDraft.fields.forEach(f => {
      const g = f.group;
      if (g && fieldsByGroup.has(g)) fieldsByGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    groups.forEach(g => {
      const list = fieldsByGroup.get(g.name) || [];
      if (!list.length) return;
      const heading = document.createElement('div');
      heading.className = 'reg-skeleton-group-heading';
      heading.textContent = g.name;
      const count = document.createElement('span');
      count.className = 'reg-skeleton-group-count';
      count.textContent = list.length;
      heading.appendChild(count);
      fieldsWrap.appendChild(heading);
      list.forEach(renderField);
    });
    if (ungrouped.length) {
      const heading = document.createElement('div');
      heading.className = 'reg-skeleton-group-heading';
      heading.textContent = 'Other fields';
      const count = document.createElement('span');
      count.className = 'reg-skeleton-group-count';
      count.textContent = ungrouped.length;
      heading.appendChild(count);
      fieldsWrap.appendChild(heading);
      ungrouped.forEach(renderField);
    }
  } else {
    regDraft.fields.forEach(renderField);
  }
  compositeWrap.appendChild(fieldsWrap);

  // Footer pill — names the complexity that's being previewed.
  const footer = document.createElement('div');
  footer.className = 'reg-skeleton-footer';
  if (isHighStakes) {
    footer.innerHTML = '<span class="complexity-pill high-stakes">high-stakes</span><span class="reg-skeleton-cta">Continue →</span>';
  } else if (regDraft.composeComplexity === 'simple') {
    footer.innerHTML = '<span class="complexity-pill simple">simple</span><span class="reg-skeleton-cta">Submit</span>';
  } else {
    footer.innerHTML = '<span class="reg-skeleton-cta-hint">Pick a complexity on the next tab to see the shape</span>';
  }
  compositeWrap.appendChild(footer);

  target.appendChild(compositeWrap);
}

function regBuildSkeletonInput(f) {
  let el;
  switch (f.type) {
    case 'number':
    case 'integer':
      el = document.createElement('input');
      el.type = 'number';
      if (f.validation && f.validation.minimum !== undefined) el.min = f.validation.minimum;
      if (f.validation && f.validation.maximum !== undefined) el.max = f.validation.maximum;
      break;
    case 'date':
      el = document.createElement('input');
      el.type = 'date';
      break;
    case 'datetime':
      el = document.createElement('input');
      el.type = 'datetime-local';
      break;
    case 'boolean':
      el = document.createElement('input');
      el.type = 'checkbox';
      break;
    case 'enum':
      el = document.createElement('select');
      ((f.validation && f.validation.enumValues) || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        el.appendChild(opt);
      });
      break;
    case 'array':
    case 'object':
      el = document.createElement('input');
      el.type = 'text';
      el.placeholder = f.type === 'array' ? 'Comma-separated list' : 'Nested object — editor in Impl E';
      el.disabled = (f.type === 'object');
      break;
    default:
      el = document.createElement('input');
      el.type = 'text';
      if (f.validation && f.validation.pattern) el.pattern = f.validation.pattern;
  }
  el.className = 'reg-skeleton-input';
  if (f.examples && f.examples.length) el.placeholder = String(f.examples[0]);
  return el;
}

function humanizeFieldName(snake) {
  if (!snake) return '';
  return snake.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ---------- On-ramp picker (modal) ---------- */

function regOpenOnrampPicker() {
  // Resume prompt — if there's an existing autosaved draft, ask before clobbering.
  const existing = regLoadAutosaved();
  if (existing && existing.fields && existing.fields.length > 0) {
    const ageMin = existing.modifiedAt ? Math.round((Date.now() - new Date(existing.modifiedAt).getTime()) / 60000) : null;
    const ageCopy = ageMin === null ? '' : (ageMin < 1 ? ' (autosaved moments ago)' : ' (autosaved ' + ageMin + ' min ago)');
    if (typeof window.confirm === 'function' && window.confirm('You have a work-in-progress element' + ageCopy + '. Continue with it?\\n\\nOK = continue · Cancel = start fresh')) {
      regDraft = existing;
      regOpenCanvas();
      return;
    }
    regClearAutosave();
  }
  regResetDraft('new');
  if (typeof openOverlay === 'function') openOverlay('register-onramp-picker');
}

function regCloseOnrampPicker() {
  if (typeof closeOverlay === 'function') closeOverlay('register-onramp-picker');
}

function regSelectOnramp(onramp) {
  regDraft.source.onramp = onramp;
  regCloseOnrampPicker();
  if (onramp === 'fork') {
    regOpenElementPicker('new');
  } else if (onramp === 'scratch') {
    regOpenCanvas();
  } else {
    // sample / form / nl — Impl D
    if (typeof toast === 'function') {
      toast('"' + onramp + '" on-ramp lands in Impl D');
    }
    // Open the canvas anyway with empty state so the chrome is exercised.
    regOpenCanvas();
  }
}

/* ---------- Element picker (modal — for fork + new-version flows) ---------- */

function regOpenElementPicker(mode) {
  // mode: 'new' (fork into new element) or 'version' (bump an existing element)
  regDraft.mode = mode;
  regRenderElementPicker();
  if (typeof openOverlay === 'function') openOverlay('register-element-picker');
}

function regCloseElementPicker() {
  if (typeof closeOverlay === 'function') closeOverlay('register-element-picker');
}

function regRenderElementPicker() {
  const list = document.querySelector('[data-reg-element-picker-list]');
  if (!list) return;
  list.innerHTML = '';
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexCatalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined' && DATA_ELEMENTS_BY_DEX[dexCode]) || { groups: [] };

  (dexCatalog.groups || []).forEach(group => {
    const elements = (group.elements || []).filter(e => e.kind === 'leaf');
    if (!elements.length) return;
    const groupEl = document.createElement('div');
    groupEl.className = 'reg-picker-group';
    const head = document.createElement('div');
    head.className = 'reg-picker-group-head';
    head.textContent = group.name;
    groupEl.appendChild(head);
    elements.forEach(elem => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'reg-picker-row';
      const id = elem.id || regDeriveIdFromName(elem.name);
      row.setAttribute('data-element-id', id);
      const hasSchema = !!FORK_SOURCE_SCHEMAS[id];
      row.innerHTML =
        '<span class="reg-picker-name">' + escapeHtml(elem.name) + '</span>' +
        '<span class="reg-picker-version">' + escapeHtml(elem.version || '') + '</span>' +
        '<span class="reg-picker-meta">' + (hasSchema ? 'Full schema' : 'Placeholder schema') + '</span>';
      row.addEventListener('click', () => regForkFromElement(id, elem.name, elem.version));
      groupEl.appendChild(row);
    });
    list.appendChild(groupEl);
  });
}

function regDeriveIdFromName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function regForkFromElement(elementId, elementName, fromVersion) {
  const source = FORK_SOURCE_SCHEMAS[elementId];
  if (source) {
    regDraft.fields = source.fields.map(f => Object.assign(regBlankField(f.name), f, { id: regNewFieldId() }));
    regDraft.meta.name = (regDraft.mode === 'version') ? source.name : ('Copy of ' + source.name);
    regDraft.meta.version = (regDraft.mode === 'version') ? bumpVersion(fromVersion || source.latestVersion) : 'v1.0';
  } else {
    // No fork-source schema available — start with a placeholder field and a note.
    regDraft.fields = [
      Object.assign(regBlankField('placeholder_field'), {
        description: 'Placeholder — full schema for ' + (elementName || 'this element') + ' not yet wired in the prototype (ADR 0039 §10).',
        required: false
      })
    ];
    regDraft.meta.name = (regDraft.mode === 'version') ? (elementName || 'Element') : ('Copy of ' + (elementName || 'element'));
    regDraft.meta.version = (regDraft.mode === 'version') ? bumpVersion(fromVersion || 'v1.0') : 'v1.0';
  }
  regDraft.source.forkedFromElementId = elementId;
  regDraft.source.forkedFromVersion = fromVersion || (source && source.latestVersion) || null;
  regDraft.source.onramp = 'fork';
  regCloseElementPicker();
  regOpenCanvas();
}

function bumpVersion(v) {
  // Accept v1.0 / v1.2.3 / 1.0 / 2.0 — bump the LAST numeric segment by 1.
  const m = String(v || '').match(/^(v)?(.*?)([0-9]+)$/);
  if (!m) return 'v1.1';
  const prefix = (m[1] || 'v') + m[2];
  const next = parseInt(m[3], 10) + 1;
  return prefix + next;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------- Canvas open / close ---------- */

function regOpenCanvas() {
  regDraft.dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  regDraft.currentTab = 'schema';
  if (typeof goto === 'function') goto('register-element');
  regRenderTabs();
  regRenderTabContent();
  regRenderSchemaTab();
  // Pre-render the other tabs so demo runners can flip between tabs without a
  // first-paint delay. Cheap — these are static-ish until state changes.
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  regRenderCanvasFooter();
  regUpdateAutosaveIndicator();
  regScheduleAutosave();
}

function regResetDraft(mode) {
  regDraft = cloneRegState(REG_INITIAL_STATE);
  regDraft.mode = mode || 'new';
}

function regDiscardAndExit() {
  // Confirm if dirty, then clear and navigate back.
  const dirty = regDraft.fields.length > 0 || regDraft.meta.name || regDraft.meta.description;
  if (dirty && typeof window.confirm === 'function' && !window.confirm('Discard this work in progress and return to the catalogue?')) {
    return;
  }
  regClearAutosave();
  regResetDraft('new');
  if (typeof goto === 'function') goto('data-elements');
}

/* ---------- Compose complexity tab (Impl E · ADR 0025) ---------- */

/* Indicator detectors — scan the current schema for signals that *inform* the
 * admin's manual choice between Simple and High-stakes. Indicators DO NOT
 * pre-select per Q5 lock; they just light up so the admin sees what the system
 * sees. Each detector returns { id, label, hint, matched: boolean }.
 *
 * Detectors live here so a future Phase-2 ML-based indicator engine can be
 * swapped in without changing the rendering contract. */
function regComplexityIndicators() {
  const fields = regDraft.fields || [];
  const names = fields.map(f => (f.name || '').toLowerCase());
  const has = (re) => names.some(n => re.test(n));
  const detectors = [
    {
      id: 'signature',
      label: 'Carries an attestation or signature',
      hint: 'Forms that bind a signing party usually need a review step.',
      // Word-boundary or suffix match — "consignee" should NOT light this up.
      matched: has(/(^|_)(sign|signature|certif|witness|attest|stamp|seal)(_|$)|_signed$|_sig$/)
    },
    {
      id: 'personal-id',
      label: 'Contains personal identifiers',
      hint: 'PII / regulated identifiers benefit from explicit review.',
      matched: has(/passport|nric|ic_no|ic_number|ssn|id_number|national_id/)
    },
    {
      id: 'financial',
      label: 'Carries financial figures',
      hint: 'Documents with money values often warrant a second look at submit.',
      matched: has(/amount|total|payment|invoice|fee|price|cost|value/)
    },
    {
      id: 'regulatory',
      label: 'References a regulatory grade or certification',
      hint: 'Grade or certification fields often trigger downstream compliance.',
      matched: has(/grade|classification|class\b|spec|certif|standard/)
    },
    {
      id: 'large-form',
      label: 'Large form (more than 8 required fields)',
      hint: 'Many required fields raise the cost of accidental submission.',
      matched: fields.filter(f => f.required).length > 8
    },
    {
      id: 'residency-strict',
      label: 'Residency-strict tagged on the Schema tab',
      hint: 'Residency-strict forces high-stakes regardless of admin choice (ADR 0025).',
      matched: !!regDraft.governance.residencyStrict
    }
  ];
  return detectors;
}

function regSelectComplexity(level) {
  if (level !== 'simple' && level !== 'high-stakes') return;
  // Residency-strict locks to high-stakes (Q11 + ADR 0025 lines 52-53).
  if (regDraft.governance.residencyStrict && level === 'simple') {
    if (typeof toast === 'function') {
      toast('Residency-strict elements require high-stakes — cannot downgrade. Untick Residency-strict on the Schema tab first.');
    }
    return;
  }
  regDraft.composeComplexity = level;
  regRenderComplexityTab();
  regRenderSkeleton();              // skeleton transforms simple ↔ wizard
  regScheduleAutosave();
}

function regRenderComplexityTab() {
  const panel = document.querySelector('[data-reg-tab-panel="complexity"]');
  if (!panel) return;
  const indicators = regComplexityIndicators();
  const lit = indicators.filter(d => d.matched);
  const dim = indicators.filter(d => !d.matched);
  const residencyLocked = !!regDraft.governance.residencyStrict;
  const sel = regDraft.composeComplexity;

  const cardsHtml =
    regBuildComplexityCard('simple', sel, residencyLocked)
    + regBuildComplexityCard('high-stakes', sel, residencyLocked);

  const indicatorsHtml =
    lit.map(d => regBuildIndicatorChip(d, true)).join('')
    + dim.map(d => regBuildIndicatorChip(d, false)).join('');

  panel.innerHTML =
    '<div class="reg-complexity-body">'
    +   '<div class="reg-complexity-intro">'
    +     '<h2>How will this element be composed?</h2>'
    +     '<p>Pick the form shape operators will see when sending or receiving this element. <strong>This is your call</strong> — indicators below light up to inform, but the system does not pre-select. <em>(ADR 0025: compose_complexity is DEX-admin-owned; individuals can\'t accidentally downgrade.)</em></p>'
    +   '</div>'
    +   '<div class="reg-complexity-cards" data-demo="register-canvas.complexity-cards">' + cardsHtml + '</div>'
    +   '<div class="reg-complexity-indicators">'
    +     '<h3>Schema signals</h3>'
    +     '<p class="reg-complexity-indicators-hint">Lit signals are detected in your schema. None of them force a choice.</p>'
    +     '<div class="reg-complexity-indicator-list">' + indicatorsHtml + '</div>'
    +   '</div>'
    + '</div>';

  // Smart Start assist provenance chip (ADR 0040 Q14) — attached to the card
  // whose level matches the suggestion's choice. The chip appears as a small
  // overlay on the card's top-right corner; caveats (if any) render as a
  // banner above the cards block.
  const cSug = (typeof regAssistComplexitySuggestion === 'function') ? regAssistComplexitySuggestion() : null;
  if (cSug && cSug.payload && cSug.payload.choice &&
      typeof window.smartStartUi_buildChip === 'function') {
    const cardsBlock = panel.querySelector('.reg-complexity-cards');
    if (cardsBlock && (cSug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
      const banner = window.smartStartUi_buildCaveatBanner(cSug);
      if (banner) cardsBlock.parentNode.insertBefore(banner, cardsBlock);
    }
    const targetCard = panel.querySelector('.reg-complexity-card[data-complexity="' + cSug.payload.choice + '"]');
    if (targetCard) {
      const chip = window.smartStartUi_buildChip(cSug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(cSug.id) });
      chip.classList.add('reg-assist-chip-overlay');
      // Clicks on the chip must not propagate to the card's click handler
      // (which would re-trigger regSelectComplexity). The chip handler
      // already stops propagation; this is defence-in-depth.
      chip.addEventListener('click', (e) => e.stopPropagation());
      targetCard.appendChild(chip);
      targetCard.classList.add('reg-complexity-card-has-assist');
    }
  }
}

function regBuildComplexityCard(level, selected, residencyLocked) {
  const isSimple = level === 'simple';
  const cardClasses = ['reg-complexity-card'];
  if (selected === level) cardClasses.push('is-selected');
  const lockedSimple = residencyLocked && isSimple;
  if (lockedSimple) cardClasses.push('is-locked');
  const title = isSimple ? 'Simple' : 'High-stakes';
  const blurb = isSimple
    ? 'Single-page form. Operator fills the fields and submits. No review step. Best for routine, low-blast-radius documents.'
    : '3-step wizard with explicit Review step before submit. Best for legally-significant, regulated, or high-blast-radius documents.';
  const lockHint = lockedSimple
    ? '<div class="reg-complexity-lock-hint"><i class="ti ti-lock"></i> Locked by Residency-strict on the Schema tab.</div>'
    : '';
  const cardClick = lockedSimple ? '' : 'onclick="regSelectComplexity(\'' + level + '\')"';
  const preview = isSimple ? regBuildSimplePreview() : regBuildHighStakesPreview();

  return ''
    + '<button type="button" class="' + cardClasses.join(' ') + '"'
    +   ' data-complexity="' + level + '"'
    +   ' data-demo="register-canvas.complexity-' + level + '"'
    +   ' ' + cardClick
    +   (lockedSimple ? ' disabled' : '') + '>'
    +   '<div class="reg-complexity-card-head">'
    +     '<span class="reg-complexity-card-title">' + title + '</span>'
    +     (selected === level ? '<span class="reg-complexity-card-check"><i class="ti ti-check"></i></span>' : '')
    +   '</div>'
    +   '<p class="reg-complexity-card-blurb">' + blurb + '</p>'
    +   '<div class="reg-complexity-card-preview">' + preview + '</div>'
    +   lockHint
    + '</button>';
}

function regBuildSimplePreview() {
  return ''
    + '<div class="reg-mini-composer reg-mini-composer-simple">'
    +   '<div class="reg-mini-composer-head"><span class="reg-mini-composer-pill">simple</span></div>'
    +   '<div class="reg-mini-composer-body">'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-foot"><span class="reg-mini-btn">Submit</span></div>'
    + '</div>';
}

function regBuildHighStakesPreview() {
  return ''
    + '<div class="reg-mini-composer reg-mini-composer-hs">'
    +   '<div class="reg-mini-composer-head"><span class="reg-mini-composer-pill is-hs">high-stakes</span></div>'
    +   '<div class="reg-mini-stepper">'
    +     '<span class="reg-mini-step is-active">1 Fill</span>'
    +     '<span class="reg-mini-step">2 Review</span>'
    +     '<span class="reg-mini-step">3 Submit</span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-body">'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-foot"><span class="reg-mini-btn">Continue →</span></div>'
    + '</div>';
}

function regBuildIndicatorChip(detector, lit) {
  return ''
    + '<div class="reg-indicator-chip' + (lit ? ' is-lit' : '') + '" title="' + escapeHtml(detector.hint) + '">'
    +   '<i class="ti ' + (lit ? 'ti-bulb-filled' : 'ti-bulb-off') + '"></i>'
    +   '<span>' + escapeHtml(detector.label) + '</span>'
    + '</div>';
}

/* ---------- Rules tab (Impl E · ADR 0038 layer 2) ---------- */

/* Compact govaluate-style evaluator. Real govaluate (be/sharelib/mock/mock.go)
 * supports a large surface; this prototype evaluator covers the operators and
 * helpers admins actually reach for in cross-field rules. Expressions are
 * compiled via Function constructor with the payload destructured as locals
 * plus injected helpers (sum, len, today, regex match). Prototype context
 * only — the admin is authoring expressions against their own data.
 *
 * Returns { ok: boolean, error: string|null, value: any }. */
function regEvalExpression(expression, payload) {
  if (!expression || !expression.trim()) return { ok: true, error: null, value: undefined };
  const helpers = {
    sum: arr => (Array.isArray(arr) ? arr.reduce((s, v) => s + (Number(v) || 0), 0) : 0),
    len: x => (Array.isArray(x) ? x.length : String(x == null ? '' : x).length),
    abs: Math.abs,
    today: () => new Date().toISOString().slice(0, 10),
    now: () => new Date().toISOString(),
    matches: (str, pattern) => new RegExp(pattern).test(String(str == null ? '' : str)),
    upper: s => String(s == null ? '' : s).toUpperCase(),
    lower: s => String(s == null ? '' : s).toLowerCase()
  };
  const ctx = Object.assign({}, helpers, payload || {});
  try {
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, '"use strict"; return (' + expression + ');');
    const value = fn(...keys.map(k => ctx[k]));
    return { ok: !!value, error: null, value: value };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), value: undefined };
  }
}

/* Synthesize a sample payload from the current schema. Used for live rule
 * evaluation when no real Smart Start sample is available. Pulls from each
 * field's `examples[0]` if present; otherwise type-defaults. */
function regSynthesizeSamplePayload() {
  const payload = {};
  const todayYear = new Date().getFullYear();
  const todayIso  = new Date().toISOString().slice(0, 10);
  // Pick a default that satisfies common auto-applied rule patterns. A flat
  // 0 for integers tripped Year-sanity (>= 1900 && <= 2100) and balance/limit
  // checks even though the rule itself was sound — the synthesised payload
  // was the problem, not the rule.
  (regDraft.fields || []).forEach(f => {
    if (!f.name) return;
    if (f.examples && f.examples.length) { payload[f.name] = f.examples[0]; return; }
    const v = f.validation || {};
    switch (f.type) {
      case 'integer':
      case 'number': {
        // Year-shaped field name → current year so range rules pass.
        if (/(^|_)year(s)?$/.test(f.name)) {
          payload[f.name] = todayYear;
          break;
        }
        if (v.minimum !== undefined && v.maximum !== undefined) {
          // Midpoint of the explicit range — guarantees both >= min and <= max.
          payload[f.name] = Math.round((Number(v.minimum) + Number(v.maximum)) / 2);
        } else if (v.minimum !== undefined) {
          payload[f.name] = Number(v.minimum);
        } else if (v.maximum !== undefined) {
          payload[f.name] = Math.min(0, Number(v.maximum));
        } else {
          payload[f.name] = 0;
        }
        break;
      }
      case 'boolean':  payload[f.name] = false; break;
      case 'date':
      case 'datetime':
        payload[f.name] = (f.type === 'datetime') ? new Date().toISOString() : todayIso;
        break;
      case 'enum':     payload[f.name] = (v.enumValues && v.enumValues[0]) || ''; break;
      case 'array':    payload[f.name] = []; break;
      case 'object':   payload[f.name] = {}; break;
      default: {
        // String fields — try to satisfy any format check the canned rule
        // suggester emits for this field's name. The detector in
        // regSuggestedRules uses the same name-shape heuristics, so a
        // matching default makes Range/Format rules render PASSES on a
        // freshly-synthesised payload instead of misleading FAILS/ERROR.
        const n = f.name;
        const sample =
            /(^|_)email$/.test(n)                               ? 'demo@example.com'
          : /(^|_)nric$/.test(n)                                ? 'S1234567A'
          : /(^|_)imo$/.test(n)                                 ? '1234567'
          : /(^|_)(zip|postal_code)$/.test(n)                   ? '123456'
          : /(^|_)(phone|mobile|contact_number)$/.test(n)        ? '+6512345678'
          : /(tax_id|tin|ein|uen)/.test(n)                       ? 'A1B2C3D4E5'
          : '';
        payload[f.name] = sample;
      }
    }
  });
  return payload;
}

/* Schema-aware rule suggestions. Scans the current fields for common patterns
 * that warrant a validation rule and emits one tile per detected pattern.
 * Covers both per-field rules (format, range) and cross-field rules
 * (mutual exclusivity, balance≤limit, date ordering, numbered-family parity).
 * The detection is deterministic — operators can rely on it firing for the
 * patterns it knows about even when the LLM overlay didn't surface them. */
function regSuggestedRules() {
  const fields = regDraft.fields || [];
  const fieldNames = fields.map(f => f.name).filter(Boolean);
  const fieldByName = {};
  fields.forEach(f => { if (f.name) fieldByName[f.name] = f; });
  const out = [];
  const humanize = (n) => String(n || '').replace(/_/g, ' ');

  // ---- Per-field: format check (string field with a JSON Schema pattern)
  fields.forEach(f => {
    if (f.validation && f.validation.pattern) {
      const safe = f.validation.pattern.replace(/"/g, '\\"');
      out.push({
        title: 'Format check: ' + f.name + ' matches pattern',
        scope: 'field',
        template: { name: 'Format · ' + f.name, scope: 'field', expression: 'matches(' + f.name + ', "' + safe + '")', on_failure: humanize(f.name) + ' does not match the required format' }
      });
    }
  });

  // ---- Per-field: regulated-identifier format (NRIC / IMO / ZIP / phone /
  // tax-id / IBAN). Suggested ONLY when no explicit pattern was set, so we
  // don't duplicate the field-level format check above.
  fields.forEach(f => {
    if (f.validation && f.validation.pattern) return;          // already covered
    const n = f.name || '';
    // Patterns use 4-backslash sequences so the regex survives both layers
    // of string-literal parsing: once here (JS source → string with \\d),
    // once when regEvalExpression wraps the expression in `new Function(...)`
    // and re-parses the string literal (where unrecognised escapes drop the
    // backslash). Without this, `^\d{4,10}$` would become `^d{4,10}$` at
    // runtime and zip "123456" would no longer match.
    const pattern =
        /^|_nric$|^nric$/.test(n) && /nric/.test(n)            ? '^[STFG]\\\\d{7}[A-Z]$' :
        /^|_imo$|^imo$/.test(n) && /imo/.test(n)                ? '^\\\\d{7}$' :
        /^|_zip|^zip$|^postal_code$/.test(n) && /(zip|postal)/.test(n) ? '^\\\\d{4,10}$' :
        /^|_phone$|^phone$|^mobile$|^contact_number$/.test(n) && /(phone|mobile|contact_number)/.test(n) ? '^[+\\\\d\\\\s\\\\-()]{6,20}$' :
        /(tax_id|tin|ein|uen)/.test(n)                          ? '^[A-Z0-9\\\\-]{6,20}$' :
        /(email)/.test(n)                                        ? '^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$' :
        null;
    if (pattern) {
      out.push({
        title: 'Format check: ' + n + ' (' + pattern + ')',
        scope: 'field',
        template: { name: 'Format · ' + n, scope: 'field', expression: 'matches(' + n + ', "' + pattern.replace(/"/g, '\\"') + '")', on_failure: humanize(n) + ' is not in the expected format' }
      });
    }
  });

  // ---- Per-field: range sanity from min/max
  fields.forEach(f => {
    if ((f.type === 'number' || f.type === 'integer') && f.validation) {
      const min = f.validation.minimum;
      const max = f.validation.maximum;
      if (min !== undefined && max !== undefined) {
        out.push({
          title: 'Range check: ' + min + ' ≤ ' + f.name + ' ≤ ' + max,
          scope: 'field',
          template: { name: 'Range · ' + f.name, scope: 'field', expression: f.name + ' >= ' + min + ' && ' + f.name + ' <= ' + max, on_failure: humanize(f.name) + ' must be between ' + min + ' and ' + max }
        });
      }
    }
  });

  // ---- Cross-field: mutually exclusive boolean group.
  // A "group" is ≥2 boolean fields whose names share a common suffix or look
  // like alternative legal-form / status flags (corporation/partnership/…).
  // We only emit one rule per detected exclusive group.
  const boolFields = fields.filter(f => f.type === 'boolean').map(f => f.name);
  if (boolFields.length >= 2) {
    // Heuristic: when the boolean fields together resemble a "pick one"
    // category (≤4 of them, names look like categorical labels rather than
    // generic flags), suggest mutual exclusivity.
    const looksCategorical = boolFields.length <= 4 && boolFields.every(n => !/^(is_|has_|allow_)/.test(n));
    if (looksCategorical) {
      const exclusive = boolFields.map(n => '(' + n + ' ? 1 : 0)').join(' + ') + ' <= 1';
      out.push({
        title: 'Mutual exclusivity: pick at most one of ' + boolFields.join(', '),
        scope: 'cross-field',
        template: { name: 'Pick at most one', scope: 'cross-field', expression: exclusive, on_failure: 'Only one of ' + boolFields.join(', ') + ' may be set' }
      });
      // And typically "exactly one" is stricter — also offer it.
      const exactly = boolFields.map(n => '(' + n + ' ? 1 : 0)').join(' + ') + ' === 1';
      out.push({
        title: 'Exactly one required: ' + boolFields.join(' / '),
        scope: 'cross-field',
        template: { name: 'Pick exactly one', scope: 'cross-field', expression: exactly, on_failure: 'Pick exactly one of ' + boolFields.join(', ') }
      });
    }
  }

  // ---- Cross-field: numbered-suffix family parity.
  // When a base name appears with _1, _2, _3 suffixes (e.g. principal_name_1,
  // principal_name_2), and a sibling base name has matching suffixes, suggest
  // a rule that ties them together (e.g. if principal_name_2 is set, the
  // corresponding principal_title_2 must also be filled).
  const numberedFamilies = regCollectNumberedFamilies(fieldNames);
  Object.keys(numberedFamilies).forEach(suffix => {
    const baseNames = numberedFamilies[suffix];                // e.g. ['principal_name','principal_title','principal_address']
    if (baseNames.length < 2) return;
    const primary = baseNames[0] + '_' + suffix;
    baseNames.slice(1).forEach(sib => {
      const dep = sib + '_' + suffix;
      out.push({
        title: 'Coherence: when ' + primary + ' is set, ' + dep + ' must also be set',
        scope: 'cross-field',
        template: { name: 'Coherence · ' + sib + ' #' + suffix, scope: 'cross-field', expression: '!(' + primary + ' !== "") || ' + dep + ' !== ""', on_failure: humanize(dep) + ' is required when ' + humanize(primary) + ' is provided' }
      });
    });
  });

  // ---- Cross-field: balance ≤ limit pairs.
  // Detect <prefix>_balance + <prefix>_limit (or current_balance_N + credit_limit_N)
  // and suggest the balance never exceeds the limit.
  const limitPairs = regCollectBalanceLimitPairs(fieldNames);
  limitPairs.forEach(pair => {
    out.push({
      title: 'Sanity: ' + pair.balance + ' ≤ ' + pair.limit,
      scope: 'cross-field',
      template: { name: 'Balance ≤ Limit', scope: 'cross-field', expression: pair.balance + ' <= ' + pair.limit, on_failure: humanize(pair.balance) + ' cannot exceed ' + humanize(pair.limit) }
    });
  });

  // ---- Cross-field: date ordering across every pair of date fields where
  // names suggest a sequence (a before b). Naive heuristic — pair anything
  // ending in _date / _since / _on with each other and ask the operator to
  // confirm. Also seed a today-cap rule for "*_since" (can't be in the future).
  const dateFields = fields.filter(f => f.type === 'date' || f.type === 'datetime').map(f => f.name);
  if (dateFields.length >= 2) {
    // Only emit a small number of date-order suggestions so the tile list
    // stays scannable. Pair adjacent date fields in declaration order.
    for (let i = 0; i < Math.min(dateFields.length - 1, 3); i++) {
      const a = dateFields[i], b = dateFields[i + 1];
      out.push({
        title: 'Date ordering: ' + b + ' ≥ ' + a,
        scope: 'cross-field',
        template: { name: 'Date order · ' + a + ' → ' + b, scope: 'cross-field', expression: b + ' >= ' + a, on_failure: humanize(b) + ' must be on or after ' + humanize(a) }
      });
    }
  }
  dateFields.forEach(n => {
    if (/_since$|^date_of_/.test(n)) {
      out.push({
        title: 'Sanity: ' + n + ' is not in the future',
        scope: 'field',
        template: { name: 'Not in future · ' + n, scope: 'field', expression: n + ' <= today()', on_failure: humanize(n) + ' cannot be a future date' }
      });
    }
  });

  // ---- Cross-field: boolean → explanation/follow-up requiredness.
  // When a boolean's name implies a yes/no answer where "yes" needs a paired
  // explanation field (convicted_of_felony + felony_explanation,
  // previously_employed + reason_for_leaving, has_dependents + dependents_count),
  // suggest a conditional requiredness rule.
  fields.filter(f => f.type === 'boolean').forEach(b => {
    const candidatePartners = [
      b.name + '_explanation', b.name + '_reason', b.name + '_details',
      b.name + '_notes', b.name + '_description',
      b.name.replace(/^was_|^is_|^has_|^had_/, '') + '_reason',
      b.name.replace(/^was_|^is_|^has_|^had_/, '') + '_explanation',
    ];
    const partner = candidatePartners.find(p => fieldByName[p]);
    if (partner) {
      out.push({
        title: 'Conditional requiredness: when ' + b.name + ' is true, ' + partner + ' is required',
        scope: 'cross-field',
        template: { name: 'Required-when · ' + b.name, scope: 'cross-field', expression: '!' + b.name + ' || ' + partner + ' !== ""', on_failure: humanize(partner) + ' is required when ' + humanize(b.name) + ' is yes' }
      });
    }
  });

  // ---- Per-field: integer year sanity (4-digit year falling in a sane range).
  fields.forEach(f => {
    if ((f.type === 'integer' || f.type === 'number') && /(^|_)year(s)?$/.test(f.name || '')) {
      // Only fire when no explicit min/max already covers it (we already emit
      // a range rule for that above).
      if (f.validation && (f.validation.minimum !== undefined || f.validation.maximum !== undefined)) return;
      out.push({
        title: 'Sanity: ' + f.name + ' looks like a valid year',
        scope: 'field',
        template: { name: 'Year sanity · ' + f.name, scope: 'field', expression: f.name + ' >= 1900 && ' + f.name + ' <= 2100', on_failure: humanize(f.name) + ' must be between 1900 and 2100' }
      });
    }
  });

  // ---- Cross-field: aggregate (only when literal `total` and `line_items` exist).
  if (fieldByName.total && fieldByName.line_items) {
    out.push({
      title: 'Aggregate: total === sum(line_items)',
      scope: 'cross-field',
      template: { name: 'Total matches sum', scope: 'cross-field', expression: 'total === sum(line_items)', on_failure: 'Total does not match the sum of line items' }
    });
  }

  // ---- Generic fallback when nothing specific applies — show one example.
  if (out.length === 0 && fieldNames.length > 0) {
    out.push({
      title: 'Required-when example',
      scope: 'cross-field',
      template: { name: 'Conditional requiredness', scope: 'cross-field', expression: '!' + (fieldNames[0] || 'field') + ' || ' + (fieldNames[1] || 'field') + ' !== ""', on_failure: 'When ' + (fieldNames[0] || 'field') + ' is set, ' + (fieldNames[1] || 'field') + ' must be filled' }
    });
  }

  return out;
}

/* Group field names sharing a `_<digit>` suffix into base names per suffix.
 * e.g. ['principal_name_1','principal_title_1','principal_name_2'] →
 *      { '1': ['principal_name','principal_title'], '2': ['principal_name'] } */
function regCollectNumberedFamilies(fieldNames) {
  const byNumber = {};
  fieldNames.forEach(n => {
    const m = n.match(/^(.+)_(\d+)$/);
    if (!m) return;
    const base = m[1], num = m[2];
    if (!byNumber[num]) byNumber[num] = [];
    if (byNumber[num].indexOf(base) === -1) byNumber[num].push(base);
  });
  return byNumber;
}

/* Detect <prefix>_balance / <prefix>_limit pairs, plus the
 * current_balance_<N> / credit_limit_<N> convention seen on credit-app forms. */
function regCollectBalanceLimitPairs(fieldNames) {
  const pairs = [];
  const set = new Set(fieldNames);
  // <prefix>_balance + <prefix>_limit
  fieldNames.forEach(n => {
    const m = n.match(/^(.+)_balance$/);
    if (m) {
      const limit = m[1] + '_limit';
      if (set.has(limit)) pairs.push({ balance: n, limit });
    }
  });
  // current_balance_<N> + credit_limit_<N>
  fieldNames.forEach(n => {
    const m = n.match(/^current_balance_(\d+)$/);
    if (m) {
      const limit = 'credit_limit_' + m[1];
      if (set.has(limit)) pairs.push({ balance: n, limit });
    }
  });
  return pairs;
}

function regAddRule(template) {
  const rule = Object.assign({
    id: 'r_' + Math.random().toString(36).slice(2, 9),
    name: '',
    expression: '',
    on_failure: '',
    applies_at: 'validation'
  }, template || {});
  regDraft.rules = regDraft.rules || [];
  regDraft.rules.push(rule);
  regRenderRulesTab();
  regScheduleAutosave();
}

function regUpdateRule(id, patch) {
  const rule = (regDraft.rules || []).find(r => r.id === id);
  if (!rule) return;
  Object.assign(rule, patch);
  regRenderRulesTab();
  regScheduleAutosave();
}

function regDeleteRule(id) {
  regDraft.rules = (regDraft.rules || []).filter(r => r.id !== id);
  regRenderRulesTab();
  regScheduleAutosave();
}

/* Cached suggestion list — keyed by render so the inline onclick can look up
 * by index instead of trying to encode the template object into an attribute.
 * Reset on every render of the Rules tab. */
let _regSuggestionCache = [];

function regAddSuggestionByIndex(idx) {
  const s = _regSuggestionCache[idx];
  if (s) regAddRule(s.template);
}

/* Bulk-add every not-yet-added suggestion in the named subsection ('field' or
 * 'cross-field'). Matching against existing rules is by expression so a rule
 * that was added one-at-a-time isn't duplicated when the operator clicks
 * Add all afterwards. */
function regAddAllSuggestions(scopeKey) {
  const cache = _regSuggestionCache || [];
  const existing = new Set((regDraft.rules || []).map(r => (r.expression || '').trim()).filter(Boolean));
  cache.forEach(s => {
    const scope = s.scope || (s.template && s.template.scope);
    if (scope !== scopeKey) return;
    const expr = ((s.template && s.template.expression) || '').trim();
    if (!expr || existing.has(expr)) return;
    existing.add(expr);
    const rule = Object.assign({
      id: 'r_' + Math.random().toString(36).slice(2, 9),
      name: '', expression: '', on_failure: '', applies_at: 'validation'
    }, s.template || {});
    (regDraft.rules = regDraft.rules || []).push(rule);
  });
  regRenderRulesTab();
  regScheduleAutosave();
}

function regRenderRulesTab() {
  const panel = document.querySelector('[data-reg-tab-panel="rules"]');
  if (!panel) return;
  // Refresh the sample payload from current schema each render (cheap;
  // ensures evaluation reflects field renames/deletions without a separate
  // invalidation hook).
  regDraft.samplePayload = regSynthesizeSamplePayload();
  const rules = regDraft.rules || [];
  const evals = rules.map(r => regEvalExpression(r.expression, regDraft.samplePayload));
  const suggested = regSuggestedRules();
  _regSuggestionCache = suggested;

  const listHtml = rules.length === 0
    ? '<div class="reg-rules-empty">No rules yet. Add one below — most elements need at least one for cross-field validation.</div>'
    : rules.map((r, idx) => regBuildRuleEditor(r, evals[idx])).join('');

  // Index every suggestion's already-added state once so the tile builder
  // and the "Add all" CTA share the same source of truth. A suggestion is
  // already-added when a rule in regDraft.rules has the same expression
  // (deleting that rule re-enables the tile automatically).
  const ruleExpressions = new Set(rules.map(r => (r.expression || '').trim()).filter(Boolean));
  const isAdded = (s) => ruleExpressions.has(((s.template && s.template.expression) || '').trim());

  // Split suggestions into per-field / cross-field buckets so the operator
  // can see at a glance whether cross-field opportunities were detected.
  // Index `i` is preserved across both subsections (it's the index into
  // `_regSuggestionCache`) so the onclick handler still works.
  const perFieldHtml = [];
  const crossFieldHtml = [];
  let perFieldHasUnadded = false;
  let crossFieldHasUnadded = false;
  suggested.forEach((s, i) => {
    const scope = s.scope || (s.template && s.template.scope);
    const added = isAdded(s);
    const tile = regBuildSuggestionTile(s, i, added);
    if (scope === 'cross-field') {
      crossFieldHtml.push(tile);
      if (!added) crossFieldHasUnadded = true;
    } else {
      perFieldHtml.push(tile);
      if (!added) perFieldHasUnadded = true;
    }
  });
  const subsection = (title, items, emptyHint, scopeKey, hasUnadded) => ''
    + '<div class="reg-rules-suggested-subsection">'
    +   '<div class="reg-rules-suggested-subhead">'
    +     '<h4 class="reg-rules-suggested-subtitle">' + title
    +       ' <span class="reg-rules-suggested-subcount">' + items.length + '</span></h4>'
    +     (items.length
        ? '<button type="button" class="reg-rules-add-all"'
          + '        data-demo="rules.add-all.' + scopeKey + '"'
          + '        onclick="regAddAllSuggestions(\'' + scopeKey + '\')"'
          + (hasUnadded ? '' : ' disabled') + '>'
          +   '<i class="ti ti-plus"></i> Add all'
          + '</button>'
        : '')
    +   '</div>'
    +   (items.length
        ? '<div class="reg-rules-suggested-list">' + items.join('') + '</div>'
        : '<p class="reg-rules-suggested-empty">' + emptyHint + '</p>')
    + '</div>';
  const suggestedHtml = suggested.length
    ? '<div class="reg-rules-suggested">'
      + '<h3>Suggested for your schema</h3>'
      + subsection('Per-field rules',  perFieldHtml,
          'No per-field opportunities detected from the current schema. Per-field rules check a single field (format, range, length).',
          'field', perFieldHasUnadded)
      + subsection('Cross-field rules', crossFieldHtml,
          'No cross-field opportunities detected from the current schema. Cross-field rules tie ≥2 fields together (date ordering, mutual exclusivity, conditional requiredness).',
          'cross-field', crossFieldHasUnadded)
      + '</div>'
    : '';

  panel.innerHTML =
    '<div class="reg-rules-body">'
    +   '<div class="reg-rules-intro">'
    +     '<h2>Validation rules</h2>'
    +     '<p>govaluate-style expressions evaluated at Composer submission time per <em>ADR 0038</em>. Covers both <strong>per-field</strong> rules (formats, ranges, conditional requiredness) and <strong>cross-field</strong> rules (date order, sum-equals-total, mutual exclusivity) — anything that goes beyond what JSON Schema can express. Available helpers: <code>sum(), len(), abs(), today(), now(), matches(str, pattern), upper(), lower(), in(value, ...options)</code>.</p>'
    +   '</div>'
    +   '<div class="reg-rules-sample">'
    +     '<div class="reg-rules-sample-head"><span>Live evaluation payload (synthesised from schema)</span></div>'
    +     '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
    +   '</div>'
    +   '<div class="reg-rules-list" data-demo="register-canvas.rules-list">' + listHtml + '</div>'
    +   '<div class="reg-rules-actions">'
    +     '<button type="button" class="btn-secondary" data-demo="register-canvas.add-rule" onclick="regAddRule()"><i class="ti ti-plus"></i> Add custom rule</button>'
    +   '</div>'
    +   suggestedHtml
    + '</div>';

  // Smart Start assist provenance chips (ADR 0040 Q14) — for each rule that
  // came from assist, append a chip to the rule's header and prepend a caveat
  // banner above the rule editor when applicable.
  if (typeof window.smartStartUi_buildChip === 'function' &&
      typeof regAssistSuggestionForRule === 'function') {
    rules.forEach(rule => {
      const sug = regAssistSuggestionForRule(rule);
      if (!sug) return;
      const ruleNode = panel.querySelector('.reg-rule[data-rule-id="' + rule.id + '"]');
      if (!ruleNode) return;
      const head = ruleNode.querySelector('.reg-rule-head');
      const deleteBtn = ruleNode.querySelector('.reg-rule-delete');
      if (head && deleteBtn) {
        const chip = window.smartStartUi_buildChip(sug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(sug.id) });
        head.insertBefore(chip, deleteBtn);
      }
      if ((sug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
        const banner = window.smartStartUi_buildCaveatBanner(sug);
        if (banner) {
          ruleNode.classList.add('reg-rule-has-caveat');
          ruleNode.parentNode.insertBefore(banner, ruleNode);
        }
      }
    });
  }
}

function regBuildRuleEditor(rule, evalResult) {
  const passed = evalResult.ok;
  const errored = !!evalResult.error;
  const statusClass = errored ? 'is-errored' : (passed ? 'is-passed' : 'is-failed');
  const statusLabel = errored ? 'ERROR' : (passed ? 'PASSES' : 'FAILS');
  const errorBox = errored
    ? '<div class="reg-rule-error">Expression error: ' + escapeHtml(evalResult.error) + '</div>'
    : '';
  const scopePill = rule.scope === 'cross-field'
    ? '<span class="reg-rule-scope is-cross">cross-field</span>'
    : rule.scope === 'field'
      ? '<span class="reg-rule-scope is-field">per-field</span>'
      : '';
  return ''
    + '<div class="reg-rule" data-rule-id="' + rule.id + '">'
    +   '<div class="reg-rule-head">'
    +     '<input type="text" class="reg-rule-name" placeholder="Rule name (e.g. Date order)" value="' + escapeHtml(rule.name) + '"'
    +     '       oninput="regUpdateRule(\'' + rule.id + '\', { name: this.value })"'
    +     '       data-demo="rule.name.' + rule.id + '">'
    +     scopePill
    +     '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
    +     '<button type="button" class="reg-rule-delete" onclick="regDeleteRule(\'' + rule.id + '\')" aria-label="Delete rule"><i class="ti ti-trash"></i></button>'
    +   '</div>'
    +   '<label class="reg-rule-sublabel">Expression</label>'
    +   '<input type="text" class="reg-rule-expression" placeholder="e.g. test_date >= sample_date" value="' + escapeHtml(rule.expression) + '"'
    +   '       oninput="regUpdateRule(\'' + rule.id + '\', { expression: this.value })"'
    +   '       data-demo="rule.expression.' + rule.id + '">'
    +   errorBox
    +   '<label class="reg-rule-sublabel">Error message (shown to operator on failure)</label>'
    +   '<input type="text" class="reg-rule-onfailure" placeholder="Test date must be after sample date" value="' + escapeHtml(rule.on_failure) + '"'
    +   '       oninput="regUpdateRule(\'' + rule.id + '\', { on_failure: this.value })"'
    +   '       data-demo="rule.onfailure.' + rule.id + '">'
    + '</div>';
}

function regBuildSuggestionTile(suggestion, idx, alreadyAdded) {
  const scope = suggestion.scope || (suggestion.template && suggestion.template.scope);
  const scopePill = scope === 'cross-field'
    ? '<span class="reg-rule-scope is-cross">cross-field</span>'
    : scope === 'field'
      ? '<span class="reg-rule-scope is-field">per-field</span>'
      : '';
  const t = suggestion.template || {};
  const onFailure = t.on_failure || '';
  // When the rule has already been added to regDraft.rules (matched by
  // expression), the tile renders disabled with a "Added" badge so the
  // operator can see which suggestions they've already taken. Deleting the
  // matching rule from the validation list re-enables the tile because the
  // expression-match falls back to false on the next render.
  const addedAttr  = alreadyAdded ? ' disabled' : '';
  const addedClass = alreadyAdded ? ' is-added' : '';
  const addedBadge = alreadyAdded
    ? '<span class="reg-rule-suggestion-added"><i class="ti ti-check"></i>added</span>'
    : '';
  return ''
    + '<button type="button" class="reg-rule-suggestion' + addedClass + '" data-demo="rule.suggestion.' + idx + '"'
    + '        onclick="regAddSuggestionByIndex(' + idx + ')"' + addedAttr + '>'
    +   '<span class="reg-rule-suggestion-row">'
    +     '<i class="ti ti-bolt"></i>'
    +     '<span class="reg-rule-suggestion-title">' + escapeHtml(suggestion.title) + '</span>'
    +     scopePill
    +     addedBadge
    +   '</span>'
    +   '<span class="reg-rule-suggestion-sublabel">Expression</span>'
    +   '<code class="reg-rule-suggestion-expression">' + escapeHtml(t.expression || '') + '</code>'
    +   (onFailure
        ? '<span class="reg-rule-suggestion-sublabel">Error message</span>'
          + '<span class="reg-rule-suggestion-onfailure">' + escapeHtml(onFailure) + '</span>'
        : '')
    + '</button>';
}

/* ---------- Review tab (Impl F · ADR 0039 §8) ----------
 * Terminal tab: collapses everything Sarah authored into a single read-only
 * summary view + pack-assignment sidecar + Publish CTA. Friction is structural
 * (the Review tab itself) per ADR 0015, not modal-warning-shaped. */

/* Pack-suggestion engine — scores each pack on the current DEX by field-name
 * overlap with the draft's field names. Per Q6 lock + ADR 0033 reactive style:
 * one top suggestion offered at the publish step; admin can also pick from
 * any pack on the DEX. Heuristic-only — Phase 2 may swap in a smarter model. */

const REG_PACK_HEURISTIC_KEYWORDS = {
  'vessel-arrival':           ['vessel', 'voyage', 'imo', 'eta', 'arrival', 'port'],
  'bunker-delivery':          ['bunker', 'fuel', 'mgo', 'hsfo', 'vlsfo', 'delivery'],
  'pre-shipment-documents':   ['shipment', 'cargo', 'consignee', 'shipper', 'consign', 'manifest'],
  'subcontractor-enablement': ['contractor', 'subcontractor', 'manpower', 'site', 'safety'],
  'patient-care-bundle':      ['patient', 'diagnosis', 'medication', 'referral', 'clinical']
};

function regPackSuggestions() {
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const catalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined' && DATA_ELEMENTS_BY_DEX[dexCode]) || { groups: [] };
  const packs = [];
  (catalog.groups || []).forEach(g => {
    (g.elements || []).forEach(e => {
      if (e.kind === 'pack') packs.push({ id: e.id || regDeriveIdFromName(e.name), name: e.name, group: g.name });
    });
  });

  const fieldNames = (regDraft.fields || []).map(f => (f.name || '').toLowerCase()).join(' ');
  const scored = packs.map(p => {
    const keywords = REG_PACK_HEURISTIC_KEYWORDS[p.id] || [];
    let hits = 0;
    keywords.forEach(k => { if (fieldNames.includes(k)) hits++; });
    return { pack: p, score: hits, total: keywords.length || 1 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function regAddToPack(packId) {
  regDraft.pack = packId || null;
  regRenderReviewTab();
  regScheduleAutosave();
}

function regClearPack() {
  regDraft.pack = null;
  regRenderReviewTab();
  regScheduleAutosave();
}

function regRenderReviewTab() {
  const panel = document.querySelector('[data-reg-tab-panel="review"]');
  if (!panel) return;

  regDraft.samplePayload = regSynthesizeSamplePayload();
  const fields = regDraft.fields || [];
  const rules = regDraft.rules || [];
  const evals = rules.map(r => regEvalExpression(r.expression, regDraft.samplePayload));
  const complexity = regDraft.composeComplexity;
  const residency = regDraft.governance.residencyStrict;
  const packSuggestions = regPackSuggestions();
  const topPack = packSuggestions[0];
  const selectedPack = regDraft.pack;
  const name = regDraft.meta.name || 'Untitled element';
  const version = regDraft.meta.version || 'v1.0';
  const isNewVersion = regDraft.mode === 'version';
  const publishLabel = 'Publish ' + version;

  // Sub-section: header summary
  const complexityChip = complexity
    ? '<span class="complexity-pill ' + complexity + '">' + complexity + '</span>'
    : '<span class="reg-review-warn"><i class="ti ti-alert-circle"></i> Compose complexity not chosen</span>';
  const residencyChip = residency
    ? '<span class="reg-review-warn"><i class="ti ti-shield-lock"></i> Residency-strict</span>'
    : '';
  const descBlurb = regDraft.meta.description
    ? '<p class="reg-review-blurb">' + escapeHtml(regDraft.meta.description) + '</p>'
    : '';
  const headerHtml = '<div class="reg-review-header">'
    +   '<div class="reg-review-title">'
    +     '<h2>' + escapeHtml(name) + '</h2>'
    +     '<span class="reg-version-pill">' + escapeHtml(version) + '</span>'
    +     complexityChip
    +     residencyChip
    +   '</div>'
    +   descBlurb
    + '</div>';

  // Sub-section: what happens at publish
  const versionLi = isNewVersion
    ? '<li><strong>Existing Agreements are unaffected</strong> — they keep their snapshot of the previous version.</li>'
      + '<li><strong>New Agreements</strong> picking this element will use ' + escapeHtml(version) + ' going forward.</li>'
    : '<li><strong>New Agreements</strong> picking this element will use ' + escapeHtml(version) + '.</li>'
      + '<li><strong>Future versions</strong> will be new immutable records, not edits to this one.</li>';
  const residencyLi = residency
    ? '<li><strong>Cross-DEX use is blocked</strong>: Agreements crossing DEX boundaries will hard-stop at creation time (ADR 0012).</li>'
    : '';
  const consequenceHtml = '<div class="reg-review-consequences">'
    +   '<h3>What happens at publish</h3>'
    +   '<ul>'
    +     '<li><strong>Schema becomes final</strong> for any Agreement that picks this version. No in-place edits after publish (ADR 0026).</li>'
    +     versionLi
    +     residencyLi
    +   '</ul>'
    + '</div>';

  // Sub-section: schema summary — respect the grouping captured at on-ramp
  // time so this view matches what the operator saw on the Schema tab and
  // Composer preview.
  const renderFieldLi = (f) => {
    let hint = '';
    if (f.validation && f.validation.pattern) hint = 'pattern: ' + f.validation.pattern;
    else if (f.validation && f.validation.enumValues) hint = 'enum: ' + f.validation.enumValues.slice(0, 3).join(' / ') + (f.validation.enumValues.length > 3 ? '…' : '');
    else if (f.validation && (f.validation.minimum !== undefined || f.validation.maximum !== undefined)) hint = 'range ' + (f.validation.minimum !== undefined ? f.validation.minimum : '−∞') + '..' + (f.validation.maximum !== undefined ? f.validation.maximum : '∞');
    return '<li>'
      + '<code>' + escapeHtml(f.name) + '</code> '
      + '<span class="reg-review-field-type">' + f.type + '</span> '
      + (f.required ? '<span class="reg-review-field-req">required</span>' : '')
      + (hint ? '<span class="reg-review-field-hint">' + escapeHtml(hint) + '</span>' : '')
      + '</li>';
  };
  const reviewGroups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  let fieldsListHtml;
  if (fields.length === 0) {
    fieldsListHtml = '<p class="reg-review-empty">No fields defined yet. Go back to the Schema tab.</p>';
  } else if (reviewGroups.length) {
    const byGroup = new Map();
    const ungrouped = [];
    reviewGroups.forEach(g => byGroup.set(g.name, []));
    fields.forEach(f => {
      const g = f.group;
      if (g && byGroup.has(g)) byGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    const groupBlocks = [];
    reviewGroups.forEach(g => {
      const list = byGroup.get(g.name) || [];
      if (!list.length) return;
      groupBlocks.push(
        '<div class="reg-review-field-group">'
        +   '<h4 class="reg-review-field-group-title">' + escapeHtml(g.name)
        +     ' <span class="reg-review-field-group-count">' + list.length + '</span></h4>'
        +   (g.rationale ? '<p class="reg-review-field-group-rationale">' + escapeHtml(g.rationale) + '</p>' : '')
        +   '<ul class="reg-review-field-list">' + list.map(renderFieldLi).join('') + '</ul>'
        + '</div>'
      );
    });
    if (ungrouped.length) {
      groupBlocks.push(
        '<div class="reg-review-field-group">'
        +   '<h4 class="reg-review-field-group-title">Other fields'
        +     ' <span class="reg-review-field-group-count">' + ungrouped.length + '</span></h4>'
        +   '<ul class="reg-review-field-list">' + ungrouped.map(renderFieldLi).join('') + '</ul>'
        + '</div>'
      );
    }
    fieldsListHtml = groupBlocks.join('');
  } else {
    fieldsListHtml = '<ul class="reg-review-field-list">' + fields.map(renderFieldLi).join('') + '</ul>';
  }
  const groupSummary = reviewGroups.length ? ' across ' + reviewGroups.length + ' group' + (reviewGroups.length === 1 ? '' : 's') : '';
  const schemaSummaryHtml = '<div class="reg-review-section">'
    +   '<h3>Schema · ' + fields.length + ' field' + (fields.length === 1 ? '' : 's') + groupSummary + '</h3>'
    +   fieldsListHtml
    + '</div>';

  // Sub-section: rules summary — mirror the Rules tab's structure so
  // publishers see the live evaluation payload alongside the rules that
  // will run against it. on_failure messages render below each rule (they
  // are the operator-visible text when a rule fails).
  const rulesListHtml = rules.length === 0
    ? '<p class="reg-review-empty">No rules. That\'s fine for some elements — but most elements benefit from at least one.</p>'
    : '<ul class="reg-review-rule-list">'
      + rules.map((r, i) => {
          const ev = evals[i];
          const statusClass = ev.error ? 'is-errored' : (ev.ok ? 'is-passed' : 'is-failed');
          const statusLabel = ev.error ? 'ERROR' : (ev.ok ? 'PASSES' : 'FAILS');
          const scopePill = r.scope === 'cross-field'
            ? '<span class="reg-rule-scope is-cross">cross-field</span>'
            : r.scope === 'field'
              ? '<span class="reg-rule-scope is-field">per-field</span>'
              : '';
          return '<li>'
            + '<div class="reg-review-rule-head">'
            +   '<span class="reg-review-rule-name">' + escapeHtml(r.name || '(unnamed)') + '</span>'
            +   scopePill
            +   '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
            + '</div>'
            + '<code class="reg-review-rule-expr">' + escapeHtml(r.expression || '(empty)') + '</code>'
            + (r.on_failure
              ? '<div class="reg-review-rule-onfailure"><span class="reg-review-rule-onfailure-label">On failure:</span> ' + escapeHtml(r.on_failure) + '</div>'
              : '')
          + '</li>';
        }).join('')
      + '</ul>';
  const samplePayloadHtml = '<div class="reg-rules-sample reg-review-rules-sample">'
    +   '<div class="reg-rules-sample-head"><span>Live evaluation payload (synthesised from schema)</span></div>'
    +   '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
    + '</div>';
  const rulesSummaryHtml = '<div class="reg-review-section">'
    +   '<h3>Validation rules · ' + rules.length + '</h3>'
    +   samplePayloadHtml
    +   rulesListHtml
    + '</div>';

  // Sub-section: pack-assignment sidecar (Q6 lock — sidecar inside Review, not its own tab)
  let packSidecarHtml = '<div class="reg-review-section reg-review-pack">';
  packSidecarHtml += '<h3>Add to a pack <span class="reg-review-pack-opt">(optional)</span></h3>';
  if (selectedPack) {
    const sp = packSuggestions.find(s => s.pack.id === selectedPack);
    const spName = sp ? sp.pack.name : selectedPack;
    packSidecarHtml += '<div class="reg-pack-selected">'
      + '<i class="ti ti-check"></i> Added to <strong>' + escapeHtml(spName) + '</strong>'
      + ' <button type="button" class="reg-pack-clear" onclick="regClearPack()" aria-label="Remove from pack">Remove</button>'
      + '</div>';
  } else if (topPack && topPack.score > 0) {
    packSidecarHtml += '<div class="reg-pack-suggest">'
      + '<div class="reg-pack-suggest-head">'
      +   '<i class="ti ti-bolt"></i>'
      +   '<strong>Suggested:</strong> ' + escapeHtml(topPack.pack.name)
      +   '<span class="reg-pack-score">' + topPack.score + '/' + topPack.total + ' field-name match</span>'
      + '</div>'
      + '<div class="reg-pack-suggest-actions">'
      +   '<button type="button" class="btn-primary" data-demo="review.add-to-pack" onclick="regAddToPack(\'' + topPack.pack.id + '\')"><i class="ti ti-plus"></i> Add to ' + escapeHtml(topPack.pack.name) + '</button>'
      +   '<button type="button" class="btn-cancel" onclick="regClearPack()">Skip</button>'
      + '</div>'
      + '</div>';
  } else {
    packSidecarHtml += '<p class="reg-review-empty">No pack-fit suggestions for this schema. You can assign to a pack later from the pack admin page.</p>';
  }
  packSidecarHtml += '</div>';

  // Sub-section: publish actions
  const publishDisabled = !regDraft.composeComplexity || fields.length === 0;
  const publishBlockMsg = fields.length === 0
    ? 'Add at least one field on the Schema tab before publishing.'
    : 'Pick a Compose complexity before publishing.';
  const publishHintHtml = publishDisabled
    ? '<p class="reg-publish-block">' + publishBlockMsg + '</p>'
    : '';
  const publishDisabledAttr = publishDisabled ? ' disabled' : '';
  const publishHtml = '<div class="reg-review-publish">'
    +   publishHintHtml
    +   '<div class="reg-review-publish-actions">'
    +     '<button type="button" class="btn-secondary" data-demo="review.test-as-operator" onclick="regOpenTestModal()"><i class="ti ti-eye"></i> Test as operator</button>'
    +     '<button type="button" class="btn-primary reg-publish-btn"'
    +       ' data-demo="review.publish"'
    +       publishDisabledAttr
    +       ' onclick="regPublish()"><i class="ti ti-upload"></i> ' + escapeHtml(publishLabel) + '</button>'
    +   '</div>'
    + '</div>';

  panel.innerHTML = '<div class="reg-review-body">'
    + headerHtml
    + consequenceHtml
    + schemaSummaryHtml
    + rulesSummaryHtml
    + packSidecarHtml
    + publishHtml
    + '</div>';

  // Smart Start assist provenance chip (ADR 0040 Q14) — appended to the pack
  // sidecar's heading row when assist suggested a pack. Caveats (if any)
  // surface as a banner inside the sidecar.
  const packSug = (typeof regAssistPackSuggestion === 'function') ? regAssistPackSuggestion() : null;
  if (packSug && typeof window.smartStartUi_buildChip === 'function') {
    const packSection = panel.querySelector('.reg-review-pack');
    const heading = packSection ? packSection.querySelector('h3') : null;
    if (heading) {
      const chip = window.smartStartUi_buildChip(packSug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(packSug.id) });
      heading.appendChild(chip);
    }
    if (packSection && (packSug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
      const banner = window.smartStartUi_buildCaveatBanner(packSug);
      if (banner) packSection.appendChild(banner);
    }
  }
}

/* ---------- Publish (Impl F · ADR 0026 + 0039 §8) ----------
 * Snapshot-immutable commit. Adds the new Element version to the in-session
 * DATA_ELEMENTS_BY_DEX catalogue under "Authored this session" (a synthetic
 * group that surfaces just-published elements until a refresh), clears the
 * WIP autosave, fires a one-line toast, and routes back to the catalogue.
 * No celebration modal (Q9 / ADR 0015). */
function regPublish() {
  const fields = regDraft.fields || [];
  if (!regDraft.composeComplexity || fields.length === 0) return;

  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const elementId = regDeriveIdFromName(regDraft.meta.name) + '-' + (regDraft.meta.version || 'v1.0');
  const newEntry = {
    kind: 'leaf',
    id: elementId,
    name: regDraft.meta.name || 'Untitled element',
    version: regDraft.meta.version || 'v1.0',
    icon: 'file-text',
    publishedThisSession: true
  };

  // Append to a synthetic "Authored this session" group so the new element
  // is visibly distinct on the catalogue. Mutates the in-memory fixture for
  // the lifetime of the page — persistence to localStorage is a Phase-2
  // concern (registration becomes a real backend action then).
  try {
    const catalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined') ? DATA_ELEMENTS_BY_DEX[dexCode] : null;
    if (catalog) {
      let sessionGroup = (catalog.groups || []).find(g => g.name === 'Authored this session');
      if (!sessionGroup) {
        sessionGroup = { name: 'Authored this session', count: 0, open: true, elements: [] };
        catalog.groups.unshift(sessionGroup);
      }
      sessionGroup.elements.unshift(newEntry);
      sessionGroup.count = (sessionGroup.elements || []).length;
      catalog.totalCount = (catalog.totalCount || 0) + 1;
    }
  } catch (e) {
    console.warn('Could not append published element to catalogue:', e);
  }

  // Toast — single line per Q9 / ADR 0015 (no celebration modal).
  if (typeof toast === 'function') {
    toast(newEntry.name + ' ' + newEntry.version + ' published. Visible to new Agreements.');
  }

  // Clear the WIP autosave — registration is committed.
  regClearAutosave();
  regResetDraft('new');

  // Route back to the catalogue. Highlight is best-effort — the catalogue
  // page renders from the fixture which now includes our new entry.
  if (typeof goto === 'function') goto('data-elements');
}

/* Demo helper — type a sample value into a Test-as-operator input that is
 * actually referenced by at least one validation rule. Live demos can't
 * pre-name a target field (the schema came from a real extraction; field
 * names vary), but we want the typed keystroke to visibly flip a rule from
 * FAILS to PASSES. Strategy: scan regDraft.rules for the first format-style
 * matches() rule, extract the field name it references, type a value the
 * pattern is likely to satisfy. Returns the field name that was typed into.
 *
 * Pattern-aware value picks (best-effort — falls back to a generic short
 * alphanumeric token if no pattern hint applies). */
function regDemoTypeIntoFirstTestInput(fallbackValue) {
  const modal = document.getElementById('register-test-modal');
  if (!modal) return null;
  const rules = regDraft.rules || [];
  let target = null;
  let typedValue = fallbackValue || 'Sample input';
  // 1) Look for a matches(<field>, "<pattern>") rule we can satisfy.
  for (const rule of rules) {
    const m = /matches\(([a-z0-9_]+)\s*,\s*"([^"]+)"\)/i.exec(rule.expression || '');
    if (!m) continue;
    const fieldName = m[1];
    const pattern   = m[2];
    const input = modal.querySelector('[data-demo="test.input.' + fieldName + '"]');
    if (!input || input.tagName === 'SELECT' || input.type === 'checkbox') continue;
    target = input;
    // Pick a value the pattern accepts.
    typedValue =
        /\\\\d\{4,10\}/.test(pattern)   ? '123456'
      : /STFG.*\\\\d\{7\}/.test(pattern) ? 'S1234567A'
      : /\\\\d\{7\}/.test(pattern)       ? '1234567'
      : /\+.*\\\\d/.test(pattern)         ? '+6512345678'
      : /\^\[A-Z0-9.*\\\\-\]\{6,20\}/.test(pattern) ? 'A1B2C3D4E5'
      : /@/.test(pattern)                 ? 'demo@example.com'
      : 'Sample';
    break;
  }
  // 2) Fall back to the first text input if no format rule exists.
  if (!target) {
    target = modal.querySelector('input[type="text"][data-demo^="test.input."]');
    if (!target) return null;
    typedValue = fallbackValue || 'Sample input';
  }
  target.focus();
  target.value = typedValue;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof regUpdateTestRuleEvals === 'function') regUpdateTestRuleEvals();
  return (target.getAttribute('data-demo') || '').replace(/^test\.input\./, '');
}

/* ---------- Test as operator (Impl F · Q8 deferred from Impl C) ----------
 * Full-screen Composer modal that renders the current schema as the operator
 * will see it post-publish. Uses the existing skeleton renderer's shape but
 * with full Composer chrome (acting-as banner, complexity pill). Read-only —
 * typed values don't propagate back to the field-builder. */
function regOpenTestModal() {
  const modal = document.getElementById('register-test-modal');
  if (!modal) return;
  regRenderTestModal();
  if (typeof openOverlay === 'function') openOverlay('register-test-modal');
}

function regCloseTestModal() {
  if (typeof closeOverlay === 'function') closeOverlay('register-test-modal');
}

/* Collect the operator's typed/selected values from the live modal form,
 * keyed by field name. Mirrors regSynthesizeSamplePayload's defaulting so
 * the resulting object is compatible with regEvalExpression — empty strings
 * for missing text inputs, false for unchecked booleans, 0 for empty
 * numerics, today() for empty dates. */
function regCollectTestPayload() {
  const payload = {};
  (regDraft.fields || []).forEach(f => {
    if (!f.name) return;
    const el = document.getElementById('reg-test-' + f.id);
    if (!el) {
      payload[f.name] = '';
      return;
    }
    switch (f.type) {
      case 'boolean':
        payload[f.name] = !!el.checked;
        break;
      case 'number':
      case 'integer': {
        const v = el.value;
        payload[f.name] = (v === '' || v == null) ? 0 : (f.type === 'integer' ? parseInt(v, 10) : parseFloat(v));
        if (isNaN(payload[f.name])) payload[f.name] = 0;
        break;
      }
      case 'date':
      case 'datetime':
        payload[f.name] = el.value || new Date().toISOString().slice(0, 10);
        break;
      default:
        payload[f.name] = el.value || '';
    }
  });
  return payload;
}

/* Re-evaluate all rules against the current form values + repaint the
 * rule-status badges and submit button. Called on every input change in
 * the Test modal so the operator gets immediate PASS/FAIL feedback. */
function regUpdateTestRuleEvals() {
  const rules = regDraft.rules || [];
  const payload = regCollectTestPayload();
  const list = document.querySelector('[data-reg-test-rules-list]');
  const submit = document.querySelector('[data-reg-test-submit]');
  if (!list) return;
  let anyFailing = false;
  const items = rules.map(r => {
    const ev = regEvalExpression(r.expression, payload);
    const statusClass = ev.error ? 'is-errored' : (ev.ok ? 'is-passed' : 'is-failed');
    const statusLabel = ev.error ? 'ERROR'    : (ev.ok ? 'PASSES'    : 'FAILS');
    if (!ev.ok || ev.error) anyFailing = true;
    return '<li class="reg-test-rule">'
      + '<div class="reg-test-rule-head">'
      +   '<span class="reg-test-rule-name">' + escapeHtml(r.name || '(unnamed rule)') + '</span>'
      +   '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
      + '</div>'
      + '<code class="reg-test-rule-expr">' + escapeHtml(r.expression || '') + '</code>'
      + ((!ev.ok && r.on_failure)
        ? '<div class="reg-test-rule-onfailure"><i class="ti ti-alert-triangle"></i> ' + escapeHtml(r.on_failure) + '</div>'
        : '')
      + (ev.error
        ? '<div class="reg-test-rule-error">Expression error: ' + escapeHtml(ev.error) + '</div>'
        : '')
      + '</li>';
  });
  list.innerHTML = rules.length
    ? items.join('')
    : '<li class="reg-test-rule-empty">No validation rules defined for this element.</li>';
  if (submit) {
    submit.disabled = anyFailing;
    submit.title = anyFailing ? 'Fix the failing rule(s) before submitting.' : '';
  }
}

function regRenderTestModal() {
  const body = document.querySelector('[data-reg-test-body]');
  if (!body) return;
  const name = regDraft.meta.name || 'Untitled element';
  const version = regDraft.meta.version || 'v1.0';
  const complexity = regDraft.composeComplexity || 'simple';
  const isHs = complexity === 'high-stakes';

  // Header bar mimicking the real Composer (acting-as banner per ADR 0030
  // persona resolution + complexity pill per ADR 0025).
  let html = ''
    + '<div class="reg-test-banner">'
    +   '<span class="reg-test-actingas"><i class="ti ti-user-shield"></i> Acting as Cosco · SGTradex</span>'
    +   '<span class="complexity-pill ' + complexity + '">' + complexity + '</span>'
    + '</div>'
    + '<div class="reg-test-meta"><strong>' + escapeHtml(name) + '</strong> · ' + escapeHtml(version) + '</div>';

  if (isHs) {
    html += '<div class="reg-test-stepper">'
      + '<span class="reg-test-step is-active">1. Fill</span>'
      + '<span class="reg-test-step">2. Review</span>'
      + '<span class="reg-test-step">3. Submit</span>'
      + '</div>';
  }

  // Render each field as the operator's Composer would. Every input is wired
  // to regUpdateTestRuleEvals() so the validation badges on the right react
  // live as the operator types — same engine the production Composer uses.
  const renderField = (f) => {
    if (!f.name) return '';
    let out = '<label class="reg-test-field">'
      + '<span class="reg-test-label">' + escapeHtml(humanizeFieldName(f.name)) + (f.required ? ' *' : '') + '</span>';
    const inputId = 'reg-test-' + f.id;
    // Stable demo anchor keyed off the field's name slug (not the runtime
    // `f.id`) so demo flows can target a known field deterministically.
    const demoAttr = ' data-demo="test.input.' + escapeHtml(f.name) + '"';
    const evtAttr = (f.type === 'boolean' || f.type === 'enum')
      ? ' onchange="regUpdateTestRuleEvals()"'
      : ' oninput="regUpdateTestRuleEvals()"';
    switch (f.type) {
      case 'number':
      case 'integer':
        out += '<input id="' + inputId + '"' + demoAttr + ' type="number"' + evtAttr + ' placeholder="' + (f.examples && f.examples[0] ? escapeHtml(String(f.examples[0])) : '') + '">';
        break;
      case 'date':     out += '<input id="' + inputId + '"' + demoAttr + ' type="date"' + evtAttr + '>'; break;
      case 'datetime': out += '<input id="' + inputId + '"' + demoAttr + ' type="datetime-local"' + evtAttr + '>'; break;
      case 'boolean':  out += '<input id="' + inputId + '"' + demoAttr + ' type="checkbox"' + evtAttr + '>'; break;
      case 'enum':
        out += '<select id="' + inputId + '"' + demoAttr + evtAttr + '>';
        ((f.validation && f.validation.enumValues) || []).forEach(v => { out += '<option>' + escapeHtml(v) + '</option>'; });
        out += '</select>';
        break;
      default:
        out += '<input id="' + inputId + '"' + demoAttr + ' type="text"' + evtAttr + ' placeholder="' + (f.examples && f.examples[0] ? escapeHtml(String(f.examples[0])) : '') + '"'
          + (f.validation && f.validation.pattern ? ' pattern="' + escapeHtml(f.validation.pattern) + '"' : '')
          + '>';
    }
    if (f.description) out += '<span class="reg-test-hint">' + escapeHtml(f.description) + '</span>';
    out += '</label>';
    return out;
  };

  // Two-column body: the form on the left, a live "Validation" panel on the
  // right that shows each rule with a PASS / FAILS / ERROR badge that
  // updates every time the operator types. This makes the rules tab's
  // promise concrete — the operator sees exactly what the production
  // Composer would tell them on submission.
  html += '<div class="reg-test-body-grid">';
  html += '<form class="reg-test-form" onsubmit="event.preventDefault(); return false">';
  const testGroups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (testGroups.length) {
    const byGroup = new Map();
    const ungrouped = [];
    testGroups.forEach(g => byGroup.set(g.name, []));
    (regDraft.fields || []).forEach(f => {
      const g = f.group;
      if (g && byGroup.has(g)) byGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    testGroups.forEach(g => {
      const list = byGroup.get(g.name) || [];
      if (!list.length) return;
      html += '<fieldset class="reg-test-group">'
        + '<legend class="reg-test-group-title">' + escapeHtml(g.name)
        +   ' <span class="reg-test-group-count">' + list.length + '</span></legend>'
        + (g.rationale ? '<p class="reg-test-group-rationale">' + escapeHtml(g.rationale) + '</p>' : '')
        + list.map(renderField).join('')
        + '</fieldset>';
    });
    if (ungrouped.length) {
      html += '<fieldset class="reg-test-group">'
        + '<legend class="reg-test-group-title">Other fields'
        +   ' <span class="reg-test-group-count">' + ungrouped.length + '</span></legend>'
        + ungrouped.map(renderField).join('')
        + '</fieldset>';
    }
  } else {
    (regDraft.fields || []).forEach(f => { html += renderField(f); });
  }
  html += '</form>';

  // Validation panel
  html += '<aside class="reg-test-rules">'
    + '<h4 class="reg-test-rules-title">Validation · <span class="reg-test-rules-count">' + (regDraft.rules || []).length + '</span></h4>'
    + '<p class="reg-test-rules-hint">Rules re-evaluate as you type. Submit unlocks only when every rule passes.</p>'
    + '<ul class="reg-test-rules-list" data-reg-test-rules-list></ul>'
    + '</aside>';
  html += '</div>';

  html += '<div class="reg-test-footer">'
    + '<span class="reg-test-mode-hint">Preview only — typed values are discarded on close.</span>'
    + '<button type="button" class="btn-primary" data-reg-test-submit data-demo="test.submit" disabled>' + (isHs ? 'Continue to Review →' : 'Submit') + '</button>'
    + '</div>';

  body.innerHTML = html;
  // Run an initial evaluation pass so the operator sees rule status before
  // typing anything — empty values surface required-when failures up front.
  regUpdateTestRuleEvals();
}

/* ---------- Tab content router ---------- */

/* Wraps the existing per-tab renderers. Called from regRenderTabContent
 * (which only show/hides panels) and from regSwitchTab. Keeping these in a
 * single dispatch makes the tab-add story for Phase 2 (Routing tab) clean. */
function regRenderActiveTabContent() {
  switch (regDraft.currentTab) {
    case 'schema':     regRenderSchemaTab(); break;
    case 'complexity': regRenderComplexityTab(); break;
    case 'rules':      regRenderRulesTab(); break;
    case 'review':     regRenderReviewTab(); break;
  }
}

/* ---------- Entry points (called from app.js stubs) ---------- */

function registerElement_startNewElement() {
  regOpenOnrampPicker();
}

function registerElement_startNewVersion() {
  // +New version skips the on-ramp picker — fork is the only seeder.
  regResetDraft('version');
  regDraft.source.onramp = 'fork';
  regOpenElementPicker('version');
}

/* ---------- Header-input listeners (wired on canvas mount via inline onchange) ---------- */

function regOnMetaNameInput(value) {
  regDraft.meta.name = value;
  regRenderHeader();
  regRenderJsonPreview();
  regScheduleAutosave();
}
function regOnMetaDescriptionInput(value) {
  regDraft.meta.description = value;
  regScheduleAutosave();
}
function regOnMetaCategoryInput(value) {
  regDraft.meta.category = value;
  regScheduleAutosave();
}
function regOnMetaVersionInput(value) {
  regDraft.meta.version = value;
  regScheduleAutosave();
}
function regOnResidencyStrictChange(checked) {
  regDraft.governance.residencyStrict = !!checked;
  // Q11 lock: residency-strict forces compose_complexity to high-stakes per
  // ADR 0025 lines 52-53. Auto-flip if currently Simple, and surface a banner
  // naming the override (never silent mutation).
  if (checked && regDraft.composeComplexity === 'simple') {
    regDraft.composeComplexity = 'high-stakes';
    if (typeof toast === 'function') {
      toast('Compose complexity changed to High-stakes (required for residency-strict elements).');
    }
  } else if (checked && !regDraft.composeComplexity) {
    // Subtler hint when no choice was made yet — the lock will be visible on
    // the Compose complexity tab when the admin lands there.
    if (typeof toast === 'function') {
      toast('Residency-strict ticked — Compose complexity will be locked to high-stakes.');
    }
  }
  // Re-render any tab affected by the toggle.
  if (regDraft.currentTab === 'complexity') regRenderComplexityTab();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* ---------- Window exports for the auto-demo runner (ADR 0037) ----------
 * The demos script will reach into these to script the flow. */
if (typeof window !== 'undefined') {
  window.registerElement_startNewElement = registerElement_startNewElement;
  window.registerElement_startNewVersion = registerElement_startNewVersion;
  window.regSelectOnramp = regSelectOnramp;
  window.regAddField = regAddField;
  window.regSwitchTab = regSwitchTab;
  window.regDiscardAndExit = regDiscardAndExit;
  window.regCloseOnrampPicker = regCloseOnrampPicker;
  window.regCloseElementPicker = regCloseElementPicker;
  window.regOnMetaNameInput = regOnMetaNameInput;
  window.regOnMetaDescriptionInput = regOnMetaDescriptionInput;
  window.regOnMetaCategoryInput = regOnMetaCategoryInput;
  window.regOnMetaVersionInput = regOnMetaVersionInput;
  window.regOnResidencyStrictChange = regOnResidencyStrictChange;
  // Impl E — Compose complexity + Rules tabs
  window.regSelectComplexity = regSelectComplexity;
  window.regComplexityIndicators = regComplexityIndicators;
  window.regRenderComplexityTab = regRenderComplexityTab;
  window.regAddRule = regAddRule;
  window.regUpdateRule = regUpdateRule;
  window.regDeleteRule = regDeleteRule;
  window.regRenderRulesTab = regRenderRulesTab;
  window.regEvalExpression = regEvalExpression;
  window.regSynthesizeSamplePayload = regSynthesizeSamplePayload;
  window.regSuggestedRules = regSuggestedRules;
  window.regAddSuggestionByIndex = regAddSuggestionByIndex;
  window.regAddAllSuggestions    = regAddAllSuggestions;
  window.regRenderActiveTabContent = regRenderActiveTabContent;
  // Impl F — Review tab + publish + pack sidecar + Test-as-operator modal
  window.regRenderReviewTab = regRenderReviewTab;
  window.regPackSuggestions = regPackSuggestions;
  window.regAddToPack = regAddToPack;
  window.regClearPack = regClearPack;
  window.regPublish = regPublish;
  window.regOpenTestModal = regOpenTestModal;
  window.regCloseTestModal = regCloseTestModal;
  window.regRenderTestModal = regRenderTestModal;
  window.regUpdateTestRuleEvals       = regUpdateTestRuleEvals;
  window.regDemoTypeIntoFirstTestInput = regDemoTypeIntoFirstTestInput;
  window.regRenderCanvasFooter = regRenderCanvasFooter;
  // Expose helpers for tests (Impl G adds proper test coverage).
  window.schemaFromFields = schemaFromFields;
  window.fieldsFromSchema = fieldsFromSchema;
  window.regHighlightJson = regHighlightJson;
  // Expose a getter for the working draft so smoke tests and demo runners can
  // inspect state without reaching across module-scope boundaries. The getter
  // returns the live reference; mutating the returned object mutates the draft.
  window.regGetDraft = () => regDraft;
}
