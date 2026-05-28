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
    qwen:      (typeof ssa.getQwenKey     === 'function') ? ssa.getQwenKey()     : null,
  };
  const providerDisplay = {
    anthropic: 'Anthropic Claude (Sonnet 4.6 vision)',
    moonshot:  'Moonshot Kimi 2.6',
    xai:       'xAI Grok 4.2',
    qwen:      'Alibaba Qwen 3.5 (122B-a10b multimodal)',
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
      '<strong>Save an Anthropic, Moonshot, xAI, or Qwen API key in the Smart Start assist panel below to enable AI extraction</strong> ' +
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

/* Alibaba Qwen (qwen3.5-122b-a10b) — LLM overlay only (no VLM). */
function regSaveQwenKey() {
  const input = document.getElementById('reg-form-qwen-key-input');
  if (!input) return;
  const key = (input.value || '').trim();
  if (!key) {
    regClearQwenKey();
    return;
  }
  if (typeof window.smartStart === 'object' && typeof window.smartStart.setQwenKey === 'function') {
    window.smartStart.setQwenKey(key);
  }
  input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Qwen key saved (multimodal)');
}

function regClearQwenKey() {
  if (typeof window.smartStart === 'object' && typeof window.smartStart.clearQwenKey === 'function') {
    window.smartStart.clearQwenKey();
  }
  const input = document.getElementById('reg-form-qwen-key-input');
  if (input) input.value = '';
  regSyncOverlayProviderUi();
  regRefreshAssistKeyStatus();
  regRefreshFormEngineBlurb();
  if (typeof toast === 'function') toast('Smart Start assist · Qwen key cleared');
}

/* Provider selectors — both VLM and LLM independently pick between Anthropic
 * Claude and Moonshot Kimi K2.6. Keys are shared per provider: the Anthropic
 * key powers any Anthropic-selected path (overlay AND/OR VLM); the Moonshot
 * key powers any Moonshot-selected path. */
const REG_PROVIDER_DISPLAY_NAMES = {
  anthropic: 'Anthropic Claude',
  moonshot:  'Moonshot Kimi K2.6',
  xai:       'xAI Grok 4.2',
  qwen:      'Alibaba Qwen 3.5 (122B-a10b multimodal)',
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
  const qwenKey      = (typeof ssa.getQwenKey     === 'function') ? ssa.getQwenKey()     : null;
  const keyByProvider = { anthropic: anthropicKey, moonshot: moonshotKey, xai: xaiKey, qwen: qwenKey };

  // Auto-flip provider when its required key is missing but another is set.
  // Preference order on flip: anthropic → moonshot → xai → qwen. Qwen is
  // multimodal so the same order applies to both overlay and VLM paths.
  const fixProvider = (p) => {
    if (keyByProvider[p]) return p;
    if (anthropicKey) return 'anthropic';
    if (moonshotKey)  return 'moonshot';
    if (xaiKey)       return 'xai';
    if (qwenKey)      return 'qwen';
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
  const qwenRow = document.getElementById('reg-form-qwen-row');
  const qwenTag = document.getElementById('reg-form-assist-qwen-saved-tag');
  if (qwenRow) qwenRow.hidden = !!qwenKey;
  if (qwenTag) qwenTag.hidden = !qwenKey;

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
  const anyKey = !!(anthropicKey || moonshotKey || xaiKey || qwenKey);
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
  ['anthropic', 'moonshot', 'xai', 'qwen'].forEach(regSyncKeyButtonState);
}

/* Single-provider button-state syncer — invoked on every keystroke. The Save
 * button is enabled when the input value is non-empty AND differs from the
 * saved value (so re-saving the same value is blocked). The Clear button is
 * enabled when the input value is non-empty. */
function regSyncKeyButtonState(provider) {
  const inputId = provider === 'anthropic' ? 'reg-form-assist-key-input'
                : provider === 'moonshot'  ? 'reg-form-moonshot-key-input'
                : provider === 'xai'       ? 'reg-form-xai-key-input'
                :                              'reg-form-qwen-key-input';
  const saveBtnId  = provider === 'anthropic' ? 'reg-form-assist-save-btn'
                  : provider === 'moonshot'  ? 'reg-form-moonshot-save-btn'
                  : provider === 'xai'       ? 'reg-form-xai-save-btn'
                  :                              'reg-form-qwen-save-btn';
  const clearBtnId = provider === 'anthropic' ? 'reg-form-assist-clear-btn'
                  : provider === 'moonshot'  ? 'reg-form-moonshot-clear-btn'
                  : provider === 'xai'       ? 'reg-form-xai-clear-btn'
                  :                              'reg-form-qwen-clear-btn';
  const input    = document.getElementById(inputId);
  const saveBtn  = document.getElementById(saveBtnId);
  const clearBtn = document.getElementById(clearBtnId);
  if (!input) return;
  const ssa = window.smartStart || {};
  const savedKey = provider === 'anthropic' ? (typeof ssa.getApiKey      === 'function' ? ssa.getApiKey()      : null)
                : provider === 'moonshot'  ? (typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null)
                : provider === 'xai'       ? (typeof ssa.getXaiKey      === 'function' ? ssa.getXaiKey()      : null)
                :                              (typeof ssa.getQwenKey    === 'function' ? ssa.getQwenKey()     : null);
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
  const qwenKey      = (typeof ssa.getQwenKey     === 'function') ? ssa.getQwenKey()     : null;
  const keyByProvider = { anthropic: anthropicKey, moonshot: moonshotKey, xai: xaiKey, qwen: qwenKey };
  const shortLabel    = { anthropic: 'claude', moonshot: 'kimi', xai: 'grok', qwen: 'qwen' };

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
  window.regSaveQwenKey            = regSaveQwenKey;
  window.regClearQwenKey           = regClearQwenKey;
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
  // Slice 27 — drop refit context on close so a subsequent greenfield
  // upload doesn't inherit a stale refit pill.
  if (typeof regFormRefit_reset === 'function') regFormRefit_reset();
  const header = document.querySelector('.reg-form-refit-header');
  if (header) header.remove();
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

  // Snapshot the file as a data URL so the "View region" affordance on
  // grounded assist suggestions can later re-open the original document and
  // draw the cited page/bbox overlay (regOpenSourceRegionViewer). This is
  // best-effort: large files just fail the read and skip the affordance —
  // the rest of the on-ramp continues regardless. Stored on regDraft.source
  // so it survives the on-ramp → canvas handoff alongside `onramp`.
  if (kind === 'pdf' || kind === 'image' || kind === 'docx') {
    try {
      const captureToken = myToken;
      const reader = new FileReader();
      reader.onload = () => {
        if (captureToken !== regFormRunToken) return;       // superseded
        if (!regDraft) return;
        regDraft.source = regDraft.source || {};
        regDraft.source.uploadedFile = {
          dataUrl:  String(reader.result || ''),
          filename: file.name,
          mime:     file.type || '',
          kind:     kind
        };
      };
      reader.onerror = (e) => console.warn('[reg-onramps] source-file capture failed:', e);
      reader.readAsDataURL(file);
    } catch (e) {
      console.warn('[reg-onramps] could not snapshot source file:', e);
    }
  }

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
      : vlmProvider === 'qwen'
        ? (typeof ssa.getQwenKey === 'function' ? ssa.getQwenKey()     : null)
        : (typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null);
  const aiAvailable = !!(vlmKey && typeof window.liveExtractFieldsFromText === 'function' && textOut);

  let aiExtracted = null;
  let aiFailureMsg = null;
  if (aiAvailable) {
    regSetFormProgress((vlmProvider === 'anthropic' ? 'Claude' : vlmProvider === 'xai' ? 'Grok 4.2' : vlmProvider === 'qwen' ? 'Qwen 3.5' : 'Kimi K2.6') + ' extracting fields…', 70);
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
      : vlmProvider === 'qwen'
        ? (typeof ssa.getQwenKey === 'function' ? ssa.getQwenKey()     : null)
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
 * need to know how the seed was produced.
 *
 * Enum-aware: when a field carries `options[]` (per the strengthened VLM prompt
 * — see smartStartPrompts_extractFieldsFromPdf), the option values + labels
 * land in `validation.enumValues` + `validation.enumLabels`.
 *
 * "Others ____" companion-field pattern: for any enum option flagged
 * `hasFreeTextBlank: true`, the seed builder synthesises a companion text
 * field (`<base>_<option>_specify`) AND a cross-field validation rule that
 * requires the companion when the enum holds that option. Generalises beyond
 * literally "Others" — any option with an adjacent blank triggers the pattern. */
/* Convert a single VLM-emitted property entry (from `items.properties` or
 * `properties`) into the canvas's child-field shape. Recursive: handles
 * nested arrays-of-objects, objects, and enum constraints so the full
 * VLM matrix decomposition lands intact on the canvas (per the system
 * prompt's "CORRECT DECOMPOSITION" example). */
/* Walk a seed's fields at form-onramp commit time and try to recover row-
 * identifier vocabularies for any array<object> field whose row identifier
 * is an empty Pick list. Reuses the same heuristic as the structural-
 * review apply path (description prose + cached per-page OCR text). When
 * recovery succeeds, also locks the table into "Fixed labels" mode by
 * default — pre-populates one row per recovered label, sets minItems ==
 * maxItems to the row count, and marks the row identifier readOnly so the
 * Composer renders row labels as plain cells (paper-form style). Sarah
 * can flip to "Chosen by operator" on the canvas if she wants spreadsheet
 * semantics; the toggle works because defaults are now populated. */
function _regFormSeed_autoFillTableRowIdentifiers(seed) {
  if (!seed || !Array.isArray(seed.fields)) return;
  if (typeof window === 'undefined' ||
      typeof window._regRefit_extractCandidateRowLabels !== 'function') return;

  const slugify = (s) => (typeof regSlugify === 'function')
    ? regSlugify(s)
    : String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const prettify = (s) => {
    if (!s) return s;
    if (/^[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
    return s;
  };

  seed.fields.forEach(field => {
    if (!field || field.type !== 'array') return;
    const v = field.validation;
    if (!v || v.itemType !== 'object' || !Array.isArray(v.itemChildren)) return;

    // Find a row-identifier candidate. Preference order:
    //   1. An empty-enum child (the canonical "VLM emitted the slot but
    //      not the values" case).
    //   2. A required string child (the VLM identified the row taxonomy
    //      column but didn't emit any enum at all — common when the model
    //      defaulted to JSON-Schema's permissive `type: "string"`).
    // When we promote a string candidate to enum (case 2), we set its
    // type below alongside the recovered values.
    let rowId = v.itemChildren.find(c =>
      c && c.type === 'enum' &&
      (!c.validation || !Array.isArray(c.validation.enumValues) ||
        c.validation.enumValues.length === 0)
    );
    let promotedFromString = false;
    if (!rowId) {
      rowId = v.itemChildren.find(c =>
        c && c.required === true && c.type === 'string' &&
        (!c.validation || !Array.isArray(c.validation.enumValues) ||
          c.validation.enumValues.length === 0)
      );
      if (rowId) promotedFromString = true;
    }
    if (!rowId) return;

    const labels = window._regRefit_extractCandidateRowLabels(field);
    if (!Array.isArray(labels) || labels.length < 2) return;

    const enumValues = [];
    const enumLabels = {};
    labels.forEach(label => {
      const wire = slugify(label);
      if (!wire || enumValues.indexOf(wire) !== -1) return;
      enumValues.push(wire);
      enumLabels[wire] = prettify(label);
    });
    if (enumValues.length < 2) return;
    if (promotedFromString) rowId.type = 'enum';
    rowId.validation = Object.assign({}, rowId.validation || {}, {
      enumValues: enumValues,
      enumLabels: enumLabels
    });

    // Lock the table into "Fixed labels" mode now that the row taxonomy
    // is known. One default row per recovered label; boolean columns
    // default to false; readOnly on the row identifier so cells render
    // as labels in the Composer.
    const defaultRows = enumValues.map(wireValue => {
      const row = {};
      row[rowId.name] = wireValue;
      v.itemChildren.forEach(c => {
        if (!c || c.name === rowId.name) return;
        if (c.type === 'boolean') row[c.name] = false;
      });
      return row;
    });
    field.default = defaultRows;
    v.minItems = defaultRows.length;
    v.maxItems = defaultRows.length;
    rowId.readOnly = true;
  });
}

function _vlmPropertyToCanvasChild(name, p, isRequired) {
  const out = {
    name: name,
    type: p.type || 'string',
    required: !!isRequired,
    description: p.description || p.title || '',
    validation: {}
  };
  // Enum / options resolution at the property level. The VLM prompt
  // documents JSON Schema `enum: [...]` for matrix row identifiers, but in
  // practice models also mimic the top-level field shape with
  // `options: [{value, label, ...}]` — especially when the row identifier
  // is the row taxonomy of a matrix (sample_type, room_id, etc.). Accept
  // both shapes, plus the `selectionMode: 'multiple'` variant for
  // checkbox clusters that survived through the table decomposition.
  const enumInfo = _vlmExtractPropertyEnum(p);
  if (enumInfo) {
    if (enumInfo.multi) {
      out.type = 'array';
      out.validation.itemType = 'enum';
      out.validation.itemEnumValues = enumInfo.values;
      if (Object.keys(enumInfo.labels).length) out.validation.itemEnumLabels = enumInfo.labels;
    } else {
      out.type = 'enum';
      out.validation.enumValues = enumInfo.values;
      if (Object.keys(enumInfo.labels).length) out.validation.enumLabels = enumInfo.labels;
    }
  }
  // Nested array-of-objects (rare in practice but the VLM prompt permits it).
  if (p.type === 'array' && p.items && typeof p.items === 'object') {
    if (p.items.type === 'object' && p.items.properties) {
      out.validation.itemType = 'object';
      const subRequired = new Set(Array.isArray(p.items.required) ? p.items.required : []);
      out.validation.itemChildren = Object.keys(p.items.properties).map(n =>
        _vlmPropertyToCanvasChild(n, p.items.properties[n], subRequired.has(n)));
    } else {
      // items might carry enum-shaped vocab itself (array<enum> at property level)
      const itemEnumInfo = _vlmExtractPropertyEnum(p.items);
      if (itemEnumInfo) {
        out.validation.itemType = 'enum';
        out.validation.itemEnumValues = itemEnumInfo.values;
        if (Object.keys(itemEnumInfo.labels).length) out.validation.itemEnumLabels = itemEnumInfo.labels;
      } else if (p.items.type) {
        out.validation.itemType = p.items.type;
      }
    }
  }
  // Nested object — recursive children.
  if (p.type === 'object' && p.properties && typeof p.properties === 'object') {
    const subRequired = new Set(Array.isArray(p.required) ? p.required : []);
    out.children = Object.keys(p.properties).map(n =>
      _vlmPropertyToCanvasChild(n, p.properties[n], subRequired.has(n)));
  }
  if (!Object.keys(out.validation).length) delete out.validation;
  return out;
}

/* Extract the vocabulary + labels from a VLM-emitted property entry,
 * across the four shape variants we've seen in practice. Returns null
 * when no enum vocabulary is present.
 *
 *   1. JSON Schema canonical: `{ enum: [string, ...] }`
 *   2. VLM top-level field shape mimicked at property level:
 *      `{ options: [{value, label, hasFreeTextBlank?}, ...] }`
 *   3. VLM with `type: 'enum'` + `options` (semantically same as #2 but
 *      flagged as enum-typed explicitly)
 *   4. Non-standard `enumValues: [...]` — some VLMs use this when
 *      copying canvas-shape vocabulary into their emit.
 *
 * The `multi` flag fires when the property carries `selectionMode:
 * 'multiple'` — a checkbox cluster that should be rehydrated as
 * array<enum> rather than single-select enum. */
/* Un-slugify a wire-style enum value into a presentable display label.
 *   "lbc"        → "LBC"             (≤3 chars → ALL CAPS — unambiguous initialism)
 *   "wp"/"ep"    → "WP"/"EP"
 *   "plain"      → "Plain"           (≥4 chars → Title Case)
 *   "swab"       → "Swab"            (4 chars — common word, not initialism)
 *   "fluoride"   → "Fluoride"
 *   "sample_type" → "Sample Type"    (snake_case → Title Case Each Word)
 *   "X1A2"       → "X1A2"            (mixed-case left intact)
 *
 * The ≤3-char ALL CAPS rule is the conservative line — 4-letter inputs
 * are ambiguous (EDTA the initialism vs swab the word) and the dataset
 * has more common words than short initialisms at length 4. The VLM-
 * with-labels path overrides this when the model preserved case, so
 * domain-specific 4-letter initialisms still come through correctly via
 * the `options[]` shape. */
function _humanizeEnumValue(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return s;
  // Mixed-case input — leave alone (VLM produced its own casing).
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) return s;
  const parts = s.split(/[_\-\s]+/).filter(Boolean);
  return parts.map(part => {
    if (part.length <= 3 && /^[a-zA-Z]+$/.test(part)) {
      return part.toUpperCase();
    }
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ');
}

function _vlmExtractPropertyEnum(p) {
  if (!p || typeof p !== 'object') return null;
  let values = null;
  let labels = {};
  if (Array.isArray(p.enum) && p.enum.length) {
    values = p.enum.slice();
    // The VLM frequently emits lowercase slug-style enums (`plain`, `edta`,
    // `lbc`) without paired display labels. Without this synthesis, the
    // canvas Pick list renders every option lowercase — looks like a
    // technical glitch even though wire values are correct. Generate
    // display labels by un-slugifying: "edta" → "EDTA" (short ALL-CAPS
    // initialisms stay capitalised), "plain" → "Plain", "sample_type" →
    // "Sample Type". The VLM-emit-with-labels paths below override this
    // when labels are explicitly provided.
    values.forEach(v => {
      if (typeof v !== 'string') return;
      labels[v] = _humanizeEnumValue(v);
    });
  } else if (Array.isArray(p.options) && p.options.length) {
    values = [];
    p.options.forEach(opt => {
      if (!opt) return;
      const v = (opt.value !== undefined && opt.value !== null) ? opt.value : opt.label;
      if (v === undefined || v === null || v === '') return;
      const wireValue = (typeof regSlugify === 'function' && typeof v === 'string' && /\s/.test(v))
        ? regSlugify(v) : String(v);
      values.push(wireValue);
      if (opt.label) labels[wireValue] = opt.label;
    });
    if (!values.length) values = null;
  } else if (Array.isArray(p.enumValues) && p.enumValues.length) {
    values = p.enumValues.slice();
    if (p.enumLabels && typeof p.enumLabels === 'object') labels = Object.assign({}, p.enumLabels);
  }
  if (!values) return null;
  return {
    values: values,
    labels: labels,
    multi: p.selectionMode === 'multiple'
  };
}

function regBuildSeedFromVlmExtraction(vlmExtracted, filename, vlmProvider) {
  const fields = [];
  const rules = [];

  (vlmExtracted.fields || []).forEach(f => {
    const baseName = (f.name || regSlugify(f.label || 'field')) || 'field';
    const validation = {};

    if (f.type === 'enum' && Array.isArray(f.options) && f.options.length) {
      const enumValues = [];
      const enumLabels = {};
      f.options.forEach(opt => {
        if (!opt) return;
        const value = opt.value || regSlugify(opt.label || '');
        if (!value) return;
        enumValues.push(value);
        if (opt.label) enumLabels[value] = opt.label;
      });
      if (enumValues.length) {
        validation.enumValues = enumValues;
        validation.enumLabels = enumLabels;
      }
    }

    // VLM table decomposition per smart-start-assist-prompts.js §"CORRECT
    // DECOMPOSITION of a matrix region": `type: 'array'` + `items.{type, properties}`.
    // Without this branch, matrix regions emitted by the VLM landed at the
    // canvas as bare `type: 'array'` fields with no itemType/itemChildren —
    // looked like an empty array, not a table. Now we decode items into the
    // canvas's itemType/itemChildren/itemEnumValues shape, and recurse into
    // properties so nested column types (including nested enums) survive.
    if (f.type === 'array' && f.items && typeof f.items === 'object') {
      const items = f.items;
      if (items.type === 'object' && items.properties && typeof items.properties === 'object') {
        validation.itemType = 'object';
        const requiredSet = new Set(Array.isArray(items.required) ? items.required : []);
        validation.itemChildren = Object.keys(items.properties).map(childName => {
          const p = items.properties[childName] || {};
          return _vlmPropertyToCanvasChild(childName, p, requiredSet.has(childName));
        });
      } else if (Array.isArray(items.enum) && items.enum.length) {
        validation.itemType = 'enum';
        validation.itemEnumValues = items.enum.slice();
      } else if (items.type) {
        validation.itemType = items.type;
      }
    }

    // VLM nested-object emit — `type: 'object'` + `properties`. Canvas
    // represents these as type='object' with `children` (siblings of
    // top-level fields). Mirrors the array<object> recursion above.
    let nestedChildren = null;
    if (f.type === 'object' && f.properties && typeof f.properties === 'object') {
      const requiredSet = new Set(Array.isArray(f.required) ? f.required : []);
      nestedChildren = Object.keys(f.properties).map(childName => {
        const p = f.properties[childName] || {};
        return _vlmPropertyToCanvasChild(childName, p, requiredSet.has(childName));
      });
    }

    const newField = {
      name: baseName,
      type: f.type || 'string',
      required: true,                                                 // operator can untick
      description: f.label || '',
      examples: f.exampleValue ? [String(f.exampleValue)] : undefined,
      validation: Object.keys(validation).length ? validation : undefined,
      _group: f._group || 'Fields',
      // ADR 0044 §2 / slice 24 — page number flows through the seed so the
      // form-path LLM overlay can chunk by page and cite from the right
      // page's OCR text. VLM emits region.page; absent → null and the
      // overlay's chunker treats it as page 1.
      _page: (f.region && typeof f.region.page === 'number') ? f.region.page : null
    };
    if (nestedChildren) newField.children = nestedChildren;
    fields.push(newField);

    // Companion fields + cross-field rules for any enum option with a
    // free-text blank next to it. Generalises the "Others ____" pattern:
    // works equally for "Insurance Name ____", "Other (please specify) ____",
    // "S Pass ____" (if a form-designer attached a blank there), etc.
    if (f.type === 'enum' && Array.isArray(f.options)) {
      f.options.forEach(opt => {
        if (!opt || !opt.hasFreeTextBlank) return;
        const optValue = opt.value || regSlugify(opt.label || '');
        if (!optValue) return;
        const companionName = baseName + '_' + regSlugify(optValue) + '_specify';
        fields.push({
          name: companionName,
          type: 'string',
          required: false,                                            // conditional, enforced via rule below
          description: 'Free-text companion for "' + (opt.label || optValue) + '" in ' + baseName,
          _group: f._group || 'Fields',
          _companionFor: { base: baseName, option: optValue },
          _page: (f.region && typeof f.region.page === 'number') ? f.region.page : null
        });
        rules.push({
          name: companionName + '_required',
          // govaluate-style cross-field expression: rule passes when the enum
          // doesn't hold the flagged option, OR the companion is non-empty.
          // For checkbox-cluster (selectionMode === 'multiple') the enum is an
          // array; the array-membership check uses `contains`.
          expression: f.selectionMode === 'multiple'
            ? '!contains(' + baseName + ', "' + optValue + '") || (' + companionName + ' != "" && ' + companionName + ' != null)'
            : baseName + ' != "' + optValue + '" || (' + companionName + ' != "" && ' + companionName + ' != null)',
          on_failure: 'When "' + (opt.label || optValue) + '" is selected, "' + companionName + '" must be filled in.',
          applies_at: 'validation'
        });
      });
    }
  });

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
    fields: fields,
    rules: rules
  };
}

/* Human-readable type blurb for the form on-ramp seed preview. Surfaces
 * complex structures (tables, nested objects, multi-select pick lists)
 * directly in the field list so Sarah can confirm "yes, the table was
 * extracted" without opening the canvas. Without this, every array<object>
 * table showed as just "array" and the row-identifier / column count were
 * invisible — felt like the extraction lost the table. */
function _regFormSeed_typeBlurb(f) {
  if (!f) return '';
  if (f.type === 'array' && f.validation) {
    const v = f.validation;
    if (v.itemType === 'object' && Array.isArray(v.itemChildren) && v.itemChildren.length) {
      const cols = v.itemChildren.length;
      const rowId = v.itemChildren.find(c => c && c.type === 'enum');
      const rowIdNote = rowId
        ? ' · rows by <code>' + escapeHtmlOnramp(rowId.name) + '</code>'
        : '';
      return 'table · ' + cols + ' column' + (cols === 1 ? '' : 's') + rowIdNote;
    }
    if (v.itemType === 'enum' && Array.isArray(v.itemEnumValues) && v.itemEnumValues.length) {
      return 'multi-select · ' + v.itemEnumValues.length + ' option' +
        (v.itemEnumValues.length === 1 ? '' : 's');
    }
    if (v.itemType) return 'list of ' + escapeHtmlOnramp(v.itemType);
    return 'array';
  }
  if (f.type === 'object' && Array.isArray(f.children) && f.children.length) {
    return 'object · ' + f.children.length + ' propert' + (f.children.length === 1 ? 'y' : 'ies');
  }
  if (f.type === 'enum' && f.validation && Array.isArray(f.validation.enumValues)) {
    return 'pick list · ' + f.validation.enumValues.length + ' option' +
      (f.validation.enumValues.length === 1 ? '' : 's');
  }
  return f.type || 'string';
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
          html += '<li><code>' + escapeHtmlOnramp(f.name) + '</code> <span class="reg-form-field-type">' + _regFormSeed_typeBlurb(f) + '</span>' + (f.required ? ' <span class="reg-form-field-req">required</span>' : '') + '</li>';
        });
        html += '</ul>';
        html += '</div>';
      });
    } else {
      html += '<ul class="reg-form-field-list">';
      seed.fields.forEach(f => {
        html += '<li><code>' + escapeHtmlOnramp(f.name) + '</code> <span class="reg-form-field-type">' + _regFormSeed_typeBlurb(f) + '</span>' + (f.required ? ' <span class="reg-form-field-req">required</span>' : '') + '</li>';
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
                          : seed._vlmProvider === 'qwen'       ? 'Alibaba Qwen 3.5'
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

  // ADR 0044 §2 — reset the LLM-overlay state for each fresh seed render, so
  // a re-upload during the same session starts the overlay flow from scratch.
  // The Use-button gating then depends on the overlay state: stays disabled
  // until Sarah either completes the overlay run or explicitly skips it.
  regFormOverlay_reset();
  regFormOverlay_renderPanel(seed);
  regFormOverlay_updateUseButton();

  const useBtn = document.getElementById('reg-form-use-btn');
  if (useBtn) {
    useBtn.dataset.seedId = seed._key;
  }
}

/* ============================================================
   ADR 0044 §2 — Form-path LLM overlay UI (slice 25)
   ============================================================
   State machine for the overlay panel that surfaces inside the form
   on-ramp modal after VLM extraction completes. Sarah explicitly clicks
   "Run LLM overlay" (per Q6 gate), the dispatcher fires, results land
   as apply/reject cards (plain suggestions) and "Replace with…" cards
   (VLM-vs-LLM conflicts per Q8), and the Use button stays disabled
   until either the overlay finishes or Sarah skips it.
*/

let _regFormOverlayState   = 'idle';      // 'idle' | 'running' | 'done' | 'skipped' | 'error'
let _regFormOverlayResult  = null;        // { suggestions, conflicts, telemetry, accepted: Set, applied: Map }
let _regFormOverlayError   = null;
let _regFormOverlayProgress = null;       // { phase, chunkIndex?, pages?, totalChunks? }

/* ADR 0044 §2 / slice 27 — form-path version refit state. Mirrors
 * spec-sheet's _specCurrent.l0 + refitMode. Populated by
 * regOnElementPickedForFormRefit when Sarah picks an existing element
 * to refresh; null in greenfield (new-element) form on-ramp flow. */
let _regFormRefit = null;                 // { elementId, elementName, fromVersion, bumpedVersion, l0Fields[] }

function regFormRefit_reset() {
  _regFormRefit = null;
}

function regFormRefit_isActive() {
  return _regFormRefit !== null;
}

/* Slice 27 — entry point the element picker calls when refitting via the
 * form on-ramp. Captures L0 (prior published schema fields), re-opens the
 * form modal, and renders the refit-mode header pill. */
function regOnElementPickedForFormRefit(payload) {
  _regFormRefit = {
    elementId:     payload.elementId,
    elementName:   payload.l0Name,
    fromVersion:   payload.l0Version,
    bumpedVersion: regFormRefit_bumpVersion(payload.l0Version),
    l0Fields:      Array.isArray(payload.l0Fields) ? payload.l0Fields.slice() : []
  };
  regOpenFormOnramp();
  regFormRefit_renderHeader();
}

function regFormRefit_bumpVersion(v) {
  const m = String(v || '').match(/^(v)?(.*?)([0-9]+)$/);
  if (!m) return 'v1.1';
  const prefix = (m[1] || 'v') + m[2];
  const next = parseInt(m[3], 10) + 1;
  return prefix + next;
}

/* Render a refit-mode header pill at the top of the form modal body.
 * Mirrors spec-sheet's _specRenderRefitHeader so reviewers see a
 * consistent affordance across on-ramps. */
function regFormRefit_renderHeader() {
  const wrap = document.querySelector('#register-form-onramp .overlay-body');
  if (!wrap) return;
  let header = wrap.querySelector('.reg-form-refit-header');
  if (!_regFormRefit) {
    if (header) header.remove();
    return;
  }
  if (!header) {
    header = document.createElement('div');
    header.className = 'reg-form-refit-header';
    wrap.insertBefore(header, wrap.firstChild);
  }
  const r = _regFormRefit;
  header.innerHTML =
    '<div class="reg-form-refit-pill">' +
      '<i class="ti ti-refresh"></i>' +
      '<span class="reg-form-refit-label">Refit mode</span>' +
      '<span class="reg-form-refit-element">' + escapeHtmlOnramp(r.elementName) + '</span>' +
      '<span class="reg-form-refit-version">' +
        escapeHtmlOnramp(String(r.fromVersion || '?')) + ' → ' +
        escapeHtmlOnramp(r.bumpedVersion) +
      '</span>' +
      '<span class="reg-form-refit-l0count">' + r.l0Fields.length + ' fields in prior version</span>' +
    '</div>';
}

/* Compute the three-way refit diff for the form on-ramp at commit time.
 * Reuses spec-sheet's pure specRefitDiff (ADR 0042 §7). At extraction
 * time Sarah hasn't edited anything yet, so L1 == L0 (her "current draft"
 * is the prior version untouched). Passing L1=[] would make the diff
 * engine treat every L0 field as a Sarah-deletion (delete-conflict);
 * passing L1=L0 produces the intended add/modify-untouched/remove
 * semantics. The canvas refit drawer surfaces the diff post-commit. */
function regFormRefit_computeDiff(l2Fields) {
  if (!_regFormRefit || typeof window.specRefitDiff !== 'function') return [];
  const l0 = _regFormRefit.l0Fields;
  return window.specRefitDiff(l0, l0, l2Fields || []);
}

function regFormOverlay_reset() {
  _regFormOverlayState   = 'idle';
  _regFormOverlayResult  = null;
  _regFormOverlayError   = null;
  _regFormOverlayProgress = null;
}

/* Single source of truth for whether the Use button should be enabled.
 * Stays disabled in idle and running; enabled in done, skipped, error. */
function regFormOverlay_updateUseButton() {
  const useBtn = document.getElementById('reg-form-use-btn');
  if (!useBtn) return;
  const ready = (_regFormOverlayState === 'done')
             || (_regFormOverlayState === 'skipped')
             || (_regFormOverlayState === 'error');
  useBtn.disabled = !ready;
  // Surface the gate reason in the button text so Sarah understands why
  // it's disabled. The default "Use this schema" stays as the published
  // affordance label.
  if (_regFormOverlayState === 'idle') {
    useBtn.innerHTML = '<i class="ti ti-lock"></i> Run or skip LLM overlay first';
  } else if (_regFormOverlayState === 'running') {
    useBtn.innerHTML = '<i class="ti ti-loader-2"></i> LLM overlay running…';
  } else {
    useBtn.innerHTML = '<i class="ti ti-arrow-right"></i> Use this schema';
  }
}

/* Render the overlay panel inside the form summary container. Idempotent;
 * called whenever overlay state changes. */
function regFormOverlay_renderPanel(seed) {
  const host = document.getElementById('reg-form-summary');
  if (!host) return;
  // Find or create the panel container — we append once and re-render its
  // contents on state change so the summary above stays untouched.
  let panel = document.getElementById('reg-form-overlay-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'reg-form-overlay-panel';
    panel.className = 'reg-form-overlay-panel';
    host.appendChild(panel);
  }
  panel.innerHTML = regFormOverlay_buildPanelHtml(seed || _regLastFormSeed);
}

function regFormOverlay_buildPanelHtml(seed) {
  // Idle state — show the CTA + skip affordance.
  if (_regFormOverlayState === 'idle') {
    const ssa = (typeof window !== 'undefined' && window.smartStart) || null;
    const provider = (ssa && typeof ssa.getOverlayProvider === 'function')
      ? ssa.getOverlayProvider() : 'anthropic';
    const hasKey = typeof window.smartStart_keyFor === 'function'
      && !!window.smartStart_keyFor(provider);
    const providerLabel = formLlmProviderDisplayName(provider);
    const tierNote = hasKey
      ? '<span class="reg-form-overlay-tier">' + escapeHtmlOnramp(providerLabel) + ' · live</span>'
      : '<span class="reg-form-overlay-tier reg-form-overlay-tier--mock">built-in mock (no API key configured)</span>';
    return ''
      + '<div class="reg-form-overlay-header">'
      +   '<h5 class="reg-form-overlay-title"><i class="ti ti-sparkles"></i> LLM overlay (optional)</h5>'
      +   tierNote
      + '</div>'
      + '<p class="reg-form-overlay-blurb">'
      +   'Read the form\'s prose (instructions, footnotes, cross-references) and propose '
      +   'structured validation suggestions the VLM couldn\'t see from layout alone — date '
      +   'formats, regex patterns, conditional rules, standard references, length/range constraints.'
      + '</p>'
      + '<div class="reg-form-overlay-actions">'
      +   '<button type="button" class="btn-primary reg-form-overlay-run" onclick="regRunFormLlmOverlay()">'
      +     '<i class="ti ti-player-play"></i> Run LLM overlay'
      +   '</button>'
      +   '<button type="button" class="btn-secondary reg-form-overlay-skip" onclick="regSkipFormLlmOverlay()">'
      +     'Skip overlay'
      +   '</button>'
      + '</div>';
  }

  // Running state — show progress.
  if (_regFormOverlayState === 'running') {
    const p = _regFormOverlayProgress || {};
    let progressLine = 'Preparing pages…';
    if (p.phase === 'ocr-start')        progressLine = 'OCR-ing page ' + (p.pageNumber || '?') + ' of ' + (p.totalPages || '?') + '…';
    else if (p.phase === 'warmup-start') progressLine = 'Warming up LLM overlay (1 of ' + (p.totalChunks || '?') + ')…';
    else if (p.phase === 'chunk-start')  progressLine = 'Calling LLM for chunk ' + ((p.chunkIndex || 0) + 1) + ' (pages ' + (p.pages || []).join(', ') + ')…';
    else if (p.phase === 'parallel-start') progressLine = 'Dispatching ' + p.count + ' parallel chunks…';
    else if (p.phase === 'chunk-ok')     progressLine = 'Chunk ' + ((p.chunkIndex || 0) + 1) + ' returned ' + (p.suggestionsCount || 0) + ' suggestion(s).';
    return ''
      + '<div class="reg-form-overlay-header">'
      +   '<h5 class="reg-form-overlay-title"><i class="ti ti-loader-2"></i> LLM overlay running</h5>'
      + '</div>'
      + '<p class="reg-form-overlay-progress">' + escapeHtmlOnramp(progressLine) + '</p>';
  }

  // Error state — show what went wrong, allow retry or skip.
  if (_regFormOverlayState === 'error') {
    return ''
      + '<div class="reg-form-overlay-header">'
      +   '<h5 class="reg-form-overlay-title reg-form-overlay-title--error"><i class="ti ti-alert-triangle"></i> LLM overlay failed</h5>'
      + '</div>'
      + '<p class="reg-form-overlay-progress reg-form-overlay-progress--error">'
      +   escapeHtmlOnramp(_regFormOverlayError || 'Unknown error.')
      + '</p>'
      + '<div class="reg-form-overlay-actions">'
      +   '<button type="button" class="btn-secondary" onclick="regRunFormLlmOverlay()">'
      +     '<i class="ti ti-refresh"></i> Retry'
      +   '</button>'
      +   '<span class="reg-form-overlay-hint">… or use the schema as-is. Sarah can run the overlay later from the canvas.</span>'
      + '</div>';
  }

  // Skipped state — small confirmation.
  if (_regFormOverlayState === 'skipped') {
    return ''
      + '<div class="reg-form-overlay-header">'
      +   '<h5 class="reg-form-overlay-title"><i class="ti ti-player-skip-forward"></i> LLM overlay skipped</h5>'
      + '</div>'
      + '<p class="reg-form-overlay-blurb">'
      +   'Using the VLM\'s extraction as-is. You can still run the overlay from the canvas after handoff.'
      + '</p>'
      + '<div class="reg-form-overlay-actions">'
      +   '<button type="button" class="btn-secondary" onclick="regRunFormLlmOverlay()">'
      +     '<i class="ti ti-sparkles"></i> Run anyway'
      +   '</button>'
      + '</div>';
  }

  // Done state — render summary + suggestion cards + conflict cards.
  const r = _regFormOverlayResult || { suggestions: [], conflicts: [], telemetry: {}, accepted: new Set() };
  const total = r.suggestions.length + r.conflicts.length;
  if (total === 0) {
    return ''
      + '<div class="reg-form-overlay-header">'
      +   '<h5 class="reg-form-overlay-title"><i class="ti ti-circle-check"></i> LLM overlay complete</h5>'
      +   '<span class="reg-form-overlay-tier">no suggestions surfaced</span>'
      + '</div>'
      + '<p class="reg-form-overlay-blurb">'
      +   'The LLM didn\'t find any prose-derived constraints to suggest. The VLM\'s extraction is complete on its own.'
      + '</p>'
      // Still surface diagnostics so reviewers can see what the dispatcher
      // saw (chunks, OCR coverage, telemetry) — useful for stress-testing
      // even when no suggestions came back.
      + regFormOverlay_buildDiagnosticsHtml();
  }
  const acceptedCount = r.accepted ? r.accepted.size : 0;
  let html = ''
    + '<div class="reg-form-overlay-header">'
    +   '<h5 class="reg-form-overlay-title"><i class="ti ti-circle-check"></i> LLM overlay complete</h5>'
    +   '<span class="reg-form-overlay-tier">'
    +     r.suggestions.length + ' suggestion' + (r.suggestions.length === 1 ? '' : 's')
    +     (r.conflicts.length ? ' · ' + r.conflicts.length + ' conflict' + (r.conflicts.length === 1 ? '' : 's') : '')
    +     ' · ' + acceptedCount + ' accepted'
    +   '</span>'
    + '</div>';
  // Conflicts surface FIRST — they're the "decide between VLM and LLM" moments.
  if (r.conflicts.length) {
    html += '<div class="reg-form-overlay-section">';
    html += '<h6 class="reg-form-overlay-section-title">Conflicts <span class="reg-form-overlay-hint">VLM extracted one value; LLM proposes a different one. Pick one.</span></h6>';
    html += r.conflicts.map((c, i) => regFormOverlay_buildConflictCardHtml(c, i, r)).join('');
    html += '</div>';
  }
  if (r.suggestions.length) {
    html += '<div class="reg-form-overlay-section">';
    html += '<h6 class="reg-form-overlay-section-title">Suggestions <span class="reg-form-overlay-hint">Prose-derived constraints. Apply or reject each.</span></h6>';
    html += r.suggestions.map((s, i) => regFormOverlay_buildSuggestionCardHtml(s, i, r)).join('');
    html += '</div>';
  }
  // Diagnostics — collapsed by default. Same shape as spec-sheet's
  // diagnostics panel (slice 13) so reviewers comparing the two on-ramps
  // see a consistent stress-testing surface.
  html += regFormOverlay_buildDiagnosticsHtml();
  return html;
}

/* ADR 0044 §2 / slice 26 — diagnostics panel. Surfaces telemetry from the
 * dispatcher (provider, model, total calls, retries, failures, conflicts)
 * plus per-page OCR coverage and per-kind suggestion counts. Collapsed
 * by default so the cards above remain the primary focus. */
function regFormOverlay_buildDiagnosticsHtml() {
  const r = _regFormOverlayResult;
  if (!r || !r.telemetry) return '';
  const tel = r.telemetry;
  const ocr = (regDraft && regDraft.source && regDraft.source.ocrTextByPage) || {};

  const callCount    = tel.totalCalls || 0;
  const retryCount   = tel.retries    || 0;
  const failureCount = tel.failures   || 0;
  const retryRate    = callCount > 0 ? Math.round(100 * retryCount / callCount) : 0;
  const failureRate  = callCount > 0 ? Math.round(100 * failureCount / callCount) : 0;

  // Per-kind suggestion count across both plain + conflicts.
  const kindCounts = {};
  const tally = (sug) => {
    kindCounts[sug.kind] = (kindCounts[sug.kind] || 0) + 1;
  };
  (r.suggestions || []).forEach(tally);
  (r.conflicts   || []).forEach(tally);

  // Per-page OCR coverage
  const ocrPages = Object.keys(ocr).map(k => ({
    page: Number(k), chars: (ocr[k] || '').length
  })).sort((a, b) => a.page - b.page);

  // Chunk breakdown
  const chunks = Array.isArray(tel.chunks) ? tel.chunks : [];

  let html = '<details class="reg-form-overlay-diagnostics">';
  html += '<summary class="reg-form-overlay-diagnostics-summary"><i class="ti ti-chart-bar"></i> Diagnostics</summary>';

  html += '<div class="reg-form-overlay-diagnostics-body">';

  // Section: Extraction telemetry
  html += '<div class="reg-form-overlay-diag-section">';
  html += '<div class="reg-form-overlay-diag-section-title">LLM extraction</div>';
  html += '<dl class="reg-form-overlay-diag-grid">' +
    '<dt>LLM provider</dt><dd><code>' + escapeHtmlOnramp(String(tel.provider || '?')) + '</code></dd>' +
    '<dt>LLM model</dt><dd><code>' + escapeHtmlOnramp(String(tel.model || '?')) + '</code></dd>' +
    '<dt>Total calls</dt><dd>' + callCount + '</dd>' +
    '<dt>Retries</dt><dd>' + retryCount +
      ' <span class="reg-form-overlay-diag-hint">(' + retryRate + '% retry rate — verbatim defence)</span></dd>' +
    '<dt>Failures</dt><dd>' + failureCount +
      (failureCount > 0 ? ' <span class="reg-form-overlay-diag-warn">' + failureRate + '% chunks dropped</span>' : '') + '</dd>' +
    '<dt>Conflicts flagged</dt><dd>' + (tel.conflictsFlagged || 0) +
      ' <span class="reg-form-overlay-diag-hint">(VLM-vs-LLM disagreements surfaced as Replace-with cards)</span></dd>' +
    '<dt>LLM contributions</dt><dd>' + (tel.llmContributions || 0) + '</dd>' +
    '</dl>';
  html += '</div>';

  // Section: OCR coverage
  html += '<div class="reg-form-overlay-diag-section">';
  html += '<div class="reg-form-overlay-diag-section-title">OCR coverage</div>';
  if (!ocrPages.length) {
    html += '<p class="reg-form-overlay-diag-hint">No per-page OCR text cached. ' +
            'Verbatim defence used VLM description as the sole source.</p>';
  } else {
    const totalChars = ocrPages.reduce((s, p) => s + p.chars, 0);
    html += '<dl class="reg-form-overlay-diag-grid">' +
      '<dt>Pages OCR\'d</dt><dd>' + ocrPages.length + '</dd>' +
      '<dt>Total characters</dt><dd>' + totalChars.toLocaleString() + '</dd>' +
      '</dl>';
    html += '<table class="reg-form-overlay-diag-table"><thead><tr>' +
      '<th>Page</th><th>OCR chars</th><th>Density</th></tr></thead><tbody>';
    ocrPages.forEach(p => {
      const density = totalChars > 0 ? Math.round(100 * p.chars / totalChars) : 0;
      html += '<tr>' +
        '<td>' + p.page + '</td>' +
        '<td>' + p.chars.toLocaleString() + '</td>' +
        '<td><div class="reg-form-overlay-diag-bar" style="width:' + density + '%"></div> ' + density + '%</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';

  // Section: Per-kind
  if (Object.keys(kindCounts).length) {
    html += '<div class="reg-form-overlay-diag-section">';
    html += '<div class="reg-form-overlay-diag-section-title">Suggestions by kind</div>';
    html += '<table class="reg-form-overlay-diag-table"><thead><tr>' +
      '<th>Kind</th><th>Count</th></tr></thead><tbody>';
    Object.keys(kindCounts).sort().forEach(k => {
      html += '<tr><td><code>' + escapeHtmlOnramp(k) + '</code></td><td>' + kindCounts[k] + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
  }

  // Section: Per-chunk
  if (chunks.length) {
    html += '<div class="reg-form-overlay-diag-section">';
    html += '<div class="reg-form-overlay-diag-section-title">Per-chunk breakdown</div>';
    html += '<table class="reg-form-overlay-diag-table"><thead><tr>' +
      '<th>Chunk</th><th>Pages</th><th>Status</th><th>Suggestions</th></tr></thead><tbody>';
    chunks.forEach((c, i) => {
      const pages = Array.isArray(c.pages) ? c.pages.join(', ') : '?';
      const status = c.ok
        ? '<span class="reg-form-overlay-diag-ok">ok</span>'
        : '<span class="reg-form-overlay-diag-warn">' + escapeHtmlOnramp(c.reason || 'failed') + '</span>';
      html += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + escapeHtmlOnramp(pages) + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + (c.suggestionCount || 0) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
  }

  html += '</div></details>';
  return html;
}

function regFormOverlay_buildSuggestionCardHtml(s, idx, result) {
  const key = s.field + '::' + s.kind;
  const accepted = result.accepted && result.accepted.has(key);
  const rejectedAttr = result.rejected && result.rejected.has(key) ? ' reg-form-overlay-card--rejected' : '';
  const acceptedAttr = accepted ? ' reg-form-overlay-card--accepted' : '';
  return ''
    + '<div class="reg-form-overlay-card' + acceptedAttr + rejectedAttr + '" data-overlay-key="' + escapeHtmlOnramp(key) + '">'
    +   '<div class="reg-form-overlay-card-head">'
    +     '<span class="reg-form-overlay-card-kind">' + escapeHtmlOnramp(s.kind) + '</span>'
    +     '<code class="reg-form-overlay-card-field">' + escapeHtmlOnramp(s.field) + '</code>'
    +     '<span class="reg-form-overlay-card-conf reg-form-overlay-card-conf--' + escapeHtmlOnramp(s.confidence || 'medium') + '">' + escapeHtmlOnramp(s.confidence || 'medium') + '</span>'
    +   '</div>'
    +   (s.rationale ? '<p class="reg-form-overlay-card-rationale">' + escapeHtmlOnramp(s.rationale) + '</p>' : '')
    +   '<div class="reg-form-overlay-card-proposal">'
    +     '<code>' + escapeHtmlOnramp(JSON.stringify(s.proposal)) + '</code>'
    +   '</div>'
    +   '<div class="reg-form-overlay-card-source">'
    +     'Cited from ' + escapeHtmlOnramp(s.source && s.source.suggested && s.source.suggested.from && s.source.suggested.from.column || 'source') + ': '
    +     '<q>' + escapeHtmlOnramp((s.source && s.source.suggested && s.source.suggested.from && s.source.suggested.from.verbatimSource) || '') + '</q>'
    +   '</div>'
    +   '<div class="reg-form-overlay-card-actions">'
    +     '<button type="button" class="btn-primary" '
    +       'onclick="regAcceptFormLlmSuggestion(\'' + escapeJsAttr(s.field) + '\', \'' + escapeJsAttr(s.kind) + '\')"'
    +       (accepted ? ' disabled' : '') + '>'
    +     (accepted ? '<i class="ti ti-check"></i> Accepted' : '<i class="ti ti-circle-plus"></i> Apply')
    +     '</button>'
    +     '<button type="button" class="btn-secondary" '
    +       'onclick="regRejectFormLlmSuggestion(\'' + escapeJsAttr(s.field) + '\', \'' + escapeJsAttr(s.kind) + '\')">'
    +     '<i class="ti ti-x"></i> Reject'
    +     '</button>'
    +   '</div>'
    + '</div>';
}

function regFormOverlay_buildConflictCardHtml(c, idx, result) {
  const key = c.field + '::' + c.kind;
  const resolved = result.accepted && result.accepted.has(key);
  const rejected = result.rejected && result.rejected.has(key);
  const stateClass = resolved ? ' reg-form-overlay-card--accepted' : rejected ? ' reg-form-overlay-card--rejected' : '';
  // Find the VLM-side value for comparison. The conflict carries the LLM
  // proposal; the VLM-side value lives on the field model right now.
  const seedField = (_regLastFormSeed && _regLastFormSeed.fields || []).find(f => f.name === c.field);
  const vlmSnapshot = regFormOverlay_snapshotVlmValue(seedField, c.kind);
  return ''
    + '<div class="reg-form-overlay-card reg-form-overlay-card--conflict' + stateClass + '" data-overlay-key="' + escapeHtmlOnramp(key) + '">'
    +   '<div class="reg-form-overlay-card-head">'
    +     '<span class="reg-form-overlay-card-kind">' + escapeHtmlOnramp(c.kind) + '</span>'
    +     '<code class="reg-form-overlay-card-field">' + escapeHtmlOnramp(c.field) + '</code>'
    +     '<span class="reg-form-overlay-card-conf reg-form-overlay-card-conf--conflict">replace?</span>'
    +   '</div>'
    +   (c.rationale ? '<p class="reg-form-overlay-card-rationale">' + escapeHtmlOnramp(c.rationale) + '</p>' : '')
    +   '<div class="reg-form-overlay-card-versus">'
    +     '<div class="reg-form-overlay-card-versus-side">'
    +       '<span class="reg-form-overlay-card-versus-label">VLM</span>'
    +       '<code>' + escapeHtmlOnramp(JSON.stringify(vlmSnapshot)) + '</code>'
    +     '</div>'
    +     '<div class="reg-form-overlay-card-versus-side reg-form-overlay-card-versus-side--llm">'
    +       '<span class="reg-form-overlay-card-versus-label">LLM proposes</span>'
    +       '<code>' + escapeHtmlOnramp(JSON.stringify(c.proposal)) + '</code>'
    +     '</div>'
    +   '</div>'
    +   '<div class="reg-form-overlay-card-source">'
    +     'LLM cited: <q>' + escapeHtmlOnramp((c.source && c.source.suggested && c.source.suggested.from && c.source.suggested.from.verbatimSource) || '') + '</q>'
    +   '</div>'
    +   '<div class="reg-form-overlay-card-actions">'
    +     '<button type="button" class="btn-secondary" '
    +       'onclick="regResolveFormLlmConflict(\'' + escapeJsAttr(c.field) + '\', \'' + escapeJsAttr(c.kind) + '\', false)">'
    +     '<i class="ti ti-x"></i> Keep VLM'
    +     '</button>'
    +     '<button type="button" class="btn-primary" '
    +       'onclick="regResolveFormLlmConflict(\'' + escapeJsAttr(c.field) + '\', \'' + escapeJsAttr(c.kind) + '\', true)"'
    +       (resolved ? ' disabled' : '') + '>'
    +     (resolved ? '<i class="ti ti-check"></i> Replaced' : '<i class="ti ti-replace"></i> Replace with LLM')
    +     '</button>'
    +   '</div>'
    + '</div>';
}

function regFormOverlay_snapshotVlmValue(field, kind) {
  if (!field) return null;
  const v = field.validation || {};
  switch (kind) {
    case 'regex-pattern': return { pattern: v.pattern || null };
    case 'length-constraint': return { minLength: v.minLength, maxLength: v.maxLength };
    case 'range-constraint':  return { minimum: v.minimum, maximum: v.maximum };
    case 'decimal-precision': return { decimalPlaces: v.decimalPlaces };
    case 'enum-from-definition':
      return {
        type: field.type,
        values: field.type === 'array' ? (v.itemEnumValues || []) : (v.enumValues || [])
      };
    case 'allowed-file-extensions': return { extensions: v.allowedFileExtensions || [] };
    case 'format-iso-date': return { type: field.type };
    case 'multi-select-marker': return { type: field.type };
    case 'attachment-cardinality-constraint':
      return { maxItems: v.maxItems, minItems: v.minItems };
    default: return null;
  }
}

/* Lightweight escape for values embedded in onclick="…" attributes. The
 * existing escapeHtmlOnramp handles HTML; this one additionally protects
 * single-quote and backslash so we can embed field names and kinds safely. */
function escapeJsAttr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
}

/* Build OCR text per page from the cached uploaded file. Uses pdf.js to
 * render each page to canvas and Tesseract to OCR. Only runs when the
 * cached map is empty (i.e., the VLM path succeeded and never built it).
 * Heavy operation — typically 2-5s per page; that's why this is gated
 * behind Sarah's explicit "Run LLM overlay" click. */
async function regFormOverlay_buildOcrTextByPage(onProgress) {
  // Re-use the OCR libs the fallback path already loaded if available.
  if (typeof regLoadOcrLibs === 'function') await regLoadOcrLibs();
  const source = regDraft && regDraft.source && regDraft.source.uploadedFile;
  if (!source || !source.dataUrl) {
    throw new Error('No source file cached. Re-upload the form to enable the overlay.');
  }
  const kind = source.kind;
  // For .docx / image we don't have multi-page; use a single page 1.
  if (kind === 'docx' || kind === 'image') {
    // For .docx, OCR doesn't apply — the mammoth-extracted text is the source.
    if (kind === 'docx') return {};                                  // VLM-description-only verbatim
    // For image, run Tesseract once.
    onProgress && onProgress({ phase: 'ocr-start', pageNumber: 1, totalPages: 1 });
    const { data: { text } } = await window.Tesseract.recognize(source.dataUrl, 'eng', {});
    return { 1: text || '' };
  }
  // PDF path
  const loadingTask = window.pdfjsLib.getDocument({ url: source.dataUrl });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const out = {};
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress && onProgress({ phase: 'ocr-start', pageNumber: pageNum, totalPages });
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    const { data: { text } } = await window.Tesseract.recognize(canvas, 'eng', {});
    out[pageNum] = text || '';
  }
  return out;
}

async function regRunFormLlmOverlay() {
  if (_regFormOverlayState === 'running') return;
  const seed = _regLastFormSeed;
  if (!seed) {
    _regFormOverlayState = 'error';
    _regFormOverlayError = 'No seed cached. Re-upload the form.';
    regFormOverlay_renderPanel(null);
    regFormOverlay_updateUseButton();
    return;
  }

  _regFormOverlayState = 'running';
  _regFormOverlayError = null;
  _regFormOverlayProgress = { phase: 'idle' };
  regFormOverlay_renderPanel(seed);
  regFormOverlay_updateUseButton();

  try {
    // Step 1 — ensure OCR text per page is available. Cache on regDraft so
    // a retry doesn't re-pay the OCR cost. We build only when the cache is
    // explicitly absent (undefined/null) — an empty object is a deliberate
    // "skip OCR" signal that the dispatcher handles by falling back to
    // VLM-description-only verbatim defense.
    regDraft.source = regDraft.source || {};
    let ocrTextByPage = regDraft.source.ocrTextByPage;
    if (ocrTextByPage === undefined || ocrTextByPage === null) {
      ocrTextByPage = await regFormOverlay_buildOcrTextByPage(p => {
        _regFormOverlayProgress = p;
        regFormOverlay_renderPanel(seed);
      });
      regDraft.source.ocrTextByPage = ocrTextByPage;
    }

    // Step 2 — adapt seed fields to the dispatcher's expected shape.
    const payload = {
      fields: seed.fields.map(f => ({
        name: f.name,
        type: f.type || 'string',
        required: !!f.required,
        description: f.description || '',
        title: f.title || null,
        pageNumber: f._page || 1,
        validation: f.validation || {},
        examples: f.examples
      })),
      ocrTextByPage,
      formMeta: {
        filename: (regDraft.source.uploadedFile && regDraft.source.uploadedFile.filename) || null,
        documentTitle: seed.meta && seed.meta.name || null,
        dexId: (typeof currentDexCode === 'function') ? currentDexCode() : null
      }
    };

    // Step 3 — dispatch. Use built-in mock when no API key is configured so
    // the prototype demonstrates the flow even without a live provider.
    const ssa = (typeof window !== 'undefined' && window.smartStart) || null;
    const provider = (ssa && typeof ssa.getOverlayProvider === 'function')
      ? ssa.getOverlayProvider() : 'anthropic';
    const hasKey = typeof window.smartStart_keyFor === 'function'
      && !!window.smartStart_keyFor(provider);

    const result = await formLlmDispatch(payload, {
      useBuiltInMock: !hasKey,
      onProgress: e => {
        _regFormOverlayProgress = e;
        regFormOverlay_renderPanel(seed);
      }
    });

    _regFormOverlayResult = {
      suggestions: result.suggestions,
      conflicts:   result.conflicts,
      telemetry:   result.telemetry,
      accepted:    new Set(),
      rejected:    new Set(),
      applied:     new Map()                            // field name → list of accepted suggestion envelopes
    };
    _regFormOverlayState = 'done';
  } catch (err) {
    _regFormOverlayState = 'error';
    _regFormOverlayError = (err && err.message) ? err.message : String(err);
    console.warn('[reg-form-llm-overlay] dispatch failed:', err);
  }
  regFormOverlay_renderPanel(seed);
  regFormOverlay_updateUseButton();
}

function regSkipFormLlmOverlay() {
  if (_regFormOverlayState === 'running') return;
  _regFormOverlayState = 'skipped';
  _regFormOverlayResult = null;
  regFormOverlay_renderPanel(_regLastFormSeed);
  regFormOverlay_updateUseButton();
}

/* Mark a plain (non-conflict) suggestion as accepted. The suggestion's
 * mutation against the seed is deferred to regUseFormSeed so Sarah can
 * un-accept before commit. */
function regAcceptFormLlmSuggestion(fieldName, kind) {
  const r = _regFormOverlayResult;
  if (!r) return;
  const key = fieldName + '::' + kind;
  if (r.rejected) r.rejected.delete(key);
  r.accepted.add(key);
  regFormOverlay_renderPanel(_regLastFormSeed);
}

function regRejectFormLlmSuggestion(fieldName, kind) {
  const r = _regFormOverlayResult;
  if (!r) return;
  const key = fieldName + '::' + kind;
  if (!r.rejected) r.rejected = new Set();
  r.rejected.add(key);
  r.accepted.delete(key);
  regFormOverlay_renderPanel(_regLastFormSeed);
}

/* Resolve a VLM-vs-LLM conflict (ADR 0044 §5). useLlm=true accepts the
 * LLM proposal (replaces VLM); useLlm=false keeps VLM (rejects LLM). */
function regResolveFormLlmConflict(fieldName, kind, useLlm) {
  const r = _regFormOverlayResult;
  if (!r) return;
  const key = fieldName + '::' + kind;
  if (useLlm) {
    if (r.rejected) r.rejected.delete(key);
    r.accepted.add(key);
  } else {
    if (!r.rejected) r.rejected = new Set();
    r.rejected.add(key);
    r.accepted.delete(key);
  }
  regFormOverlay_renderPanel(_regLastFormSeed);
}

/* Apply every accepted suggestion + conflict resolution to the seed fields.
 * Mutates seed in place; returns the array of accepted-suggestion envelopes
 * so the seed handoff can ship them in acceptedLlmSuggestions (slice 19
 * analog — downstream Smart Start assist sees the post-acceptance state). */
function regFormOverlay_applyAcceptedToSeed(seed) {
  const r = _regFormOverlayResult;
  if (!r || !seed || !Array.isArray(seed.fields)) return [];
  if (typeof llmOverlay_applySuggestion !== 'function') return [];

  const acceptedEnvelopes = [];
  const fieldsByName = {};
  seed.fields.forEach(f => { fieldsByName[f.name] = f; });
  const applyContext = {
    allFields: seed.fields,
    rules: Array.isArray(seed.rules) ? seed.rules : (seed.rules = [])
  };

  const consider = (sug) => {
    const key = sug.field + '::' + sug.kind;
    if (!r.accepted.has(key)) return;
    const field = fieldsByName[sug.field];
    if (!field) return;
    const result = llmOverlay_applySuggestion(field, sug, applyContext);
    if (result && result.ok) {
      acceptedEnvelopes.push(sug);
    }
  };
  r.suggestions.forEach(consider);
  r.conflicts.forEach(consider);
  return acceptedEnvelopes;
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

/* Render a single PDF page to an image data URL at the given scale. Reuses
 * pdf.js exactly the way the OCR loop does (regFormOverlay_buildOcrTextByPage)
 * but returns the canvas data URL instead of running Tesseract on it. */
async function _regFormSeed_renderPdfPageToImage(sourceDataUrl, pageNum, scale) {
  if (!window.pdfjsLib) throw new Error('pdf.js not loaded.');
  const pdf = await window.pdfjsLib.getDocument({ url: sourceDataUrl }).promise;
  const page = await pdf.getPage(pageNum || 1);
  const viewport = page.getViewport({ scale: scale || 1.8 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  // JPEG keeps the payload small; vision models tolerate it fine for OCR-class extraction.
  return canvas.toDataURL('image/jpeg', 0.85);
}

/* Targeted VLM call to recover row-identifier values for a single empty
 * array<object> matrix field. Architecturally the right path — we already
 * have a vision model that saw the form during initial extraction; asking
 * it to look at the same image again with a focused question yields a
 * better answer than parsing Tesseract OCR text with heuristics.
 *
 * Returns { values, labels } when the model returns at least 2 plausible
 * labels; null when the call fails or the response can't be parsed. */
async function _regFormSeed_vlmRecoverRowLabels(field) {
  if (typeof window.liveCallVlmWithPrompt !== 'function') return null;
  if (typeof window.smartStart_keyFor !== 'function') return null;
  const source = regDraft && regDraft.source && regDraft.source.uploadedFile;
  if (!source || !source.dataUrl) return null;
  const ssa = (typeof window !== 'undefined' && window.smartStart) || null;
  const provider = ssa && typeof ssa.getVlmProvider === 'function' ? ssa.getVlmProvider() : null;
  if (!provider) return null;
  if (!window.smartStart_keyFor(provider)) return null;                // no key configured

  // Compose the targeted prompt. We give the model the schema-side
  // context (field name, description, already-extracted column names)
  // and ask it to ONLY return the row labels — small payload, fast.
  const itemChildren = (field.validation && field.validation.itemChildren) || [];
  const columnNames = itemChildren
    .filter(c => c && c.type !== 'enum')
    .map(c => c.name);
  const promptCtx = {
    fieldName:    field.name,
    fieldLabel:   field.title || field.description || field.name,
    columnNames:  columnNames
  };
  const prompt = {
    system: [
      'You are extracting the ROW LABELS for a single matrix region of a paper form.',
      '',
      'A previous Vision-Language extraction pass identified the matrix as a',
      'table (array of objects) and captured its column names, but left the row',
      "identifier's enum vocabulary EMPTY. Your job is to look at the form image",
      'and list the visible row labels for the matrix that corresponds to the',
      'schema field below.',
      '',
      'CONTEXT:',
      '  Schema field name : ' + (promptCtx.fieldName || '(unknown)'),
      '  Display label     : ' + (promptCtx.fieldLabel || '(none)'),
      '  Column names      : ' + (columnNames.length ? columnNames.join(', ') : '(none)'),
      '',
      'Return JSON only:',
      '{',
      '  "rowLabels": [',
      '    { "value": "wire_value_snake_case", "label": "Display Label exactly as shown" }',
      '  ]',
      '}',
      '',
      'Rules:',
      '  - `value` is a slug-cased lowercase snake_case identifier derived',
      '    from the visible label (e.g., "Plain" → "plain", "S Pass" → "s_pass").',
      '    Preserve as-is when the visible label is already a wire-stable code',
      '    (e.g., "PSA01" stays "PSA01").',
      '  - `label` is the visible text EXACTLY as shown on the form (case,',
      '    punctuation, asterisks all preserved).',
      '  - Return between 2 and 25 row labels. If the form has no matching',
      '    matrix or the rows are not enumerable as labels, return',
      '    {"rowLabels": []} (the caller will fall back to a heuristic).',
      '  - Do not invent labels. Each label MUST be visibly present in the',
      '    image as a row identifier in this matrix.',
      '',
      'Emit ONLY the JSON object. No prose before or after.'
    ].join('\n'),
    user:    'Extract the row labels for the matrix named "' + promptCtx.fieldName + '".',
    prefill: '{'
  };

  // Render the relevant page to an image. For images, use the original;
  // for PDFs, render the field's _page; for docx (no image), skip.
  let pageImage;
  try {
    if (source.kind === 'image') {
      pageImage = source.dataUrl;
    } else if (source.kind === 'pdf') {
      const pageNum = (typeof field._page === 'number' && field._page > 0) ? field._page : 1;
      pageImage = await _regFormSeed_renderPdfPageToImage(source.dataUrl, pageNum, 1.8);
    } else {
      return null;                                                     // docx — no image
    }
  } catch (err) {
    console.warn('[reg-form-onramp] PDF render for VLM recovery failed:', err);
    return null;
  }

  let response;
  try {
    response = await window.liveCallVlmWithPrompt(prompt, pageImage);
  } catch (err) {
    console.warn('[reg-form-onramp] targeted VLM row-label recovery failed:', err);
    return null;
  }
  const arr = response && Array.isArray(response.rowLabels) ? response.rowLabels : null;
  if (!arr || arr.length < 2) return null;

  // Sanitise + de-dupe
  const values = [];
  const labels = {};
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const v = typeof item.value === 'string' && item.value.trim() ? item.value.trim() : null;
    const l = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : null;
    if (!v && !l) return;
    const wire = v || (typeof regSlugify === 'function' ? regSlugify(l) : l.toLowerCase().replace(/\s+/g, '_'));
    if (!wire || values.indexOf(wire) !== -1) return;
    values.push(wire);
    if (l) labels[wire] = l;
  });
  if (values.length < 2) return null;
  return { values, labels };
}

/* Walk the seed, find every array<object> with an empty row identifier,
 * call the targeted VLM for each, and populate. Returns true when at
 * least one table was successfully recovered (caller skips the OCR
 * fallback in that case). Runs the per-field VLM calls sequentially —
 * a multi-table form would benefit from Promise.all but the prototype
 * scope is one table at a time. */
async function _regFormSeed_applyVlmRowLabelRecovery(seed) {
  if (!seed || !Array.isArray(seed.fields)) return false;
  if (typeof window.liveCallVlmWithPrompt !== 'function') return false;
  let recoveredAny = false;
  for (const field of seed.fields) {
    if (!field || field.type !== 'array') continue;
    const v = field.validation;
    if (!v || v.itemType !== 'object' || !Array.isArray(v.itemChildren)) continue;
    // Candidate row identifier — empty enum OR required-string-with-no-enum
    let rowId = v.itemChildren.find(c =>
      c && c.type === 'enum' &&
      (!c.validation || !Array.isArray(c.validation.enumValues) ||
        c.validation.enumValues.length === 0)
    );
    let promotedFromString = false;
    if (!rowId) {
      rowId = v.itemChildren.find(c =>
        c && c.required === true && c.type === 'string' &&
        (!c.validation || !Array.isArray(c.validation.enumValues) ||
          c.validation.enumValues.length === 0)
      );
      if (rowId) promotedFromString = true;
    }
    if (!rowId) continue;

    const result = await _regFormSeed_vlmRecoverRowLabels(field);
    if (!result || !result.values || result.values.length < 2) continue;

    // Apply — promote to enum if needed, populate values + labels, lock
    // the table to Fixed-labels mode with one default row per value.
    if (promotedFromString) rowId.type = 'enum';
    rowId.validation = Object.assign({}, rowId.validation || {}, {
      enumValues: result.values.slice(),
      enumLabels: Object.assign({}, result.labels || {})
    });
    const defaultRows = result.values.map(value => {
      const row = {};
      row[rowId.name] = value;
      v.itemChildren.forEach(c => {
        if (!c || c.name === rowId.name) return;
        if (c.type === 'boolean') row[c.name] = false;
      });
      return row;
    });
    field.default = defaultRows;
    v.minItems = defaultRows.length;
    v.maxItems = defaultRows.length;
    rowId.readOnly = true;
    recoveredAny = true;
  }
  return recoveredAny;
}

/* Predicate — does the seed contain any array<object> whose row identifier
 * is empty (either an empty-enum child OR a required-string child with no
 * enum vocabulary)? Used to gate row-label recovery, both at commit time
 * and from the canvas-side Fixed-labels click. */
function _regFormSeed_hasEmptyTableRowIdentifier(seed) {
  if (!seed || !Array.isArray(seed.fields)) return false;
  return seed.fields.some(f => {
    if (!f || f.type !== 'array') return false;
    const v = f.validation || {};
    if (v.itemType !== 'object' || !Array.isArray(v.itemChildren)) return false;
    return v.itemChildren.some(c =>
      c && (c.type === 'enum' || (c.type === 'string' && c.required)) &&
      (!c.validation || !Array.isArray(c.validation.enumValues) ||
        c.validation.enumValues.length === 0)
    );
  });
}

/* Predicate — is the source image / PDF data URL still cached on
 * regDraft.source.uploadedFile? That cache is what the targeted VLM
 * recovery needs to render a page back into image bytes. */
function _regFormSeed_hasCachedSourceImage() {
  return !!(regDraft && regDraft.source && regDraft.source.uploadedFile &&
            regDraft.source.uploadedFile.dataUrl);
}

/* Predicate — does the seed contain any array<object> whose row identifier
 * is empty AND we have no cached OCR text to recover from? Kept for the
 * OCR-fallback path so the heuristic only fires when neither the VLM nor
 * the LLM overlay has produced source text yet. */
function _regFormSeed_needsOnDemandOcr(seed) {
  if (!seed || !Array.isArray(seed.fields)) return false;
  const hasCachedFile = regDraft && regDraft.source && regDraft.source.uploadedFile &&
    regDraft.source.uploadedFile.dataUrl;
  if (!hasCachedFile) return false;
  const ocrCached = regDraft.source.ocrTextByPage &&
    Object.keys(regDraft.source.ocrTextByPage).length > 0;
  if (ocrCached) return false;
  return seed.fields.some(f => {
    if (!f || f.type !== 'array') return false;
    const v = f.validation || {};
    if (v.itemType !== 'object' || !Array.isArray(v.itemChildren)) return false;
    return v.itemChildren.some(c =>
      c && (c.type === 'enum' || (c.type === 'string' && c.required)) &&
      (!c.validation || !Array.isArray(c.validation.enumValues) ||
        c.validation.enumValues.length === 0)
    );
  });
}

async function regUseFormSeed() {
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

  // ADR 0044 §2 — apply accepted LLM-overlay suggestions to the seed
  // BEFORE handoff so the downstream seed reflects Sarah's resolved
  // post-acceptance state. The applied envelopes also flow through to
  // Smart Start assist (slice-19 analog) so its prompt sees what's
  // already been decided.
  const acceptedLlmSuggestions = regFormOverlay_applyAcceptedToSeed(seed);

  // Row-label recovery for table-shaped fields whose VLM extraction came
  // through structurally-correct (array<object> with itemChildren) but
  // with an empty enum row identifier. The structural-review apply path
  // already runs the same heuristic; we duplicate it here because *no
  // structural review fires* on a properly-shaped table — so without this
  // hook Sarah lands on the canvas with the right shape but no row
  // taxonomy. Same source signals: parenthesised lists in the field's
  // description + the longest vertical run of capitalised tokens in the
  // cached per-page OCR text (split on column-layout whitespace).
  //
  // When recovery succeeds, the field also lands in "Fixed labels" mode
  // (locked rows; min/max == row count; row identifier readOnly) — Sarah
  // sees the right Composer Preview immediately and can flip to "Chosen
  // by operator" on the canvas if she wants spreadsheet semantics.
  //
  // Row-label recovery — VLM-first, OCR-heuristic fallback. Fires whenever
  // the seed has an empty array<object> row identifier AND the source
  // image/PDF is cached. The earlier predicate gated this on OCR cache
  // emptiness, which was wrong: Sarah's typical flow is to run the LLM
  // overlay (which populates OCR cache) BEFORE clicking "Use this schema"
  // — making the recovery never fire. The right gating is just "do we
  // have empty tables AND a source image".
  if (_regFormSeed_hasEmptyTableRowIdentifier(seed) &&
      _regFormSeed_hasCachedSourceImage()) {
    const useBtn = document.getElementById('reg-form-use-btn');
    const prevLabel = useBtn ? useBtn.innerHTML : null;
    if (useBtn) {
      useBtn.disabled = true;
      useBtn.innerHTML = '<i class="ti ti-loader-2"></i> Recovering row labels…';
    }
    let vlmRecovered = false;
    try {
      vlmRecovered = await _regFormSeed_applyVlmRowLabelRecovery(seed);
    } catch (err) {
      console.warn('[reg-form-onramp] VLM row-label recovery raised:', err);
    }
    // OCR fallback only when VLM didn't fill EVERY empty table AND we
    // don't already have OCR cached.
    const stillEmpty = _regFormSeed_hasEmptyTableRowIdentifier(seed);
    const ocrAlready = regDraft.source && regDraft.source.ocrTextByPage &&
      Object.keys(regDraft.source.ocrTextByPage).length > 0;
    if (!vlmRecovered && stillEmpty && !ocrAlready) {
      try {
        const ocrTextByPage = await regFormOverlay_buildOcrTextByPage(() => {});
        regDraft.source = regDraft.source || {};
        regDraft.source.ocrTextByPage = ocrTextByPage || {};
      } catch (err) {
        console.warn('[reg-form-onramp] on-demand OCR fallback failed:', err);
      }
    }
    if (useBtn && prevLabel !== null) {
      useBtn.disabled = false;
      useBtn.innerHTML = prevLabel;
    }
  }
  _regFormSeed_autoFillTableRowIdentifiers(seed);

  // ADR 0044 / slice 27 — form-path version refit. When active, bump the
  // seed's version, attach the forkedFrom identity, and compute the three-
  // way diff against L0 so the canvas refit drawer can surface what
  // changed against the prior version.
  let refitDiff = null;
  if (regFormRefit_isActive()) {
    seed.meta = seed.meta || {};
    seed.meta.version = _regFormRefit.bumpedVersion;
    seed._forkedFromElementId = _regFormRefit.elementId;
    seed._forkedFromVersion   = _regFormRefit.fromVersion;
    refitDiff = regFormRefit_computeDiff(seed.fields);
  }

  regCloseFormOnramp();
  registerOnramp_completeWithSeed({
    fields: seed.fields,
    meta: seed.meta,
    groups: seed._groups || null,
    rules: seed.rules || null,                                       // cross-field companion-required rules per FIX-2
    source: {
      onramp: 'form',
      extractedKey: seed._key || 'unknown',
      forkedFromElementId: seed._forkedFromElementId || null,
      forkedFromVersion:   seed._forkedFromVersion || null
    },
    acceptedLlmSuggestions: acceptedLlmSuggestions,                  // ADR 0044 §6 — downstream Smart Start handoff
    refitDiff: refitDiff                                             // ADR 0044 / slice 27 — surface in canvas refit drawer
  });
  _regLastFormSeed = null;
  regFormOverlay_reset();
  regFormRefit_reset();
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
    // ADR 0042 §7 refit path — the spec-sheet on-ramp computes the bumped
    // version when committing a refit. Overwrite the default 'v1.0' so the
    // canvas header shows the right version pill from the start.
    if (seed.meta.version && (!regDraft.meta.version || regDraft.meta.version === 'v1.0')) regDraft.meta.version = seed.meta.version;
  }
  // Field assignment — replace whatever was there (an on-ramp seed is a fresh
  // starting point; partial seeds aren't a v1 feature).
  // ADR 0045 §1 — use regDeepCloneField for recursive deep-clone with fresh
  // IDs. Fixes nested-object children being silently dropped by the previous
  // explicit property-list mapper (which omitted `children`).
  if (Array.isArray(seed.fields) && seed.fields.length) {
    regDraft.fields = seed.fields.map(f => regDeepCloneField(f));
  }
  // Cross-field validation rules — companion-field requirements emitted by
  // regBuildSeedFromVlmExtraction for the "Others ____" pattern. Each rule
  // is govaluate-style, runs at validation time, fires on_failure when the
  // companion enum option is held without the companion field being filled.
  if (Array.isArray(seed.rules) && seed.rules.length) {
    regDraft.rules = (regDraft.rules || []).concat(
      seed.rules.map(r => Object.assign({
        id: 'r_' + Math.random().toString(36).slice(2, 9)
      }, r))
    );
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
  // Slice 13 — pipe accepted LLM suggestions into the canvas's Structural
  // Review drawer as a read-only "Applied from spec sheet" section so Sarah
  // can re-visit them post-commit. Pending refit cards keep driving the
  // badge count; these are audit-only.
  if (Array.isArray(seed.acceptedLlmSuggestions) && seed.acceptedLlmSuggestions.length
      && typeof regEnsureRefitState === 'function') {
    const r = regEnsureRefitState();
    r.appliedFromSpecSheet = (r.appliedFromSpecSheet || []).concat(seed.acceptedLlmSuggestions);
  }
  // ADR 0044 / slice 27 — form-path version refit produces a three-way
  // diff against the prior published version. Stash it on the refit state
  // so the drawer can surface a summary (added/removed/modified counts).
  if (Array.isArray(seed.refitDiff) && seed.refitDiff.length
      && typeof regEnsureRefitState === 'function') {
    const r = regEnsureRefitState();
    r.formRefitDiff = seed.refitDiff.slice();
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
    seed.source.onramp === 'nl' ||
    seed.source.onramp === 'spec-sheet'  // ADR 0042 — assist consumes xSource sidecars
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
      // ADR 0044 / slice 27 — version refit for the form on-ramp. Mirrors
      // spec-sheet's `version-spec-sheet` mode: open the element picker
      // first so Sarah identifies which prior version this form refreshes,
      // then re-open the form modal in refit mode with L0 captured.
      if (regDraft && regDraft.mode === 'version') {
        regDraft.mode = 'version-form';
        if (typeof regOpenElementPicker === 'function') regOpenElementPicker('version-form');
        return;
      }
      regOpenFormOnramp();
    } else if (onramp === 'spec-sheet') {
      // ADR 0042 — fifth Smart Start seed on-ramp. In greenfield (`+ New
      // element`) this opens directly. In refit (`+ New version`) we first
      // open the element picker so Sarah picks which existing element this
      // updated xlsx refreshes; once picked the L0 schema is captured and
      // the on-ramp opens in refit mode.
      if (regDraft && regDraft.mode === 'version') {
        regDraft.mode = 'version-spec-sheet';                 // discriminator picked up by regForkFromElement
        if (typeof regOpenElementPicker === 'function') regOpenElementPicker('version-spec-sheet');
        return;
      }
      if (typeof regOpenSpecSheetOnramp === 'function') regOpenSpecSheetOnramp();
    } else if (onramp === 'fork') {
      // Mode flows through: 'new' = greenfield fork, 'version' = bump existing.
      const mode = (regDraft && regDraft.mode === 'version') ? 'version' : 'new';
      if (typeof regOpenElementPicker === 'function') regOpenElementPicker(mode);
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
  window.regOpenSourceRegionViewer = regOpenSourceRegionViewer;
  window.regCloseSourceRegionViewer = regCloseSourceRegionViewer;
  window.regClassifyFile = regClassifyFile;
  window.regProcessDocxFile = regProcessDocxFile;
  window.regRenderFormSeedSummary = regRenderFormSeedSummary;
  window.regParseExtractedText = regParseExtractedText;
  window.regFormSeedFromFilename = regFormSeedFromFilename;
  window.regResetFormOnramp = regResetFormOnramp;
  // ADR 0044 §2 — slice 25 overlay UI handlers exposed for the inline
  // onclick markup in the rendered cards + for tests.
  window.regRunFormLlmOverlay              = regRunFormLlmOverlay;
  window.regSkipFormLlmOverlay             = regSkipFormLlmOverlay;
  window.regAcceptFormLlmSuggestion        = regAcceptFormLlmSuggestion;
  window.regRejectFormLlmSuggestion        = regRejectFormLlmSuggestion;
  window.regResolveFormLlmConflict         = regResolveFormLlmConflict;
  window.regFormOverlay_applyAcceptedToSeed = regFormOverlay_applyAcceptedToSeed;
  window.regFormOverlay_renderPanel        = regFormOverlay_renderPanel;
  window.regFormOverlay_reset              = regFormOverlay_reset;
  window.regFormOverlay_updateUseButton    = regFormOverlay_updateUseButton;
  // Expose state for tests (and the diagnostics panel in slice 26).
  window._regFormOverlay_getState   = () => _regFormOverlayState;
  window._regFormOverlay_getResult  = () => _regFormOverlayResult;
  window._regOnramps_getLastFormSeed = () => _regLastFormSeed;
  // ADR 0044 / slice 27 — form-path version refit exposed for the element
  // picker intercept + for tests.
  window.regOnElementPickedForFormRefit = regOnElementPickedForFormRefit;
  window.regFormRefit_isActive          = regFormRefit_isActive;
  // Row-label recovery — exposed so canvas-side click handlers (Fixed
  // labels segmented control, structural-review accept post-hook) can
  // invoke the same targeted VLM call we use at form-seed handoff time.
  window._regFormSeed_applyVlmRowLabelRecovery = _regFormSeed_applyVlmRowLabelRecovery;
  window._regFormSeed_vlmRecoverRowLabels      = _regFormSeed_vlmRecoverRowLabels;
  window._regFormSeed_renderPdfPageToImage     = _regFormSeed_renderPdfPageToImage;
  window._regFormSeed_hasEmptyTableRowIdentifier = _regFormSeed_hasEmptyTableRowIdentifier;
  window._regFormSeed_hasCachedSourceImage     = _regFormSeed_hasCachedSourceImage;
  window.regFormRefit_reset             = regFormRefit_reset;
  window.regFormRefit_computeDiff       = regFormRefit_computeDiff;
  window._regFormRefit_get              = () => _regFormRefit;

  // Test/demo helpers
  window.regParseSample = regParseSample;
  window.REG_NL_EXAMPLES = REG_NL_EXAMPLES;
  window.registerOnramp_completeWithSeed = registerOnramp_completeWithSeed;
  window.regDemoSimulateFormUpload = regDemoSimulateFormUpload;
  window.regDemoShowSamplePreview = regDemoShowSamplePreview;
  window.regDemoLoadSamplePdf     = regDemoLoadSamplePdf;
}

/* ============================================================
   Source-region viewer — opens the operator's uploaded document
   with the cited page + bbox highlighted. Used by the "View region"
   affordance on grounded assist suggestions (smart-start-assist-ui).

   Contract:
   - source.type === 'pdf-region' is the only type the affordance is wired
     to; source.ref is `page=N[,bbox=[x1,y1,x2,y2]]`.
   - The uploaded document is read from regDraft.source.uploadedFile (see
     regOnFormFile) — a data URL + filename + mime + kind ('pdf' | 'image'
     | 'docx'). If absent (e.g., the operator landed on the canvas via the
     Sample or Plain English on-ramps), we surface a "source not available"
     message instead of an empty modal.
   - PDF rendering reuses the lazy-loaded pdf.js dependency already used by
     the form on-ramp. Image renders inline. DOCX has no spatial coords so
     we explain that and show the extracted text excerpt instead.
   ============================================================ */

function regParseSourceRef(ref) {
  if (typeof ref !== 'string') return { page: null, bbox: null };
  const out = { page: null, bbox: null };
  const pageMatch = ref.match(/page=(\d+)/);
  if (pageMatch) out.page = parseInt(pageMatch[1], 10);
  // bbox can be encoded as "bbox=[x1,y1,x2,y2]" or "bbox=x1,y1,x2,y2".
  const bboxMatch = ref.match(/bbox=\[?\s*([-\d.,\s]+?)\s*\]?(?:,[a-z]|$)/i);
  if (bboxMatch) {
    const parts = bboxMatch[1].split(',').map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
    if (parts.length === 4) out.bbox = parts;
  }
  return out;
}

async function regOpenSourceRegionViewer(source) {
  const parsed = regParseSourceRef(source && source.ref);
  const uploaded = (regDraft && regDraft.source && regDraft.source.uploadedFile) || null;

  // Ensure the modal scaffold exists. We inject it lazily to keep the
  // initial HTML lean and self-contained.
  let modal = document.getElementById('reg-source-region-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reg-source-region-modal';
    modal.className = 'reg-source-region-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'reg-source-region-title');
    modal.innerHTML = ''
      + '<div class="reg-source-region-backdrop" onclick="regCloseSourceRegionViewer()"></div>'
      + '<div class="reg-source-region-panel">'
      +   '<div class="reg-source-region-head">'
      +     '<div>'
      +       '<h3 id="reg-source-region-title">Source region</h3>'
      +       '<p class="reg-source-region-meta" id="reg-source-region-meta"></p>'
      +     '</div>'
      +     '<button type="button" class="reg-source-region-close" onclick="regCloseSourceRegionViewer()" aria-label="Close viewer"><i class="ti ti-x"></i></button>'
      +   '</div>'
      +   '<div class="reg-source-region-body" id="reg-source-region-body"></div>'
      +   '<div class="reg-source-region-excerpt" id="reg-source-region-excerpt" hidden></div>'
      + '</div>';
    document.body.appendChild(modal);
  }

  const meta = document.getElementById('reg-source-region-meta');
  const body = document.getElementById('reg-source-region-body');
  const exc  = document.getElementById('reg-source-region-excerpt');

  // Reset body for each open so a previous open's render doesn't bleed through.
  if (body) body.innerHTML = '<div class="reg-source-region-loading"><i class="ti ti-loader-2 reg-spin"></i> Loading source…</div>';
  if (exc) {
    if (source && source.excerpt) {
      exc.hidden = false;
      exc.innerHTML = '<span class="reg-source-region-excerpt-label">Excerpt</span> <span class="reg-source-region-excerpt-body"></span>';
      exc.querySelector('.reg-source-region-excerpt-body').textContent = source.excerpt;
    } else {
      exc.hidden = true;
      exc.innerHTML = '';
    }
  }
  if (meta) {
    const parts = [];
    if (uploaded && uploaded.filename) parts.push(uploaded.filename);
    if (parsed.page) parts.push('page ' + parsed.page);
    if (parsed.bbox) parts.push('bbox [' + parsed.bbox.join(', ') + ']');
    meta.textContent = parts.join(' · ') || 'No location data on the citation';
  }

  modal.classList.add('is-open');

  if (!uploaded || !uploaded.dataUrl) {
    if (body) body.innerHTML = ''
      + '<div class="reg-source-region-fallback">'
      +   '<i class="ti ti-file-off"></i>'
      +   '<p><strong>Original document not available.</strong> The "View region" viewer needs the operator-uploaded file, which is kept in memory for the current session only. '
      +     'Re-upload the form via the Form on-ramp to enable region highlighting on assist suggestions.</p>'
      + '</div>';
    return;
  }

  try {
    if (uploaded.kind === 'pdf') {
      await regRenderPdfRegion(body, uploaded, parsed);
    } else if (uploaded.kind === 'image') {
      regRenderImageRegion(body, uploaded, parsed);
    } else if (uploaded.kind === 'docx') {
      if (body) body.innerHTML = ''
        + '<div class="reg-source-region-fallback">'
        +   '<i class="ti ti-file-text"></i>'
        +   '<p><strong>Bounding-box highlighting is not available for Word documents.</strong> DOCX text has no fixed page coordinates. The excerpt above shows the cited region in context.</p>'
        + '</div>';
    } else {
      if (body) body.innerHTML = '<div class="reg-source-region-fallback"><i class="ti ti-question-mark"></i><p>Unknown source document type: ' + escapeHtmlOnramp(uploaded.kind) + '.</p></div>';
    }
  } catch (err) {
    console.warn('[reg-onramps] source region render failed:', err);
    if (body) body.innerHTML = '<div class="reg-source-region-fallback"><i class="ti ti-alert-triangle"></i><p>Could not render source region: ' + escapeHtmlOnramp(err && err.message ? err.message : 'unknown error') + '</p></div>';
  }
}

function regCloseSourceRegionViewer() {
  const modal = document.getElementById('reg-source-region-modal');
  if (modal) modal.classList.remove('is-open');
}

/* Render the cited PDF page to a canvas, then overlay the bbox as a
 * highlight rectangle. pdf.js viewport-transforms PDF coords (origin
 * bottom-left, y-up) to canvas pixel coords (origin top-left, y-down). */
async function regRenderPdfRegion(body, uploaded, parsed) {
  await regLoadOcrLibs();        // ensures window.pdfjsLib is ready
  if (!window.pdfjsLib) throw new Error('pdf.js not available');
  if (!body) return;

  // Data URL → arrayBuffer for pdf.js (it accepts {data: Uint8Array}).
  const b64 = (uploaded.dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const pdf = await window.pdfjsLib.getDocument({ data: u8 }).promise;
  const pageNum = Math.min(Math.max(1, parsed.page || 1), pdf.numPages);
  const page = await pdf.getPage(pageNum);

  // Scale to fit the modal width (~720px content area) but cap so very tall
  // pages aren't laid out absurdly long either.
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 720;
  const scale = Math.min(targetWidth / baseViewport.width, 2);
  const viewport = page.getViewport({ scale });

  const wrap = document.createElement('div');
  wrap.className = 'reg-source-region-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  wrap.appendChild(canvas);

  // Draw the bbox overlay only when coordinates were provided in the ref.
  if (parsed.bbox) {
    const [x1, y1, x2, y2] = parsed.bbox;
    // bbox coords assumed in PDF point space at scale=1. Convert via the
    // viewport transform (which handles the y-axis flip).
    const r = viewport.convertToViewportRectangle([x1, y1, x2, y2]);
    const left = Math.min(r[0], r[2]);
    const top  = Math.min(r[1], r[3]);
    const w    = Math.abs(r[2] - r[0]);
    const h    = Math.abs(r[3] - r[1]);
    const hl = document.createElement('div');
    hl.className = 'reg-source-region-bbox';
    hl.style.left   = left + 'px';
    hl.style.top    = top  + 'px';
    hl.style.width  = w    + 'px';
    hl.style.height = h    + 'px';
    wrap.appendChild(hl);
  }

  body.innerHTML = '';
  body.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

/* Render an uploaded image with the bbox highlight overlay. Coordinates are
 * assumed in the image's native pixel space (which is how a VLM that saw the
 * raw image would report them). We scale-down to fit the modal width and
 * apply the same scale to the bbox. */
function regRenderImageRegion(body, uploaded, parsed) {
  if (!body) return;
  const wrap = document.createElement('div');
  wrap.className = 'reg-source-region-canvas-wrap';
  const img = new Image();
  img.alt = 'Uploaded source';
  img.className = 'reg-source-region-image';
  img.onload = () => {
    const targetWidth = 720;
    const scale = Math.min(targetWidth / img.naturalWidth, 1);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    if (parsed.bbox) {
      const [x1, y1, x2, y2] = parsed.bbox;
      const left = Math.min(x1, x2) * scale;
      const top  = Math.min(y1, y2) * scale;
      const bw   = Math.abs(x2 - x1) * scale;
      const bh   = Math.abs(y2 - y1) * scale;
      const hl = document.createElement('div');
      hl.className = 'reg-source-region-bbox';
      hl.style.left = left + 'px';
      hl.style.top = top + 'px';
      hl.style.width = bw + 'px';
      hl.style.height = bh + 'px';
      wrap.appendChild(hl);
    }
  };
  img.src = uploaded.dataUrl;
  wrap.appendChild(img);
  body.innerHTML = '';
  body.appendChild(wrap);
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
