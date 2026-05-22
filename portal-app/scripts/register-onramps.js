/* Smart Start on-ramps for the Data Element registration flow — ADR 0039 §3 + §10.
 *
 * Three implementations live here: Sample data (CSV/JSON parser, REAL), Plain
 * English (faked LLM streaming with canned outputs), and PDF/Form (real
 * Tesseract.js + pdf.js Stage 1; canned Stage 2 schema reveal). The Start-from-
 * existing fork on-ramp lives in register-element.js because it taps the
 * existing catalogue + FORK_SOURCE_SCHEMAS fixtures.
 *
 * Each on-ramp produces a `{ meta?, fields[] }` seed that handoff calls
 * `registerOnramp_completeWithSeed(seed)` to merge into regDraft and open
 * the canvas.
 *
 * Loaded after register-element.js so the seed handoff is in scope.
 */

/* ============================================================
   Sample data on-ramp — REAL CSV / JSON parser + type inference
   ============================================================ */

function regOpenSampleOnramp() {
  if (typeof openOverlay === 'function') openOverlay('register-sample-onramp');
  // Reset the textarea so previous runs don't leak.
  const ta = document.getElementById('reg-sample-input');
  if (ta) ta.value = '';
  const out = document.getElementById('reg-sample-preview');
  if (out) out.innerHTML = '';
  const useBtn = document.getElementById('reg-sample-use-btn');
  if (useBtn) useBtn.disabled = true;
}

function regCloseSampleOnramp() {
  if (typeof closeOverlay === 'function') closeOverlay('register-sample-onramp');
}

/* Parse a user-pasted blob — auto-detect CSV vs JSON, produce { fields[] }.
 * Tolerant of leading whitespace, trailing newlines, BOM. */
function regParseSample(text) {
  if (!text || !text.trim()) return null;
  const stripped = text.trim().replace(/^﻿/, '');
  // JSON detection — first non-ws char is { or [
  if (stripped.startsWith('{') || stripped.startsWith('[')) {
    try {
      const parsed = JSON.parse(stripped);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return regInferFromObjectRows(rows);
    } catch (e) {
      // Fall through to CSV — sometimes pasted JSON has trailing commas / extras.
    }
  }
  return regInferFromCsv(stripped);
}

/* CSV parser — handles quoted fields with embedded commas / newlines / escaped
 * quotes. Assumes first row is headers. Samples up to first 20 rows for type
 * inference. Returns { fields: [...], rowCount }. */
function regInferFromCsv(text) {
  const rows = regCsvSplit(text);
  if (!rows.length) return null;
  const headers = rows[0].map(h => regSlugify(h));
  const body = rows.slice(1).slice(0, 20);
  const fields = headers.map((name, colIdx) => {
    const values = body.map(r => r[colIdx]).filter(v => v !== undefined && v !== null && v !== '');
    return regInferFieldFromValues(name, values);
  });
  return { fields: fields, rowCount: rows.length - 1, source: 'csv' };
}

/* Object-row inference — for JSON arrays of objects, sample up to 20 rows and
 * union the keys. Field types come from the first non-empty value per key. */
function regInferFromObjectRows(rows) {
  if (!rows.length) return null;
  const sampled = rows.slice(0, 20).filter(r => r && typeof r === 'object' && !Array.isArray(r));
  if (!sampled.length) return null;
  const keys = [];
  const seen = new Set();
  sampled.forEach(row => {
    Object.keys(row).forEach(k => { if (!seen.has(k)) { seen.add(k); keys.push(k); } });
  });
  const fields = keys.map(k => {
    const values = sampled.map(r => r[k]).filter(v => v !== undefined && v !== null && v !== '');
    return regInferFieldFromValues(regSlugify(k), values);
  });
  return { fields: fields, rowCount: rows.length, source: 'json' };
}

/* Split CSV text into a 2D array. Quoted fields support commas and \n inside.
 * Escaped quotes are "" inside a quoted field. */
function regCsvSplit(text) {
  const out = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); cell = ''; out.push(row); row = []; }
      else if (c === '\r') { /* ignore — handled by \n */ }
      else cell += c;
    }
  }
  // Final cell + row (no trailing newline).
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(c => c !== ''));
}

/* Infer a single field's type from observed values. Most-specific match wins
 * (date / number / boolean / enum) — falls back to string. */
function regInferFieldFromValues(name, values) {
  const field = { name: name || 'unnamed_field', type: 'string', required: true, description: '', validation: {} };
  if (!values.length) {
    field.required = false;
    field.description = '(empty in sample)';
    return field;
  }
  const strs = values.map(v => String(v).trim());

  // Boolean — true/false/yes/no
  if (strs.every(s => /^(true|false|yes|no)$/i.test(s))) { field.type = 'boolean'; return field; }
  // Integer
  if (strs.every(s => /^-?\d+$/.test(s))) {
    field.type = 'integer';
    const nums = strs.map(s => parseInt(s, 10));
    field.validation.minimum = Math.min.apply(null, nums);
    field.validation.maximum = Math.max.apply(null, nums);
    return field;
  }
  // Number
  if (strs.every(s => /^-?\d+(\.\d+)?$/.test(s))) {
    field.type = 'number';
    const nums = strs.map(s => parseFloat(s));
    field.validation.minimum = Math.min.apply(null, nums);
    field.validation.maximum = Math.max.apply(null, nums);
    return field;
  }
  // Date — YYYY-MM-DD
  if (strs.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s))) { field.type = 'date'; return field; }
  // Datetime — ISO 8601
  if (strs.every(s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s))) { field.type = 'datetime'; return field; }
  // Enum — small set of distinct values (≤8 distinct, all unique values are short)
  const distinct = Array.from(new Set(strs));
  if (distinct.length <= 8 && distinct.length < strs.length && distinct.every(v => v.length < 32)) {
    field.type = 'enum';
    field.validation.enumValues = distinct.slice();
    return field;
  }
  // Otherwise — string. Include length range as hint.
  field.type = 'string';
  const lens = strs.map(s => s.length);
  field.validation.maxLength = Math.max.apply(null, lens);
  if (Math.min.apply(null, lens) > 0) field.validation.minLength = Math.min.apply(null, lens);
  // First example as documentation hint.
  field.examples = [strs[0]];
  return field;
}

function regSlugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/* Live preview as user pastes — re-runs the parser and updates the field count
 * and preview table. Debounced via input handler in markup. */
function regOnSampleInput(text) {
  const out = document.getElementById('reg-sample-preview');
  const useBtn = document.getElementById('reg-sample-use-btn');
  if (!out) return;
  const parsed = regParseSample(text);
  if (!parsed || !parsed.fields.length) {
    out.innerHTML = '<div class="reg-sample-empty">Paste CSV (with header row) or JSON to see inferred fields.</div>';
    if (useBtn) useBtn.disabled = true;
    return;
  }
  let html = '<div class="reg-sample-meta">' + parsed.fields.length + ' field' + (parsed.fields.length === 1 ? '' : 's') + ' inferred · ' + (parsed.rowCount || 0) + ' rows · source: ' + parsed.source.toUpperCase() + '</div>';
  html += '<table class="reg-sample-table"><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Hint</th></tr></thead><tbody>';
  parsed.fields.forEach(f => {
    let hint = '';
    if (f.validation.minimum !== undefined) hint = 'range ' + f.validation.minimum + '–' + f.validation.maximum;
    else if (f.validation.enumValues) hint = f.validation.enumValues.slice(0, 4).join(' / ') + (f.validation.enumValues.length > 4 ? ' …' : '');
    else if (f.examples) hint = 'e.g. ' + f.examples[0];
    else if (f.validation.maxLength) hint = 'max length ' + f.validation.maxLength;
    html += '<tr><td><code>' + escapeHtmlOnramp(f.name) + '</code></td><td>' + f.type + '</td><td>' + (f.required ? '✓' : '—') + '</td><td>' + escapeHtmlOnramp(hint) + '</td></tr>';
  });
  html += '</tbody></table>';
  out.innerHTML = html;
  if (useBtn) useBtn.disabled = false;
}

function regUseSampleSeed() {
  const text = (document.getElementById('reg-sample-input') || {}).value || '';
  const parsed = regParseSample(text);
  if (!parsed || !parsed.fields.length) return;
  regCloseSampleOnramp();
  registerOnramp_completeWithSeed({
    fields: parsed.fields,
    meta: {},
    source: { onramp: 'sample', sampleSource: parsed.source }
  });
}

/* Drag-drop file handling for the sample on-ramp (CSV + JSON files only). */
function regOnSampleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    const ta = document.getElementById('reg-sample-input');
    if (ta) {
      ta.value = reader.result || '';
      regOnSampleInput(ta.value);
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   Plain English on-ramp — faked LLM streaming + canned schemas
   ============================================================ */

/* Three canned example prompts + the schemas they "produce." User-supplied
 * prompts route to the closest example via keyword score; visible note shows
 * which example was used (honesty per ADR 0039 §10). */
const REG_NL_EXAMPLES = [
  {
    id: 'concrete',
    keywords: ['concrete', 'cube', 'strength', 'bca', 'mpa', 'grade', 'compressive'],
    prompt: 'Concrete cube test submitted by contractors to BCA with project reference, sample date, location, and compressive strength in MPa.',
    seed: {
      meta: { name: 'Concrete cube test', category: 'Concrete tests', description: 'Compressive strength test result for a concrete sample.' },
      fields: [
        { name: 'project_reference',          type: 'string',  required: true,  description: 'BCA project reference number', validation: { pattern: '^[A-Z]{3}-\\d{6}$' } },
        { name: 'sample_date',                type: 'date',    required: true,  description: 'Date the sample was cast' },
        { name: 'test_date',                  type: 'date',    required: true,  description: 'Date the sample was tested' },
        { name: 'location',                   type: 'string',  required: true,  description: 'Site location reference' },
        { name: 'compressive_strength_mpa',   type: 'number',  required: true,  description: 'Compressive strength (MPa)', validation: { minimum: 0, maximum: 200 } },
        { name: 'concrete_grade',             type: 'enum',    required: true,  description: 'Design grade', validation: { enumValues: ['C20', 'C25', 'C30', 'C40', 'C50', 'C60'] } }
      ]
    }
  },
  {
    id: 'vessel-arrival',
    keywords: ['vessel', 'arrival', 'eta', 'port', 'imo', 'ship', 'voyage'],
    prompt: 'Vessel arrival notification with vessel name, IMO number, ETA, port of arrival, and agent contact.',
    seed: {
      meta: { name: 'Vessel arrival notification', category: 'Logistics & tracking', description: 'Inbound vessel arrival notice with ETA and port details.' },
      fields: [
        { name: 'vessel_name',     type: 'string',   required: true,  description: 'Name of the arriving vessel' },
        { name: 'vessel_imo',      type: 'string',   required: true,  description: 'IMO vessel identifier', validation: { pattern: '^\\d{7}$' } },
        { name: 'voyage_number',   type: 'string',   required: true,  description: 'Voyage reference' },
        { name: 'eta',             type: 'datetime', required: true,  description: 'Estimated arrival (ISO 8601)' },
        { name: 'port_of_arrival', type: 'string',   required: true,  description: 'UN/LOCODE port of arrival' },
        { name: 'agent_name',      type: 'string',   required: true,  description: 'Local agent contact' },
        { name: 'agent_email',     type: 'string',   required: false, description: 'Agent email (optional)' }
      ]
    }
  },
  {
    id: 'bunker',
    keywords: ['bunker', 'fuel', 'delivery', 'supplier', 'quantity', 'mt', 'grade'],
    prompt: 'Bunker delivery report from supplier with vessel name, fuel grade, quantity in metric tons, and delivery date.',
    seed: {
      meta: { name: 'Bunker delivery report', category: 'Bunker & fuel', description: 'Confirmation of marine fuel delivery to a vessel.' },
      fields: [
        { name: 'delivery_id',    type: 'string',   required: true,  description: 'Delivery reference number' },
        { name: 'supplier_name',  type: 'string',   required: true,  description: 'Licensed bunker supplier' },
        { name: 'vessel_name',    type: 'string',   required: true,  description: 'Receiving vessel name' },
        { name: 'fuel_grade',     type: 'enum',     required: true,  description: 'Fuel specification grade', validation: { enumValues: ['MGO', 'VLSFO', 'HSFO', 'LSMGO', 'LFO'] } },
        { name: 'quantity_mt',    type: 'number',   required: true,  description: 'Quantity in metric tons', validation: { minimum: 0 } },
        { name: 'delivery_date',  type: 'date',     required: true,  description: 'Date of delivery' },
        { name: 'delivery_port',  type: 'string',   required: true,  description: 'Port of delivery' }
      ]
    }
  },
  {
    id: 'env-site-obs',
    keywords: ['environmental', 'site', 'observation', 'observations', 'env', 'site-obs', 'siteobs', 'env-signoff'],
    prompt: 'Environmental site observation submitted by main contractors to BCA with observation reference, date, project ID, and site location.',
    seed: {
      meta: { name: 'Environmental site observations', category: 'Environmental compliance', description: 'On-site environmental observation recorded by main contractors per BCA Environmental Site Observation Specification v1.4.' },
      fields: [
        { name: 'observation_id',    type: 'string',  required: true,  description: 'Unique observation reference (ENV-YYYY-MM-DD-NNN)' },
        { name: 'observation_date',  type: 'date',    required: true,  description: 'Date the observation was recorded' },
        { name: 'project_id',        type: 'string',  required: true,  description: 'BCA project identifier' },
        { name: 'site_location',     type: 'string',  required: true,  description: 'Description of the site area observed' }
      ]
    }
  },
  {
    id: 'lab-result',
    keywords: ['lab', 'laboratory', 'result', 'patient', 'test', 'hsa', 'pathology', 'specimen', 'clinical'],
    prompt: 'Lab result data element exchanged between accredited laboratories and clinics under HSA guidance with result ID, patient ID, test date, and result.',
    seed: {
      meta: { name: 'Lab result', category: 'Clinical results', description: 'Accredited lab result exchanged under HSA Clinical Data Exchange guidance.' },
      fields: [
        { name: 'result_id',     type: 'string', required: true,  description: 'Unique lab result reference' },
        { name: 'patient_id',    type: 'string', required: true,  description: 'Patient identifier (NRIC / FIN)' },
        { name: 'test_date',     type: 'date',   required: true,  description: 'Date the test was performed' },
        { name: 'test_result',   type: 'string', required: true,  description: 'Result value or summary' }
      ]
    }
  }
];

let regNlStreamTimer = null;

function regOpenNlOnramp() {
  if (typeof openOverlay === 'function') openOverlay('register-nl-onramp');
  const ta = document.getElementById('reg-nl-input');
  if (ta) ta.value = '';
  const stream = document.getElementById('reg-nl-stream');
  if (stream) { stream.innerHTML = ''; stream.classList.remove('is-active'); }
  const useBtn = document.getElementById('reg-nl-use-btn');
  if (useBtn) useBtn.disabled = true;
  const note = document.getElementById('reg-nl-match-note');
  if (note) note.textContent = '';
}

function regCloseNlOnramp() {
  if (regNlStreamTimer) { clearInterval(regNlStreamTimer); regNlStreamTimer = null; }
  if (typeof closeOverlay === 'function') closeOverlay('register-nl-onramp');
}

function regUseNlExample(exampleId) {
  const example = REG_NL_EXAMPLES.find(e => e.id === exampleId);
  if (!example) return;
  const ta = document.getElementById('reg-nl-input');
  if (ta) ta.value = example.prompt;
  regGenerateFromNl();
}

function regGenerateFromNl() {
  const text = (document.getElementById('reg-nl-input') || {}).value || '';
  if (!text.trim()) return;
  // Pick closest example by keyword match (simple bag-of-words score).
  const score = REG_NL_EXAMPLES.map(ex => ({
    ex: ex,
    score: ex.keywords.reduce((s, k) => s + (text.toLowerCase().includes(k) ? 1 : 0), 0)
  }));
  score.sort((a, b) => b.score - a.score);
  const chosen = score[0].ex;
  const isUserMatchPerfect = score[0].score >= 3;
  const matchedExample = REG_NL_EXAMPLES.find(e => e.prompt === text.trim());
  const note = document.getElementById('reg-nl-match-note');
  if (note) {
    if (matchedExample) {
      note.textContent = ''; // exact example — no note needed
    } else {
      note.innerHTML = '<i class="ti ti-info-circle" style="font-size: 12px"></i> Using example output for demo (' + chosen.id + '). Production version generates a fresh schema from your description.';
    }
  }
  // Arm the "Use this schema" button immediately — the seed is decided at this
  // moment (whichever example matched), and there's no reason to make the user
  // wait through the stream animation to be able to commit. The stream is
  // visual eye-candy; functionally the choice is locked once Generate fires.
  // This also makes the demo runner work in headless mode (where sleeps
  // collapse to 0, so the stream's setInterval-driven completion handler may
  // not arm the button before the demo's next click).
  const useBtn = document.getElementById('reg-nl-use-btn');
  if (useBtn) { useBtn.disabled = false; useBtn.dataset.seedId = chosen.id; }

  // Stream the generated schema text character-by-character (~30 chars/sec, ~3s for typical output).
  const target = document.getElementById('reg-nl-stream');
  if (!target) return;
  target.innerHTML = '';
  target.classList.add('is-active');
  const fullText = regNlSchemaToStreamText(chosen.seed);
  let i = 0;
  const charsPerTick = 4;
  const tickMs = 30;
  if (regNlStreamTimer) clearInterval(regNlStreamTimer);
  regNlStreamTimer = setInterval(() => {
    i += charsPerTick;
    target.textContent = fullText.slice(0, i);
    target.scrollTop = target.scrollHeight;
    if (i >= fullText.length) {
      clearInterval(regNlStreamTimer);
      regNlStreamTimer = null;
      target.classList.remove('is-active');
    }
  }, tickMs);
}

function regNlSchemaToStreamText(seed) {
  // Human-readable stream text — not raw JSON. Reads like "the LLM is thinking
  // about your schema" rather than dumping JSON suddenly.
  let out = 'Reading your description…\n\nThis looks like ' + seed.meta.name + '.\n\nInferred fields:\n\n';
  seed.fields.forEach(f => {
    out += '  • ' + f.name + ' (' + f.type + (f.required ? ', required' : '') + ')';
    if (f.description) out += ' — ' + f.description;
    out += '\n';
  });
  out += '\nReady to seed the canvas.';
  return out;
}

function regUseNlSeed() {
  const useBtn = document.getElementById('reg-nl-use-btn');
  const seedId = useBtn && useBtn.dataset.seedId;
  const example = REG_NL_EXAMPLES.find(e => e.id === seedId);
  if (!example) return;
  regCloseNlOnramp();
  registerOnramp_completeWithSeed({
    fields: example.seed.fields,
    meta: example.seed.meta,
    source: { onramp: 'nl', exampleId: seedId }
  });
}

/* ============================================================
   PDF / Form on-ramp — REAL Tesseract.js + pdf.js (CDN lazy-loaded)
   ============================================================ */

/* CDN URLs — pinned versions. Network needed only at first invocation of this
 * on-ramp; subsequent calls reuse the loaded library. Failure surfaces a clean
 * error so the operator understands the network dependency rather than getting
 * a silent dead button.
 *
 * Three libraries, lazy-loaded independently so users who only ever process
 * Word docs don't pay the 5 MB Tesseract download, and vice versa:
 *   - tesseract.js  ~5 MB  — OCR for PDF pages + images
 *   - pdf.js        ~2 MB  — renders PDF pages to canvas for Tesseract
 *   - mammoth.js  ~600 KB  — extracts text from .docx (no OCR; already text)
 */
const REG_TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
const REG_PDFJS_CDN     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const REG_PDFJS_WORKER  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const REG_MAMMOTH_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

let regOcrLibsLoaded = false;
let regOcrLibsLoading = null;
let regDocxLibLoaded = false;
let regDocxLibLoading = null;

/* Run-token pattern — each new file invocation increments the token; in-flight
 * OCR loops compare against the live token before mutating DOM, so a cancelled
 * run silently no-ops instead of racing the new run. Avoids the "modal stops
 * responding on second use" bug where Tesseract's previous worker writes stale
 * progress / extracted text into a freshly reset modal. Tesseract.js v5 has no
 * clean cancellation API; this is the standard work-around. */
let regFormRunToken = 0;

function regLoadOcrLibs() {
  if (regOcrLibsLoaded) return Promise.resolve();
  if (regOcrLibsLoading) return regOcrLibsLoading;
  regOcrLibsLoading = Promise.all([
    regLoadScript(REG_PDFJS_CDN),
    regLoadScript(REG_TESSERACT_CDN)
  ]).then(() => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = REG_PDFJS_WORKER;
    }
    regOcrLibsLoaded = true;
  });
  return regOcrLibsLoading;
}

function regLoadDocxLib() {
  if (regDocxLibLoaded) return Promise.resolve();
  if (regDocxLibLoading) return regDocxLibLoading;
  regDocxLibLoading = regLoadScript(REG_MAMMOTH_CDN).then(() => {
    regDocxLibLoaded = true;
  });
  return regDocxLibLoading;
}

function regLoadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}

/* Classify a file by extension into one of: 'pdf', 'docx', 'doc' (legacy
 * binary, unsupported), 'image', or 'unknown'. Used to dispatch between the
 * three extraction paths (OCR / pdf.js / mammoth.js). */
function regClassifyFile(file) {
  if (!file || !file.name) return 'unknown';
  const name = file.name.toLowerCase();
  if (/\.pdf$/.test(name)) return 'pdf';
  if (/\.docx$/.test(name)) return 'docx';
  if (/\.doc$/.test(name)) return 'doc';
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name)) return 'image';
  // Fall back to MIME if extension absent.
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (file.type === 'application/msword') return 'doc';
  if ((file.type || '').indexOf('image/') === 0) return 'image';
  return 'unknown';
}

function regOpenFormOnramp() {
  regResetFormOnramp();
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof openOverlay === 'function') openOverlay('register-form-onramp');
}

/* Dynamically populate the modal description so the operator can see at a
 * glance which extraction engine is active. Three states:
 *   · VLM key saved → "PDF / image / Word: AI extraction via {provider}".
 *   · No key saved  → original Tesseract / mammoth copy.
 *   · DOCX-only contexts read the same dynamic string; mammoth always runs
 *     first regardless, with the AI step layered on top when the key is set.
 */
function regRefreshFormEngineBlurb() {
  const el = document.getElementById('reg-form-engine-blurb');
  if (!el) return;
  const ssa = window.smartStart || {};
  const vlmProvider = (typeof ssa.getVlmProvider === 'function') ? ssa.getVlmProvider() : null;
  const keyByProvider = {
    anthropic: (typeof ssa.getApiKey      === 'function') ? ssa.getApiKey()      : null,
    moonshot:  (typeof ssa.getMoonshotKey === 'function') ? ssa.getMoonshotKey() : null,
    xai:       (typeof ssa.getXaiKey      === 'function') ? ssa.getXaiKey()      : null,
  };
  const providerDisplay = {
    anthropic: 'Anthropic Claude (Sonnet 4.6 vision)',
    moonshot:  'Moonshot Kimi 2.6',
    xai:       'xAI Grok 4.2',
  };
  const vlmKey = vlmProvider ? keyByProvider[vlmProvider] : null;
  if (vlmKey) {
    const providerLabel = providerDisplay[vlmProvider] || vlmProvider;
    el.innerHTML = '<strong>AI extraction is ON</strong> — every page of the uploaded form is sent to <strong>' +
      providerLabel + '</strong> for structured field extraction. <strong>Word (.docx)</strong> uses mammoth.js for text + ' +
      'AI extraction on the text. <strong>PDF / image</strong> uses pdf.js rendering + AI vision (no Tesseract). ' +
      'Falls back to Tesseract OCR if the AI call fails.';
  } else {
    el.innerHTML = 'Three paths, all processed locally in your browser. <strong>Word (.docx)</strong>: text extracted directly via mammoth.js — ' +
      'no OCR pass needed. <strong>PDF / image</strong>: real Tesseract.js OCR (with pdf.js rendering pages to canvas first). ' +
      'Stage 2 maps extracted text to schema fields. ' +
      '<strong>Save an Anthropic, Moonshot or xAI API key in the Smart Start assist panel below to enable AI extraction</strong> ' +
      '(per-page VLM call, structured field list instead of keyword-canned schemas).';
  }
}

/* ---------- Smart Start assist API-key affordance (ADR 0040 §16.3) ---------- */

/* Anthropic (LLM overlay) — suggestion synthesis. */
function regSaveAssistKey() {
  const input = document.getElementById('reg-form-assist-key-input');
  if (!input) return;
  const key = (input.value || '').trim();
  if (!key) {
    regClearAssistKey();
    return;
  }
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setApiKey === 'function') {
    window.smartStart.setApiKey(key);
  }
  input.value = '';
  // Re-run both the chrome sync (enables radios, swaps input→saved-tag) AND
  // the status badge — saving a key must update both UI layers, not just the
  // status pill. (Previously only the status pill refreshed, leaving the
  // newly-enabled provider radios stuck in their disabled state.)
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Anthropic key saved (LLM overlay live)');
}

function regClearAssistKey() {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.clearApiKey === 'function') {
    window.smartStart.clearApiKey();
  }
  const input = document.getElementById('reg-form-assist-key-input');
  if (input) input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Anthropic key cleared');
}

/* Moonshot / Kimi 2.6 (VLM) — PDF → field extraction. */
function regSaveMoonshotKey() {
  const input = document.getElementById('reg-form-moonshot-key-input');
  if (!input) return;
  const key = (input.value || '').trim();
  if (!key) {
    regClearMoonshotKey();
    return;
  }
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setMoonshotKey === 'function') {
    window.smartStart.setMoonshotKey(key);
  }
  input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Moonshot/Kimi key saved (VLM live)');
}

function regClearMoonshotKey() {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.clearMoonshotKey === 'function') {
    window.smartStart.clearMoonshotKey();
  }
  const input = document.getElementById('reg-form-moonshot-key-input');
  if (input) input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Moonshot/Kimi key cleared');
}

/* xAI Grok 4.2 — third provider (VLM and/or LLM overlay). */
function regSaveXaiKey() {
  const input = document.getElementById('reg-form-xai-key-input');
  if (!input) return;
  const key = (input.value || '').trim();
  if (!key) {
    regClearXaiKey();
    return;
  }
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setXaiKey === 'function') {
    window.smartStart.setXaiKey(key);
  }
  input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · xAI Grok key saved');
}

function regClearXaiKey() {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.clearXaiKey === 'function') {
    window.smartStart.clearXaiKey();
  }
  const input = document.getElementById('reg-form-xai-key-input');
  if (input) input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · xAI Grok key cleared');
}

/* Provider selectors — both VLM and LLM independently pick between Anthropic
 * Claude and Moonshot Kimi K2.6. Keys are shared per provider: the Anthropic
 * key powers any Anthropic-selected path (overlay AND/OR VLM); the Moonshot
 * key powers any Moonshot-selected path. */
const REG_PROVIDER_DISPLAY_NAMES = {
  anthropic: 'Anthropic Claude',
  moonshot:  'Moonshot Kimi K2.6',
  xai:       'xAI Grok 4.2',
};

function regSelectOverlayProvider(provider) {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setOverlayProvider === 'function') {
    window.smartStart.setOverlayProvider(provider);
  }
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') {
    toast('Smart Start assist · LLM overlay provider: ' + (REG_PROVIDER_DISPLAY_NAMES[provider] || provider));
  }
}

function regSelectVlmProvider(provider) {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setVlmProvider === 'function') {
    window.smartStart.setVlmProvider(provider);
  }
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') {
    toast('Smart Start assist · VLM provider: ' + (REG_PROVIDER_DISPLAY_NAMES[provider] || provider));
  }
}

/* Keys-first sync (per the keys-then-models UX). The chrome reflects:
 *   1. Each key input row is shown when its key is UNSET, replaced by a
 *      green "saved" tag when SET (input row hidden once saved).
 *   2. Each provider radio is enabled only when its required key is saved;
 *      others appear greyed with `reg-form-overlay-provider-option-disabled`.
 *   3. If the configured provider depends on a key that isn't saved but the
 *      other provider's key is, auto-flip the selection — a key-clear feels
 *      like a one-click switch instead of leaving an invalid selection.
 *   4. If neither key is saved, hide the provider rows entirely and surface
 *      a canned-mode hint.
 */
function regSyncOverlayProviderUi() {
  const ssa = window.smartStart || {};
  const anthropicKey = (typeof ssa.getApiKey      === 'function') ? ssa.getApiKey()      : null;
  const moonshotKey  = (typeof ssa.getMoonshotKey === 'function') ? ssa.getMoonshotKey() : null;
  const xaiKey       = (typeof ssa.getXaiKey      === 'function') ? ssa.getXaiKey()      : null;
  const keyByProvider = { anthropic: anthropicKey, moonshot: moonshotKey, xai: xaiKey };

  // Auto-flip provider when its required key is missing but another is set.
  // Preference order on flip: anthropic → moonshot → xai.
  const fixProvider = (p) => {
    if (keyByProvider[p]) return p;
    if (anthropicKey) return 'anthropic';
    if (moonshotKey)  return 'moonshot';
    if (xaiKey)       return 'xai';
    return p;
  };
  let overlayProvider = (typeof ssa.getOverlayProvider === 'function') ? ssa.getOverlayProvider() : 'anthropic';
  let vlmProvider     = (typeof ssa.getVlmProvider     === 'function') ? ssa.getVlmProvider()     : 'moonshot';
  const newOverlay = fixProvider(overlayProvider);
  const newVlm     = fixProvider(vlmProvider);
  if (newOverlay !== overlayProvider && typeof ssa.setOverlayProvider === 'function') ssa.setOverlayProvider(newOverlay);
  if (newVlm     !== vlmProvider     && typeof ssa.setVlmProvider     === 'function') ssa.setVlmProvider(newVlm);
  overlayProvider = newOverlay;
  vlmProvider     = newVlm;

  // Section 1 — key rows: input visible only when unsaved; "saved" tag visible only when saved.
  const anthRow = document.getElementById('reg-form-assist-anthropic-row');
  const anthTag = document.getElementById('reg-form-assist-anthropic-saved-tag');
  if (anthRow) anthRow.hidden = !!anthropicKey;
  if (anthTag) anthTag.hidden = !anthropicKey;
  const moonRow = document.getElementById('reg-form-moonshot-row');
  const moonTag = document.getElementById('reg-form-assist-moonshot-saved-tag');
  if (moonRow) moonRow.hidden = !!moonshotKey;
  if (moonTag) moonTag.hidden = !moonshotKey;
  const xaiRow = document.getElementById('reg-form-xai-row');
  const xaiTag = document.getElementById('reg-form-assist-xai-saved-tag');
  if (xaiRow) xaiRow.hidden = !!xaiKey;
  if (xaiTag) xaiTag.hidden = !xaiKey;

  // Section 2 — provider radios: disable options whose required key isn't saved.
  document.querySelectorAll('.reg-form-overlay-provider-option').forEach(opt => {
    const requires = opt.getAttribute('data-requires-key');
    if (!requires) return;
    const hasKey = !!keyByProvider[requires];
    opt.classList.toggle('reg-form-overlay-provider-option-disabled', !hasKey);
    const input = opt.querySelector('input[type="radio"]');
    if (input) input.disabled = !hasKey;
  });
  document.querySelectorAll('input[name="reg-form-overlay-provider"]').forEach(r => {
    r.checked = (r.value === overlayProvider);
  });
  document.querySelectorAll('input[name="reg-form-vlm-provider"]').forEach(r => {
    r.checked = (r.value === vlmProvider);
  });

  // Empty state — hide provider rows entirely when no keys saved.
  const anyKey = !!(anthropicKey || moonshotKey || xaiKey);
  document.querySelectorAll('.reg-form-assist-providers-section .reg-form-assist-key-provider').forEach(el => {
    el.hidden = !anyKey;
  });
  const emptyMsg = document.getElementById('reg-form-assist-providers-empty');
  if (emptyMsg) emptyMsg.hidden = anyKey;

  // Section 3 — per-row Save / Clear button state. Save lights up only when
  // the input has content that isn't already the saved value; Clear lights
  // up only when the input has content. After a key is saved the entire row
  // is hidden, so the button state inside the row only matters while the row
  // is visible (i.e. the key isn't yet saved). Synced on every UI refresh
  // AND on every keystroke via regOnAssistKeyInput.
  regSyncAllKeyButtonStates();
}

/* Sync the Save / Clear button enablement for every key row. */
function regSyncAllKeyButtonStates() {
  ['anthropic', 'moonshot', 'xai'].forEach(regSyncKeyButtonState);
}

/* Single-provider button-state syncer — invoked on every keystroke. The Save
 * button is enabled when the input value is non-empty AND differs from the
 * saved value (so re-saving the same value is blocked). The Clear button is
 * enabled when the input value is non-empty. */
function regSyncKeyButtonState(provider) {
  const inputId = provider === 'anthropic' ? 'reg-form-assist-key-input'
                : provider === 'moonshot'  ? 'reg-form-moonshot-key-input'
                :                              'reg-form-xai-key-input';
  const saveBtnId  = provider === 'anthropic' ? 'reg-form-assist-save-btn'
                  : provider === 'moonshot'  ? 'reg-form-moonshot-save-btn'
                  :                              'reg-form-xai-save-btn';
  const clearBtnId = provider === 'anthropic' ? 'reg-form-assist-clear-btn'
                  : provider === 'moonshot'  ? 'reg-form-moonshot-clear-btn'
                  :                              'reg-form-xai-clear-btn';
  const input    = document.getElementById(inputId);
  const saveBtn  = document.getElementById(saveBtnId);
  const clearBtn = document.getElementById(clearBtnId);
  if (!input) return;
  const ssa = window.smartStart || {};
  const savedKey = provider === 'anthropic' ? (typeof ssa.getApiKey      === 'function' ? ssa.getApiKey()      : null)
                : provider === 'moonshot'  ? (typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null)
                :                              (typeof ssa.getXaiKey      === 'function' ? ssa.getXaiKey()      : null);
  const value = (input.value || '').trim();
  const hasInput = value.length > 0;
  const isAlreadySaved = !!savedKey && value === savedKey;
  if (saveBtn)  saveBtn.disabled  = !hasInput || isAlreadySaved;
  if (clearBtn) clearBtn.disabled = !hasInput;
}

/* Per-keystroke handler bound from the HTML inputs. Hits the syncer for the
 * matching provider only — cheap and avoids redundant work on the others. */
function regOnAssistKeyInput(provider) {
  regSyncKeyButtonState(provider);
}

/* Status badge — reflects both provider preferences AND the keys available
 * for each. Each path (llm overlay, vlm) is independently live or canned. */
function regRefreshAssistKeyStatus() {
  const statusEl = document.getElementById('reg-form-assist-key-status');
  if (!statusEl) return;
  const ssa = window.smartStart || {};
  const overlayProvider = (typeof ssa.getOverlayProvider === 'function') ? ssa.getOverlayProvider() : 'anthropic';
  const vlmProvider     = (typeof ssa.getVlmProvider     === 'function') ? ssa.getVlmProvider()     : 'moonshot';
  const anthropicKey = (typeof ssa.getApiKey      === 'function') ? ssa.getApiKey()      : null;
  const moonshotKey  = (typeof ssa.getMoonshotKey === 'function') ? ssa.getMoonshotKey() : null;
  const xaiKey       = (typeof ssa.getXaiKey      === 'function') ? ssa.getXaiKey()      : null;
  const keyByProvider = { anthropic: anthropicKey, moonshot: moonshotKey, xai: xaiKey };
  const shortLabel    = { anthropic: 'claude', moonshot: 'kimi', xai: 'grok' };

  const overlayKey = keyByProvider[overlayProvider];
  const vlmKey     = keyByProvider[vlmProvider];
  const overlayLabel = shortLabel[overlayProvider] || overlayProvider;
  const vlmLabel     = shortLabel[vlmProvider]     || vlmProvider;

  let text, isLive;
  if (overlayKey && vlmKey) {
    text = 'live · llm:' + overlayLabel + ' · vlm:' + vlmLabel;
    isLive = true;
  } else if (overlayKey) {
    text = 'partial · llm:' + overlayLabel + ' live · vlm canned';
    isLive = true;
  } else if (vlmKey) {
    text = 'partial · vlm:' + vlmLabel + ' live · llm canned';
    isLive = true;
  } else {
    text = 'canned suggestions';
    isLive = false;
  }
  statusEl.textContent = text;
  statusEl.classList.toggle('is-live', isLive);
}

if (typeof window !== 'undefined') {
  window.regSaveAssistKey          = regSaveAssistKey;
  window.regClearAssistKey         = regClearAssistKey;
  window.regSaveMoonshotKey        = regSaveMoonshotKey;
  window.regClearMoonshotKey       = regClearMoonshotKey;
  window.regSaveXaiKey             = regSaveXaiKey;
  window.regClearXaiKey            = regClearXaiKey;
  window.regRefreshAssistKeyStatus = regRefreshAssistKeyStatus;
  window.regSelectOverlayProvider  = regSelectOverlayProvider;
  window.regSelectVlmProvider      = regSelectVlmProvider;
  window.regSyncOverlayProviderUi  = regSyncOverlayProviderUi;
  window.regOnAssistKeyInput       = regOnAssistKeyInput;
  window.regSyncAllKeyButtonStates = regSyncAllKeyButtonStates;
  window.regSyncKeyButtonState     = regSyncKeyButtonState;
}

function regCloseFormOnramp() {
  if (typeof closeOverlay === 'function') closeOverlay('register-form-onramp');
  // Reset on close too — covers the case where the user closed mid-OCR via
  // the X button (any in-flight run is cancelled via the token bump).
  regResetFormOnramp();
}

/* Shared reset — invoked on open AND close. Bumps the run token so any
 * in-flight OCR loop bails out the next time it checks. Clears file inputs
 * inside the modal so re-picking the same file fires `change` again. */
function regResetFormOnramp() {
  regFormRunToken += 1;
  regSetFormStage('idle');
  const extracted = document.getElementById('reg-form-extracted');
  if (extracted) extracted.textContent = '';
  const summary = document.getElementById('reg-form-summary');
  if (summary) summary.innerHTML = '';
  const errBox = document.getElementById('reg-form-error');
  if (errBox) errBox.textContent = '';
  const useBtn = document.getElementById('reg-form-use-btn');
  if (useBtn) { useBtn.disabled = true; delete useBtn.dataset.seedId; }
  // Clear file inputs so picking the same file twice fires the change event.
  // Browser quirk: <input type="file"> doesn't re-fire change when the value
  // is unchanged. Setting value = '' resets the cached selection.
  document.querySelectorAll('#register-form-onramp input[type="file"]').forEach(input => {
    try { input.value = ''; } catch (e) { /* some browsers throw if value is non-empty and untrusted; ignore */ }
  });
  // Reset progress bar / text so the next run starts from a clean visual.
  regSetFormProgress('', 0);
}

function regSetFormStage(stage) {
  const stages = document.querySelectorAll('[data-reg-form-stage]');
  stages.forEach(el => { el.hidden = el.getAttribute('data-reg-form-stage') !== stage; });
  // Use-this-schema CTA stays disabled until a seed actually lands ('done').
  // Previously the button could be left enabled from a prior file when the
  // operator dropped a second file in the same modal session — fixed by
  // resetting on every stage transition that isn't 'done'.
  //
  // The label also tracks the stage so the "disabled" appearance has a
  // *reason* visible inside the button itself (a grey button labelled
  // "Use this schema" reads as broken; one labelled "AI extracting…" reads
  // as in-progress). On 'done' the original label is restored.
  const useBtn = document.getElementById('reg-form-use-btn');
  if (useBtn) {
    useBtn.disabled = (stage !== 'done');
    if (stage !== 'done') {
      // Strip the previous seedId so an old run's value can't be re-handed
      // off accidentally if the operator clicks during a stale window.
      delete useBtn.dataset.seedId;
    }
    if (!useBtn.dataset.defaultLabel) {
      useBtn.dataset.defaultLabel = useBtn.innerHTML;
    }
    const busyLabel = {
      idle:       null,
      loading:    '<i class="ti ti-loader-2 reg-form-use-spin"></i> Loading…',
      extracting: '<i class="ti ti-loader-2 reg-form-use-spin"></i> AI extracting…',
      detecting:  '<i class="ti ti-loader-2 reg-form-use-spin"></i> Building schema…',
      error:      null,
      done:       null,
    }[stage];
    if (busyLabel) {
      useBtn.innerHTML = busyLabel;
      useBtn.setAttribute('aria-busy', 'true');
    } else {
      useBtn.innerHTML = useBtn.dataset.defaultLabel;
      useBtn.removeAttribute('aria-busy');
    }
  }
}

function regSetFormProgress(text, pct) {
  const t = document.getElementById('reg-form-progress-text');
  const b = document.getElementById('reg-form-progress-bar');
  if (t) t.textContent = text || '';
  if (b && typeof pct === 'number') b.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function regOnFormFile(file) {
  if (!file) return;
  const kind = regClassifyFile(file);

  // Bump the run token — this invocation is now the "live" run; earlier
  // in-flight OCR loops will short-circuit when they re-check the token.
  regFormRunToken += 1;
  const myToken = regFormRunToken;

  // .doc (legacy binary) is intentionally unsupported — mammoth.js handles
  // only the modern .docx (Office Open XML / ZIP) format. Show a friendly
  // error instead of attempting and failing silently.
  if (kind === 'doc') {
    regSetFormStage('error');
    const errBox = document.getElementById('reg-form-error');
    if (errBox) errBox.textContent = 'Legacy .doc files are not supported. Please save the document as .docx and try again. (Tip: open it in Word and use File → Save As → Word Document.)';
    return;
  }

  if (kind === 'unknown') {
    regSetFormStage('error');
    const errBox = document.getElementById('reg-form-error');
    if (errBox) errBox.textContent = 'Unsupported file type. The Form on-ramp accepts PDF, Word (.docx), and images (PNG / JPEG / GIF / WebP / TIFF).';
    return;
  }

  regSetFormStage('loading');

  // .docx → mammoth.js (lightweight, no OCR needed since the text is already structured)
  if (kind === 'docx') {
    regSetFormProgress('Loading Word reader…', 5);
    regLoadDocxLib()
      .then(() => {
        if (myToken !== regFormRunToken) return; // run cancelled
        return regProcessDocxFile(file, myToken);
      })
      .catch(err => {
        if (myToken !== regFormRunToken) return;
        regSetFormStage('error');
        const errBox = document.getElementById('reg-form-error');
        if (errBox) errBox.textContent = 'Could not load Word reader: ' + (err && err.message ? err.message : 'unknown error') + '. The Form on-ramp needs network access on first use.';
      });
    return;
  }

  // PDF or image → Tesseract OCR (and pdf.js for PDF page rendering)
  regSetFormProgress('Loading OCR engine…', 5);
  regLoadOcrLibs()
    .then(() => {
      if (myToken !== regFormRunToken) return; // run cancelled
      return regProcessFormFile(file, kind, myToken);
    })
    .catch(err => {
      if (myToken !== regFormRunToken) return;
      regSetFormStage('error');
      const errBox = document.getElementById('reg-form-error');
      if (errBox) errBox.textContent = 'Could not load OCR engine: ' + (err && err.message ? err.message : 'unknown error') + '. The Form on-ramp needs network access on first use.';
    });
}

/* .docx extraction via mammoth.js — text is already structured, no OCR pass
 * needed. mammoth pulls runs out of word/document.xml and returns a flat
 * string; we display it in the same panel the OCR path uses. */
async function regProcessDocxFile(file, myToken) {
  if (myToken == null) { regFormRunToken += 1; myToken = regFormRunToken; }
  const alive = () => myToken === regFormRunToken;

  regSetFormStage('extracting');
  regSetFormProgress('Reading Word document…', 30);

  const extractedEl = document.getElementById('reg-form-extracted');
  if (extractedEl) extractedEl.textContent = '';

  let textOut = '';
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (!alive()) return;
    regSetFormProgress('Extracting text…', 50);
    const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    if (!alive()) return;
    textOut = (result && result.value ? result.value : '').trim();
    if (extractedEl) extractedEl.textContent = textOut || '(Document contains no extractable text.)';
    if (result && Array.isArray(result.messages) && result.messages.length) {
      console.debug('mammoth messages:', result.messages);
    }
  } catch (err) {
    if (!alive()) return;
    regSetFormStage('error');
    const errBox = document.getElementById('reg-form-error');
    if (errBox) errBox.textContent = 'Could not read Word document: ' + (err && err.message ? err.message : 'unknown error');
    return;
  }

  // Decide path: VLM-provider key saved → send mammoth-extracted text to
  // liveExtractFieldsFromText (Claude / Kimi K2.6 / xAI Grok per provider
  // preference); otherwise fall through to the existing canned
  // filename-keyword resolver.
  const ssa = window.smartStart || {};
  const vlmProvider = (typeof ssa.getVlmProvider === 'function') ? ssa.getVlmProvider() : null;
  const vlmKey = vlmProvider === 'anthropic'
    ? (typeof ssa.getApiKey      === 'function' ? ssa.getApiKey()      : null)
    : vlmProvider === 'xai'
      ? (typeof ssa.getXaiKey    === 'function' ? ssa.getXaiKey()      : null)
      : (typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null);
  const aiAvailable = !!(vlmKey && typeof window.liveExtractFieldsFromText === 'function' && textOut);

  let aiExtracted = null;
  let aiFailureMsg = null;
  if (aiAvailable) {
    regSetFormProgress((vlmProvider === 'anthropic' ? 'Claude' : vlmProvider === 'xai' ? 'Grok 4.2' : 'Kimi K2.6') + ' extracting fields…', 70);
    try {
      aiExtracted = await window.liveExtractFieldsFromText(textOut, {
        filename: file.name,
        dexId: (typeof currentDexCode === 'function') ? currentDexCode() : null
      });
    } catch (aiErr) {
      console.warn('[smart-start-assist] Word AI extraction failed, falling back to canned:', aiErr);
      aiFailureMsg = 'AI extraction (' + vlmProvider + ') failed: ' + (aiErr && aiErr.message ? aiErr.message : 'unknown') + '. Falling back to canned schema mapping.';
      aiExtracted = null;
    }
    if (!alive()) return;
  }

  regSetFormStage('detecting');
  regSetFormProgress(aiExtracted ? 'Building schema from extracted fields…' : 'Detecting field structure…', 85);
  await regSleepMs(aiExtracted ? 200 : 900);
  if (!alive()) return;

  let seed;
  if (aiExtracted && Array.isArray(aiExtracted.fields) && aiExtracted.fields.length) {
    seed = regBuildSeedFromVlmExtraction(aiExtracted, file.name, vlmProvider);
    if (extractedEl) {
      extractedEl.textContent = '[' + vlmProvider + ' text extraction]\n' +
        'Document title: ' + (aiExtracted.documentTitle || '(none detected)') + '\n' +
        'Fields detected: ' + aiExtracted.fields.length + '\n\n' +
        (aiExtracted.fields || []).map(f => '  · ' + (f.name || f.label || '?') + ' (' + (f.type || 'string') + ')' +
          (f.exampleValue ? ' — e.g. "' + f.exampleValue + '"' : '')).join('\n') +
        '\n\n--- Raw mammoth text below ---\n' + textOut;
    }
  } else {
    seed = regFormSeedFromFilename(file.name, textOut);
    if (aiFailureMsg) {
      seed._aiFailureMsg = aiFailureMsg;
      if (extractedEl) {
        extractedEl.textContent = '[' + aiFailureMsg + ']\n\n' + textOut;
      }
    }
  }
  regSetFormStage('done');
  regSetFormProgress('Done', 100);
  regRenderFormSeedSummary(seed, 'docx');
}

async function regProcessFormFile(file, kind, myToken) {
  // kind is 'pdf' or 'image' — passed in from regOnFormFile after classification.
  if (!kind) kind = regClassifyFile(file);
  if (myToken == null) { regFormRunToken += 1; myToken = regFormRunToken; }
  const alive = () => myToken === regFormRunToken;

  regSetFormStage('extracting');
  regSetFormProgress(kind === 'pdf' ? 'Reading PDF…' : 'Preparing image…', 10);

  const extractedEl = document.getElementById('reg-form-extracted');
  if (extractedEl) extractedEl.textContent = '';

  // Decide which extraction path to use: when the VLM provider's key is set,
  // send the rendered page image to liveExtractFieldsFromPdf (Claude vision,
  // Kimi 2.6 vision, or xAI Grok 4.2 per ADR 0040 §16.3). Otherwise fall back
  // to Tesseract OCR.
  const ssa = window.smartStart || {};
  const vlmProvider = (typeof ssa.getVlmProvider === 'function') ? ssa.getVlmProvider() : null;
  const vlmKey = vlmProvider === 'anthropic'
    ? (typeof ssa.getApiKey      === 'function' ? ssa.getApiKey()      : null)
    : vlmProvider === 'xai'
      ? (typeof ssa.getXaiKey    === 'function' ? ssa.getXaiKey()      : null)
      : (typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null);
  const vlmAvailable = !!(vlmKey && typeof window.liveExtractFieldsFromPdf === 'function');

  let textOut = '';
  let vlmExtracted = null;    // populated when the VLM path succeeds
  let vlmFailureMsg = null;   // surfaced via the extracted-text panel when fallback kicks in

  try {
    if (kind === 'pdf' && window.pdfjsLib) {
      // Stage 1a: pdf.js renders each page to canvas
      const arrayBuf = await file.arrayBuffer();
      if (!alive()) return;
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
      if (!alive()) return;

      if (vlmAvailable) {
        // VLM path — iterate every page (multi-page forms like employment
        // applications carry fields across 2-4 pages). Merge fields across
        // pages, deduped by name. Per-page failures don't abort the run —
        // a partial extraction is still useful.
        const totalPages = pdf.numPages;
        const mergedFields = [];
        const seenNames = new Set();
        // Merge groups across pages: same-named groups absorb additional
        // fields; previously-unseen group names become new groups (preserves
        // the model's inferred structure across page boundaries).
        const mergedGroups = [];
        const groupIndexByName = new Map();
        const ensureGroup = (name, rationale) => {
          const key = (name || 'Fields').toString();
          let idx = groupIndexByName.get(key);
          if (idx === undefined) {
            idx = mergedGroups.length;
            mergedGroups.push({ name: key, rationale: rationale || '', fields: [] });
            groupIndexByName.set(key, idx);
          } else if (rationale && !mergedGroups[idx].rationale) {
            mergedGroups[idx].rationale = rationale;
          }
          return mergedGroups[idx];
        };
        let documentTitle = null;
        let pagesFailed = 0;
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (!alive()) return;
          regSetFormProgress(vlmProvider + ' VLM extracting page ' + pageNum + ' of ' + totalPages +
            ' (typically 30-120s per page)…',
            30 + ((pageNum - 1) / totalPages) * 50);
          const page = await pdf.getPage(pageNum);
          if (!alive()) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx2d = canvas.getContext('2d');
          await page.render({ canvasContext: ctx2d, viewport: viewport }).promise;
          if (!alive()) return;
          const dataUrl = canvas.toDataURL('image/png');
          try {
            const pageResult = await window.liveExtractFieldsFromPdf(dataUrl, {
              filename: file.name + ' (page ' + pageNum + ' of ' + totalPages + ')',
              dexId: (typeof currentDexCode === 'function') ? currentDexCode() : null
            });
            if (pageResult) {
              // First non-empty title wins.
              if (!documentTitle && pageResult.documentTitle && pageResult.documentTitle !== 'unknown') {
                documentTitle = pageResult.documentTitle;
              }
              // Iterate groups so we can preserve grouping in the merged
              // result. Flat-list responses are already normalised by the
              // live module into a single "Fields" group.
              (pageResult.groups || []).forEach(g => {
                const bucket = ensureGroup(g.name, g.rationale);
                (g.fields || []).forEach(f => {
                  const slug = (f.name || regSlugify(f.label || '')).toLowerCase();
                  if (slug && !seenNames.has(slug)) {
                    seenNames.add(slug);
                    const tagged = Object.assign({}, f, { _group: bucket.name });
                    bucket.fields.push(tagged);
                    mergedFields.push(tagged);
                  }
                });
              });
            }
          } catch (vlmErr) {
            pagesFailed++;
            console.warn('[smart-start-assist] VLM extraction failed on page ' + pageNum + ':', vlmErr);
            // Continue — partial extraction is still useful.
          }
          if (!alive()) return;
        }
        // Drop empty groups (a group may have contributed zero new fields if
        // all of its fields were duplicates of earlier pages).
        const nonEmptyGroups = mergedGroups.filter(g => g.fields.length > 0);
        if (mergedFields.length) {
          vlmExtracted = { documentTitle: documentTitle, groups: nonEmptyGroups, fields: mergedFields };
          if (pagesFailed > 0) {
            // Surface partial-failure info without aborting; the seed still
            // carries whatever was extractable.
            vlmFailureMsg = vlmProvider + ' VLM extraction: ' + mergedFields.length + ' fields from ' +
              (totalPages - pagesFailed) + ' of ' + totalPages + ' pages (' + pagesFailed + ' page(s) failed).';
          }
        } else {
          vlmFailureMsg = 'VLM (' + vlmProvider + ') returned no fields across ' + totalPages +
            ' page(s)' + (pagesFailed > 0 ? ' (' + pagesFailed + ' failed)' : '') +
            '. Falling back to Tesseract OCR.';
          vlmExtracted = null;
        }
      }

      if (!vlmExtracted) {
        // Tesseract fallback path (also the default when no VLM key set).
        const totalPages = pdf.numPages;
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (!alive()) return;
          regSetFormProgress('Extracting page ' + pageNum + ' of ' + totalPages + '…', 10 + (pageNum / totalPages) * 60);
          const page = await pdf.getPage(pageNum);
          if (!alive()) return;
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          if (!alive()) return;
          const { data: { text } } = await window.Tesseract.recognize(canvas, 'eng', {
            logger: (m) => {
              if (!alive()) return;
              if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                const overall = 10 + ((pageNum - 1 + m.progress) / totalPages) * 60;
                regSetFormProgress('OCR page ' + pageNum + ' of ' + totalPages + ' · ' + Math.round(m.progress * 100) + '%', overall);
              }
            }
          });
          if (!alive()) return;
          textOut += '\n--- Page ' + pageNum + ' ---\n' + (text || '').trim() + '\n';
          if (extractedEl) extractedEl.textContent = textOut.trim();
        }
      }
    } else {
      // Image file — VLM path if available, else Tesseract.
      if (vlmAvailable) {
        regSetFormProgress(vlmProvider + ' VLM extracting image (typically 30-120s)…', 35);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('File read failed.'));
          reader.readAsDataURL(file);
        });
        if (!alive()) return;
        try {
          vlmExtracted = await window.liveExtractFieldsFromPdf(dataUrl, {
            filename: file.name,
            dexId: (typeof currentDexCode === 'function') ? currentDexCode() : null
          });
        } catch (vlmErr) {
          console.warn('[smart-start-assist] VLM extraction (image) failed, falling back to Tesseract:', vlmErr);
          vlmFailureMsg = 'VLM (' + vlmProvider + ') failed: ' + (vlmErr && vlmErr.message ? vlmErr.message : 'unknown') + '. Falling back to Tesseract OCR.';
          vlmExtracted = null;
        }
        if (!alive()) return;
      }
      if (!vlmExtracted) {
        regSetFormProgress('Running OCR on image…', 30);
        const { data: { text } } = await window.Tesseract.recognize(file, 'eng', {
          logger: (m) => {
            if (!alive()) return;
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              regSetFormProgress('OCR · ' + Math.round(m.progress * 100) + '%', 30 + m.progress * 50);
            }
          }
        });
        if (!alive()) return;
        textOut = (text || '').trim();
        if (extractedEl) extractedEl.textContent = textOut;
      }
    }
  } catch (err) {
    if (!alive()) return;
    regSetFormStage('error');
    const errBox = document.getElementById('reg-form-error');
    if (errBox) errBox.textContent = (kind === 'pdf' ? 'PDF extraction failed: ' : 'OCR failed: ') + (err && err.message ? err.message : 'unknown error');
    return;
  }

  regSetFormStage('detecting');
  regSetFormProgress(vlmExtracted ? 'Building schema from VLM fields…' : 'Detecting field structure…', 85);
  await regSleepMs(vlmExtracted ? 200 : 900);
  if (!alive()) return;

  // Stage 2 — produce the Smart Start seed.
  //   · VLM path: build directly from the structured field list returned by
  //     liveExtractFieldsFromPdf. No filename-keyword guessing needed — the
  //     extraction is semantic.
  //   · Tesseract path: fall through to regFormSeedFromFilename's three-tier
  //     resolver (extracted-text → keyword-canned → placeholder).
  let seed;
  if (vlmExtracted && Array.isArray(vlmExtracted.fields) && vlmExtracted.fields.length) {
    seed = regBuildSeedFromVlmExtraction(vlmExtracted, file.name, vlmProvider);
    if (extractedEl) {
      extractedEl.textContent = '[' + vlmProvider + ' VLM extraction]\n' +
        'Document title: ' + (vlmExtracted.documentTitle || '(none detected)') + '\n' +
        'Fields detected: ' + vlmExtracted.fields.length + '\n\n' +
        (vlmExtracted.fields || []).map(f => '  · ' + (f.name || f.label || '?') + ' (' + (f.type || 'string') + ')' +
          (f.exampleValue ? ' — e.g. "' + f.exampleValue + '"' : '')).join('\n');
    }
  } else {
    seed = regFormSeedFromFilename(file.name, textOut);
    if (vlmFailureMsg) {
      seed._aiFailureMsg = vlmFailureMsg;
      if (extractedEl) {
        extractedEl.textContent = '[' + vlmFailureMsg + ']\n\n' + (extractedEl.textContent || textOut);
      }
    }
  }
  regSetFormStage('done');
  regSetFormProgress('Done', 100);
  regRenderFormSeedSummary(seed, kind);
}

/* Build a Smart Start seed from a VLM extraction response. Mirrors the shape
 * regFormSeedFromFilename returns so the downstream rendering path doesn't
 * need to know how the seed was produced. */
function regBuildSeedFromVlmExtraction(vlmExtracted, filename, vlmProvider) {
  const fields = (vlmExtracted.fields || []).map(f => ({
    name: (f.name || regSlugify(f.label || 'field')) || 'field',
    type: f.type || 'string',
    required: true,                                                   // operator can untick
    description: f.label || '',
    examples: f.exampleValue ? [String(f.exampleValue)] : undefined,
    _group: f._group || 'Fields'
  }));
  // Preserve group order + rationales from the extraction, but rebuild each
  // group's `fields` list from the seed shape so the renderer always works
  // off the canonical seed-field representation.
  const sourceGroups = Array.isArray(vlmExtracted.groups) && vlmExtracted.groups.length
    ? vlmExtracted.groups
    : [{ name: 'Fields', rationale: '' }];
  const groups = sourceGroups
    .map(g => ({
      name: g.name || 'Fields',
      rationale: g.rationale || '',
      fields: fields.filter(f => f._group === (g.name || 'Fields'))
    }))
    .filter(g => g.fields.length);
  return {
    _key: 'vlm-extracted',
    _vlmProvider: vlmProvider,
    _groups: groups,
    meta: {
      name: vlmExtracted.documentTitle ||
        regDeriveTitleFromFilename(filename) ||
        (filename || '').replace(/\.[^.]+$/, '') ||
        'Imported form',
      category: 'Imported · review category',
      description: 'Schema derived from ' + (vlmProvider || 'VLM') + ' extraction of ' + (filename || 'uploaded form') + '. Review names + types before publishing.'
    },
    fields: fields
  };
}

/* Shared summary renderer — used by PDF/image (OCR) and .docx (mammoth) paths.
 * The note copy varies slightly by source: OCR paths say "based on closest
 * example" (since Stage 2 is canned per ADR 0039 §10); .docx says the same
 * because the schema mapping is still canned even when text extraction is
 * real and lossless. */
/* Cache the last-rendered form seed so regUseFormSeed() can hand back the
 * exact fields shown to the user. Necessary because the 'extracted' tier
 * produces fields that aren't in REG_NL_EXAMPLES — re-deriving by id won't
 * find them. Cleared on modal close. */
let _regLastFormSeed = null;

function regRenderFormSeedSummary(seed, sourceKind) {
  _regLastFormSeed = seed;
  const summary = document.getElementById('reg-form-summary');
  if (summary) {
    const fieldCount = seed.fields.length;
    // Prefer the grouped layout when the seed carries _groups (VLM extraction
    // with ≥2 groups). For a single group, collapse to the flat list — adding
    // a "Fields" heading above a single section is just noise.
    const groups = Array.isArray(seed._groups) ? seed._groups.filter(g => g.fields.length) : [];
    const useGrouped = groups.length >= 2;
    const groupSummary = useGrouped
      ? ' across ' + groups.length + ' group' + (groups.length === 1 ? '' : 's')
      : '';
    let html = '<p><strong>' + escapeHtmlOnramp(seed.meta.name) + '</strong> · ' +
      fieldCount + ' field' + (fieldCount === 1 ? '' : 's') + ' detected' + groupSummary + '.</p>';
    if (useGrouped) {
      groups.forEach(g => {
        html += '<div class="reg-form-field-group">';
        html += '<h5 class="reg-form-field-group-title">' + escapeHtmlOnramp(g.name) +
          ' <span class="reg-form-field-group-count">' + g.fields.length + '</span></h5>';
        if (g.rationale) {
          html += '<p class="reg-form-field-group-rationale">' + escapeHtmlOnramp(g.rationale) + '</p>';
        }
        html += '<ul class="reg-form-field-list">';
        g.fields.forEach(f => {
          html += '<li><code>' + escapeHtmlOnramp(f.name) + '</code> <span class="reg-form-field-type">' + f.type + '</span>' + (f.required ? ' <span class="reg-form-field-req">required</span>' : '') + '</li>';
        });
        html += '</ul>';
        html += '</div>';
      });
    } else {
      html += '<ul class="reg-form-field-list">';
      seed.fields.forEach(f => {
        html += '<li><code>' + escapeHtmlOnramp(f.name) + '</code> <span class="reg-form-field-type">' + f.type + '</span>' + (f.required ? ' <span class="reg-form-field-req">required</span>' : '') + '</li>';
      });
      html += '</ul>';
    }
    // Honest tier-aware note copy — name what's real vs canned, with the
    // VLM-extracted tier surfaced explicitly so the operator can see that
    // their API key actually drove the extraction.
    //
    // Three things this copy block has to get right:
    //   1. The right engine name for the source modality: Tesseract for
    //      PDF / image, mammoth.js for Word, no fake conflation.
    //   2. When AI was attempted but FAILED, surface the failure reason
    //      from seed._aiFailureMsg instead of the generic "save a key"
    //      hint — the operator already saved a key; they need to know
    //      why the AI call didn't go through.
    //   3. When no key is saved at all, the canned-tier hint nudges them
    //      to the Smart Start assist settings panel.
    const sourceLabel = sourceKind === 'docx' ? 'Word document'
                        : sourceKind === 'pdf'  ? 'PDF'
                        :                          'image';
    const fallbackEngine = sourceKind === 'docx' ? 'mammoth.js text extraction'
                           :                       'Tesseract OCR';
    let note = '';
    if (seed._key === 'vlm-extracted') {
      const providerLabel = seed._vlmProvider === 'anthropic' ? 'Anthropic Claude'
                          : seed._vlmProvider === 'moonshot'  ? 'Moonshot Kimi'
                          : seed._vlmProvider === 'xai'        ? 'xAI Grok 4.2'
                          :                                       'AI';
      note = '<i class="ti ti-sparkles"></i> <strong>AI extraction by ' + providerLabel + '</strong> — fields above were derived from a ' +
        (sourceKind === 'docx' ? 'language pass over the mammoth-extracted ' + sourceLabel + ' text'
                               : 'vision pass over the ' + sourceLabel) + '. Review names + types before publishing.';
    } else if (seed._aiFailureMsg) {
      // AI was attempted but failed — surface the actual failure reason and
      // explain the fallback. Operator can debug from this message instead
      // of being told to "save a key" (which they already did).
      note = '<i class="ti ti-alert-triangle"></i> <strong>AI extraction failed — falling back to ' + fallbackEngine + '.</strong> ' +
        escapeHtmlOnramp(seed._aiFailureMsg) +
        ' &nbsp;The fields above came from ' + fallbackEngine + ' on the ' + sourceLabel + '.';
    } else if (seed._key === 'extracted') {
      note = '<i class="ti ti-bolt"></i> <strong>' + fallbackEngine + '</strong> — fields above were parsed from labelled patterns in the ' + sourceLabel + ' text. <strong>Save an API key in Smart Start assist for richer AI extraction.</strong>';
    } else if (seed._key === 'placeholder') {
      note = '<i class="ti ti-info-circle"></i> Couldn\'t parse labelled fields from the extracted ' + sourceLabel + ' text — generic placeholder fields suggested. <strong>Save an API key in Smart Start assist for richer AI extraction.</strong>';
    } else {
      note = '<i class="ti ti-info-circle"></i> Field structure based on closest example (' + seed._key + '). <strong>Save an API key in Smart Start assist for richer AI extraction.</strong>';
    }
    html += '<p class="reg-form-note">' + note + '</p>';
    summary.innerHTML = html;
  }
  const useBtn = document.getElementById('reg-form-use-btn');
  if (useBtn) {
    useBtn.disabled = false;
    useBtn.dataset.seedId = seed._key;
  }
}

/* Build a seed from the OCR'd / extracted text. Three-tier resolution:
 *   1. REAL: parse the text for "Label: value" patterns and build a schema
 *      from the actual labels we found. Field names come from the document.
 *   2. CANNED: if real parsing finds fewer than 3 distinct fields, but the
 *      text matches a known keyword bucket (concrete/vessel/bunker), fall
 *      back to that bucket's curated schema — the labels we found weren't
 *      enough on their own but we know the document type.
 *   3. PLACEHOLDER: nothing matched — generic 3-field seed plus a banner. */
function regFormSeedFromFilename(filename, extractedText) {
  // Tier 1: parse real extracted text for labelled fields
  const parsedFields = regParseExtractedText(extractedText || '');
  if (parsedFields.length >= 3) {
    return {
      _key: 'extracted',
      meta: {
        name: regDeriveTitleFromFilename(filename) || 'Imported form',
        category: 'Imported · review category',
        description: 'Schema derived from extracted text — review field names and types before publishing.'
      },
      fields: parsedFields
    };
  }

  // Tier 2: keyword-matched canned fallback
  const lower = (filename + ' ' + (extractedText || '')).toLowerCase();
  if (/concrete|cube|compressive|mpa|bca/.test(lower)) {
    return Object.assign({ _key: 'concrete' }, REG_NL_EXAMPLES.find(e => e.id === 'concrete').seed);
  }
  if (/vessel|arrival|imo|voyage|eta/.test(lower)) {
    return Object.assign({ _key: 'vessel-arrival' }, REG_NL_EXAMPLES.find(e => e.id === 'vessel-arrival').seed);
  }
  if (/bunker|fuel|mgo|hsfo|vlsfo/.test(lower)) {
    return Object.assign({ _key: 'bunker' }, REG_NL_EXAMPLES.find(e => e.id === 'bunker').seed);
  }
  if (/environmental|site.?obs|env.?signoff|env.?site/.test(lower)) {
    return Object.assign({ _key: 'env-site-obs' }, REG_NL_EXAMPLES.find(e => e.id === 'env-site-obs').seed);
  }
  if (/lab.?result|pathology|clinical.?test|specimen|hsa.?lab/.test(lower)) {
    return Object.assign({ _key: 'lab-result' }, REG_NL_EXAMPLES.find(e => e.id === 'lab-result').seed);
  }

  // Tier 3: placeholder
  return {
    _key: 'placeholder',
    meta: {
      name: regDeriveTitleFromFilename(filename) || filename.replace(/\.[^.]+$/, ''),
      category: 'Uncategorised',
      description: 'Schema seeded from uploaded form — review and refine.'
    },
    fields: [
      { name: 'document_reference', type: 'string', required: true, description: 'Document identifier extracted from form' },
      { name: 'issue_date',         type: 'date',   required: true, description: 'Date the form was issued' },
      { name: 'subject',            type: 'string', required: false, description: 'Subject / description' }
    ]
  };
}

/* Parse extracted text for label-value patterns. Handles common form shapes:
 *
 *   "Project Reference: BCA-202601"
 *   "Sample Date    :  2026-04-12"
 *   "Compressive Strength (MPa): 42.3"
 *   "GRADE: C30"
 *
 * Returns an array of field definitions in field-builder shape. Type is
 * inferred from the value (number / date / string). Limit: 30 fields max
 * to avoid runaway from noisy OCR. */
function regParseExtractedText(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const fields = [];
  const seen = new Set();

  for (let i = 0; i < lines.length && fields.length < 30; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('---')) continue;   // skip page markers from our PDF processing
    // Match "Label: value" — label must start with a letter, contain only
    // letters/numbers/spaces/underscores/hyphens/parentheses, length 2-50.
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _()\-\/]{1,50}?)\s*[:|]\s*(.+)$/);
    if (!m) continue;
    const labelRaw = m[1].trim();
    const value    = m[2].trim();
    // Skip obvious non-fields (sentences ending in periods, very short labels)
    if (labelRaw.length < 2 || labelRaw.endsWith('.')) continue;
    // Slugify label to a valid field name
    const name = regSlugify(labelRaw);
    if (!name || name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    fields.push(regBuildFieldFromExtraction(name, labelRaw, value));
  }
  return fields;
}

function regBuildFieldFromExtraction(name, labelRaw, value) {
  const field = {
    name: name,
    required: true,
    description: labelRaw, // keep the human-readable label as description
    validation: {}
  };
  // Type inference from the value
  if (!value) {
    field.type = 'string';
    field.required = false;
  } else if (/^-?\d+$/.test(value)) {
    field.type = 'integer';
    field.examples = [value];
  } else if (/^-?\d+\.\d+$/.test(value)) {
    field.type = 'number';
    field.examples = [value];
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    field.type = 'date';
    field.examples = [value];
  } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value)) {
    field.type = 'date';
    field.examples = [value];
  } else if (/^(true|false|yes|no|y|n)$/i.test(value)) {
    field.type = 'boolean';
  } else {
    field.type = 'string';
    if (value.length < 80) field.examples = [value];
  }
  return field;
}

function regDeriveTitleFromFilename(filename) {
  if (!filename) return '';
  return filename
    .replace(/\.[^.]+$/, '')        // strip extension
    .replace(/[_\-]+/g, ' ')         // underscores/hyphens → spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // title-case
}

function regUseFormSeed() {
  // Use the cached seed from the last render — preserves the actual extracted
  // fields for the 'extracted' tier (whose fields come from real OCR text and
  // aren't in any static fixture). Falls back to deriving by key if cache
  // was lost (modal closed/reopened).
  let seed = _regLastFormSeed;
  if (!seed) {
    const useBtn = document.getElementById('reg-form-use-btn');
    const seedId = useBtn && useBtn.dataset.seedId;
    if (seedId === 'placeholder') {
      seed = regFormSeedFromFilename('uploaded.pdf', '');
    } else {
      const ex = REG_NL_EXAMPLES.find(e => e.id === seedId);
      if (ex) seed = ex.seed;
    }
  }
  if (!seed) return;
  regCloseFormOnramp();
  registerOnramp_completeWithSeed({
    fields: seed.fields,
    meta: seed.meta,
    groups: seed._groups || null,
    source: { onramp: 'form', extractedKey: seed._key || 'unknown' }
  });
  _regLastFormSeed = null;
}

function regSleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ============================================================
   Common — seed handoff into the canvas
   ============================================================ */

function registerOnramp_completeWithSeed(seed) {
  if (typeof regDraft === 'undefined') {
    console.warn('register-element.js not loaded — cannot complete on-ramp');
    return;
  }
  // Merge seed.meta if provided (don't overwrite if user has typed something).
  if (seed.meta) {
    if (seed.meta.name        && !regDraft.meta.name)        regDraft.meta.name        = seed.meta.name;
    if (seed.meta.category    && !regDraft.meta.category)    regDraft.meta.category    = seed.meta.category;
    if (seed.meta.description && !regDraft.meta.description) regDraft.meta.description = seed.meta.description;
  }
  // Field assignment — replace whatever was there (an on-ramp seed is a fresh
  // starting point; partial seeds aren't a v1 feature).
  if (Array.isArray(seed.fields) && seed.fields.length) {
    regDraft.fields = seed.fields.map(f => Object.assign(regBlankField(f.name), {
      type: f.type || 'string',
      required: !!f.required,
      description: f.description || '',
      validation: Object.assign({}, f.validation || {}),
      examples: f.examples ? f.examples.slice() : undefined,
      group: f._group || f.group || null
    }));
  }
  // Carry the seed's group structure onto the draft so the Schema tab can
  // render fields under their original headings. Filtered to groups that
  // actually have surviving fields; empty groups would just render as noise.
  if (Array.isArray(seed.groups) && seed.groups.length) {
    const groupOrder = seed.groups.map(g => g.name);
    regDraft._groups = seed.groups
      .map(g => ({ name: g.name, rationale: g.rationale || '' }))
      .filter(g => (regDraft.fields || []).some(f => (f.group || null) === g.name));
    regDraft._groupOrder = groupOrder;
  } else {
    regDraft._groups = null;
    regDraft._groupOrder = null;
  }
  if (seed.source) {
    regDraft.source = Object.assign({}, regDraft.source || {}, seed.source);
  }
  if (typeof regOpenCanvas === 'function') regOpenCanvas();
  else if (typeof goto === 'function') goto('register-element');

  // Smart Start assist (ADR 0040) — fires after the seed lands on the canvas.
  // Per ADR 0040 §16: Form/PDF, Sample, and Plain English on-ramps trigger
  // assist; Fork stays seed-only. The engine itself is the gate for which
  // canned fixture applies (smartStart_dispatchCanned matches by signature),
  // but we also short-circuit here to avoid unnecessary work on Fork.
  const _ssaEligible = seed.source && (
    seed.source.onramp === 'form' ||
    seed.source.onramp === 'sample' ||
    seed.source.onramp === 'nl'
  );
  if (_ssaEligible &&
      typeof window.runSmartStartAssist === 'function' &&
      typeof regApplyAssistRun === 'function') {
    regBeginAssistRun();
    window.runSmartStartAssist({
      seed: seed,
      dexId: regDraft.dex,
      // confluencePageId + samplePayload are wired in later slices when the
      // operator can supply them. Slice 1 relies on the seed signature alone.
      confluencePageId: null,
      samplePayload: regDraft.samplePayload || null
    }).then(result => {
      regApplyAssistRun(result);
    }).catch(err => {
      console.warn('[smart-start-assist] run failed:', err);
      regApplyAssistRun({ suggestions: [], status: 'failed', degradedSources: ['engine'] });
    });
  }
}

function escapeHtmlOnramp(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ============================================================
   Wire-up: replace register-element.js's regSelectOnramp delegation
   ============================================================ */

/* register-element.js's original regSelectOnramp toasts placeholders for the
 * non-fork on-ramps. We override it here so the live module routes to the
 * three new modals. Fork on-ramp still goes through regOpenElementPicker. */
if (typeof window !== 'undefined') {
  const originalSelectOnramp = window.regSelectOnramp;
  window.regSelectOnramp = function (onramp) {
    if (regDraft) regDraft.source.onramp = onramp;
    if (typeof regCloseOnrampPicker === 'function') regCloseOnrampPicker();
    if (onramp === 'sample') {
      regOpenSampleOnramp();
    } else if (onramp === 'nl') {
      regOpenNlOnramp();
    } else if (onramp === 'form') {
      regOpenFormOnramp();
    } else if (onramp === 'fork') {
      if (typeof regOpenElementPicker === 'function') regOpenElementPicker('new');
    } else if (onramp === 'scratch') {
      if (typeof regOpenCanvas === 'function') regOpenCanvas();
    } else if (typeof originalSelectOnramp === 'function') {
      originalSelectOnramp(onramp);
    }
  };

  // Expose on-ramp entry points for the auto-demo runner.
  window.regOpenSampleOnramp = regOpenSampleOnramp;
  window.regCloseSampleOnramp = regCloseSampleOnramp;
  window.regOnSampleInput = regOnSampleInput;
  window.regUseSampleSeed = regUseSampleSeed;
  window.regOnSampleFile = regOnSampleFile;

  window.regOpenNlOnramp = regOpenNlOnramp;
  window.regCloseNlOnramp = regCloseNlOnramp;
  window.regUseNlExample = regUseNlExample;
  window.regGenerateFromNl = regGenerateFromNl;
  window.regUseNlSeed = regUseNlSeed;

  window.regOpenFormOnramp = regOpenFormOnramp;
  window.regCloseFormOnramp = regCloseFormOnramp;
  window.regOnFormFile = regOnFormFile;
  window.regUseFormSeed = regUseFormSeed;
  window.regClassifyFile = regClassifyFile;
  window.regProcessDocxFile = regProcessDocxFile;
  window.regRenderFormSeedSummary = regRenderFormSeedSummary;
  window.regParseExtractedText = regParseExtractedText;
  window.regFormSeedFromFilename = regFormSeedFromFilename;
  window.regResetFormOnramp = regResetFormOnramp;

  // Test/demo helpers
  window.regParseSample = regParseSample;
  window.REG_NL_EXAMPLES = REG_NL_EXAMPLES;
  window.registerOnramp_completeWithSeed = registerOnramp_completeWithSeed;
  window.regDemoSimulateFormUpload = regDemoSimulateFormUpload;
  window.regDemoShowSamplePreview = regDemoShowSamplePreview;
  window.regDemoLoadSamplePdf     = regDemoLoadSamplePdf;
}

/* ============================================================
   Demo helpers — LIVE variant (real upload through the pipeline)
   ============================================================
   The canned `regDemoSimulateFormUpload` above bypasses extraction entirely.
   These helpers do the opposite: they fetch a bundled sample document, show
   it to the operator inside the form on-ramp modal, then drop it onto the
   real Tesseract/VLM pipeline — same code path a real file drop takes. Used
   by the "live" sibling demo when the operator has a VLM key saved. */

/* Mount a small preview thumbnail of the sample inside the form on-ramp's
 * idle stage so the operator can see what we're about to upload before the
 * extraction starts. Removes any prior preview before mounting. */
function regDemoShowSamplePreview(url, filename) {
  const stage = document.querySelector('[data-reg-form-stage="idle"]');
  if (!stage) return;
  const existing = stage.querySelector('[data-reg-demo-sample-preview]');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.setAttribute('data-reg-demo-sample-preview', '');
  wrap.className = 'reg-demo-sample-preview';
  wrap.innerHTML = ''
    + '<div class="reg-demo-sample-preview-head">'
    +   '<i class="ti ti-file-text"></i>'
    +   '<strong>' + escapeHtmlOnramp(filename || 'sample-document') + '</strong>'
    +   '<span class="reg-demo-sample-preview-tag">demo sample</span>'
    + '</div>'
    + '<img alt="Sample document preview" src="' + escapeHtmlOnramp(url) + '" class="reg-demo-sample-preview-img">'
    + '<p class="reg-demo-sample-preview-hint">The next step will drop this file onto the dropzone and run the real extraction pipeline against your saved VLM provider.</p>';
  stage.appendChild(wrap);
}

/* Fetch the sample as a Blob, wrap it in a File, and feed it to regOnFormFile
 * — exactly the same entry point a real drag-drop or file-picker selection
 * hits. The provider preference + saved API key drive routing inside the
 * pipeline; no special "live" branch is needed here. */
async function regDemoLoadSamplePdf(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Sample fetch failed: ' + res.status + ' ' + res.statusText);
  const blob = await res.blob();
  const type = blob.type || 'image/webp';
  const file = new File([blob], filename || 'sample-document', { type });
  // Remove the preview before extraction so the progress bar takes the focus.
  const preview = document.querySelector('[data-reg-demo-sample-preview]');
  if (preview) preview.remove();
  regOnFormFile(file);
}

/* ============================================================
   Demo helper — bypass the Tesseract/VLM pipeline
   ============================================================
   The auto-demo runner can't actually drop a `File` object on the dropzone
   without a real browser interaction. This helper simulates the end state of
   a successful VLM extraction: it opens the Form modal, lands a pre-built
   grouped seed straight onto the summary, and flips the stage to 'done' so
   the "Use this schema" CTA enables. The seed shape matches what
   regBuildSeedFromVlmExtraction produces, so the downstream handoff into
   registerOnramp_completeWithSeed is identical to the real path. Per
   ADR 0040 §16, the canonical demo element is Environmental Site Observations
   on SGBuildex — keep this helper tied to that fixture so the rest of the
   stack (canned-response suggestions, Confluence fixture, reference docs)
   lines up. */
function regDemoSimulateFormUpload() {
  regOpenFormOnramp();
  // Field names line up with the env-site-obs canned-response signature
  // (`observation_id`, `observation_date`, `project_id`, `site_location`) so
  // smartStart_dispatchCanned fires the matching assist suggestions when
  // the seed lands on the canvas.
  const groups = [
    { name: 'Site identification', rationale: 'Identifies the site and observer.', fields: [
      { name: 'project_id',       label: 'Project ID',       type: 'string' },
      { name: 'site_location',    label: 'Site location',    type: 'string' },
      { name: 'observation_date', label: 'Observation date', type: 'date'   },
      { name: 'observer_name',    label: 'Observer name',    type: 'string' },
    ]},
    { name: 'Observation', rationale: 'What the observer saw on site.', fields: [
      { name: 'observation_id',   label: 'Observation ID',   type: 'string' },
      { name: 'observation_type', label: 'Observation type', type: 'enum',
        exampleValue: 'positive', validation: { enumValues: ['positive', 'negative', 'corrective-action'] } },
      { name: 'severity',         label: 'Severity (if negative)', type: 'enum',
        validation: { enumValues: ['low', 'medium', 'high'] } },
      { name: 'description',      label: 'Description',      type: 'string' },
    ]},
    { name: 'Sign-off', rationale: 'Attestation by the responsible party.', fields: [
      { name: 'signature',      label: 'Signature',      type: 'string' },
      { name: 'signature_date', label: 'Signature date', type: 'date'   },
    ]},
  ];
  const fields = [];
  groups.forEach(g => g.fields.forEach(f => fields.push(Object.assign({}, f, { _group: g.name }))));
  const seed = regBuildSeedFromVlmExtraction(
    { documentTitle: 'Environmental Site Observations', groups: groups, fields: fields },
    'environmental-site-observations.pdf',
    'demo'
  );
  // Mirror the real extraction's tier signal so the rendered note still
  // reads as an AI extraction (rather than a Tesseract fallback).
  seed._vlmProvider = 'demo';
  regRenderFormSeedSummary(seed, 'pdf');
  regSetFormStage('done');
}
