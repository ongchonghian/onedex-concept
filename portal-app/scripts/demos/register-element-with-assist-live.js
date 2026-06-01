/* ============================================================
   DEMOS — flow: Register with Smart Start assist (LIVE pipeline)
   Per ADR 0034 + 0037 + 0039 + 0040.

   Sibling of register-element-with-assist.js. The canned variant uses
   regDemoSimulateFormUpload to bypass extraction so the demo is fast and
   deterministic. THIS variant fetches a bundled sample WebP image, shows
   it to the operator inside the form on-ramp modal, then drops it onto
   the real Tesseract / VLM pipeline — the saved API key + selected VLM
   provider drive routing exactly as a real upload does.

   Use this when stakeholders want to feel the real thing: the same
   storyline the canned demo tells, but the extraction actually hits the
   operator-configured VLM. Expect 30-180s per page (one page here, since
   the sample is a single WebP).

   headlessSkip: the JSDOM smoke (tests/demos.test.js) skips this flow
   because it requires real fetch + (optionally) real API calls. The
   canned register-element-with-assist flow remains in the smoke for
   regression coverage; this flow exists for live walkthroughs only.
   ============================================================ */

(function (window) {
  'use strict';

  // Sample document — drop the source image at portal-app/assets/ to enable
  // this demo. The filename is referenced from the form on-ramp's classifier
  // (`.webp` lands in the image branch → VLM vision if key saved, Tesseract
  // OCR otherwise).
  const SAMPLE_URL      = 'assets/demo-bca-workhead.webp';
  const SAMPLE_FILENAME = 'bca-workhead-track-record.webp';

  const flow = {
    id: 'register-element-with-assist-live',
    title: 'Register with assist (live)',
    description: "Diane uploads a real BCA Workhead Track Record form. The system reads the page, names the fields, drafts the schema and the validation rules — and Diane ships v1.0. Same story as the canned walkthrough, but the document is real and the saved AI key actually does the reading.",
    adrs: ['0034', '0037', '0038', '0039', '0040'],
    durationSec: 240,
    // Opt out of the JSDOM smoke — this flow does fetch() + real API calls
    // that the headless harness can't satisfy.
    headlessSkip: true,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'diane', dexId: 'bx' });
      }
      if (typeof window.switchPersona === 'function') {
        window.switchPersona('platform-admin');
      }
      // Honest preflight: don't wipe operator-supplied API keys. The whole
      // point of this flow is to exercise them.
      try {
        if (window.localStorage) window.localStorage.removeItem('registerElement.wip');
      } catch (e) { /* best-effort */ }
    },

    steps: [
      // ---- Catalogue ----
      { action: 'goto', target: 'data-elements' },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 1 of 10 — Diane opens the catalogue',
        rationale: "Diane is the platform admin on SGBuildex. A BCA inspector dropped a Workhead Track Record form on her desk this morning and asked for it in the catalogue by next week. She's about to do that herself — no service request, no waiting on engineering.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]', dwell: 600 },

      // ---- On-ramp picker ----
      { action: 'expect', target: '#register-onramp-picker [data-demo="onramp.form"]' },

      { action: 'annotate',
        anchor: '#register-onramp-picker [data-demo="onramp.form"]',
        label: 'Step 2 of 10 — Bring the document in',
        rationale: "Four ways to start. Diane has the actual form in her hand, so she picks the upload path. The system will read it for her — she shouldn't have to retype field names off a PDF in 2026.",
        dwell: 4200 },

      { action: 'click', target: '#register-onramp-picker [data-demo="onramp.form"]', dwell: 600 },

      // ---- Sample preview ----
      { action: 'expect', target: '#register-form-onramp [data-demo="onramp.form.dropzone"]' },

      { action: 'call', fn: 'regDemoShowSamplePreview', args: [SAMPLE_URL, SAMPLE_FILENAME], after: 300 },

      { action: 'annotate',
        anchor: '#register-form-onramp [data-reg-demo-sample-preview]',
        label: 'Step 3 of 10 — Here is the actual document',
        rationale: "This is what BCA hands a contractor — workhead categories, project description, contract value, signatures. In a moment Diane will drop it onto the dropzone and watch the system pull every labelled field out of the image.",
        dwell: 5600 },

      // ---- Real upload ----
      { action: 'call', fn: 'regDemoLoadSamplePdf', args: [SAMPLE_URL, SAMPLE_FILENAME], after: 600 },

      { action: 'annotate',
        anchor: '#register-form-onramp [data-reg-form-stage="extracting"]',
        label: 'Step 4 of 10 — The system reads the form',
        rationale: "The page goes to the AI model Diane configured earlier. It looks at the actual pixels — company name, workhead checkboxes, contract dates, principal addresses — and writes down what it sees. Takes about a minute. She doesn't get the Use this schema button until the read is done, the same way contractors won't get a half-validated form.",
        dwell: 6000 },

      // Long expect window — the live AI read can take 30-180s. timeoutMs
      // tells the runtime to poll every 250ms instead of a one-shot match;
      // stage='done' is the completion signal that re-enables the
      // Use-this-schema CTA, so we use its `:not([disabled])` state as the
      // settle condition.
      { action: 'expect', target: '#register-form-onramp [data-demo="onramp.form.use"]:not([disabled])', timeoutMs: 240000, dwell: 200 },

      { action: 'annotate',
        anchor: '#register-form-onramp [data-demo="onramp.form.summary"]',
        label: 'Step 5 of 10 — Fields, grouped the way the form lays them out',
        rationale: "Company particulars, project details, principal information, banking, trade references — the same sections BCA prints on the form. Diane didn't ask for grouping; the system noticed the headings and used them. If the inspector hands her a different form next month, she'd get whatever sections that one had.",
        dwell: 5200 },

      { action: 'click', target: '#register-form-onramp [data-demo="onramp.form.use"]', dwell: 600 },

      // ---- Canvas walk ----
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list]',
        label: 'Step 6 of 10 — Same groups on the canvas',
        rationale: "The sections she just saw on the preview carry into the editor. Diane can rename a field, switch a type, or untick required before publishing — the system did the reading, the decisions are still hers.",
        dwell: 5000 },

      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-complexity"]', dwell: 600 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="complexity"]' },
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]', dwell: 600 },

      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-rules"]', dwell: 600 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]',
        label: 'Step 7 of 10 — Rules that catch problems before submission',
        rationale: "Suggestions for each individual field (a contract value must be positive, a date must be a valid year) and rules that tie fields together (the completion date can't be earlier than the start date). Diane could pick rules one by one — today she's going to take everything in one click.",
        dwell: 4800 },

      // Take every per-field rule, then every cross-field rule. Two clicks
      // because Diane wants both kinds; the suggestions stay grouped so
      // she can still see what landed where.
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="rules.add-all.field"]', dwell: 600 },
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="rules.add-all.cross-field"]', dwell: 600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"] .reg-rules-list',
        label: 'Every suggested rule is now in the validation list',
        rationale: "Suggested cards greyed out so Diane can see they're taken. The validation panel above ran each rule against a synthesised sample of the schema — all green, which means the rules are well-formed and a typical submission would clear them.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-review"]', dwell: 600 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences',
        label: 'Step 8 of 10 — One last look before it goes live',
        rationale: "Everything Diane has authored, on one tab — the fields, the rules with the message contractors will see on failure, and what publish actually does to agreements already running. If anything looks off, she goes back. If it looks right, she publishes.",
        dwell: 5000 },

      // ---- Test as operator — feel the form before publishing ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.test-as-operator"]', dwell: 700 },
      { action: 'expect', target: '#register-test-modal [data-demo="test.submit"]' },

      { action: 'annotate',
        anchor: '#register-test-modal [data-reg-test-rules-list]',
        label: 'Step 9 of 10 — Empty form, every rule flagged in red',
        rationale: "Diane hasn't typed anything yet. The validation panel on the right shows what would happen if a contractor tried to submit blank — every format rule fails, the Submit button is locked. This is the exact experience a contractor will get; if the rule wording reads wrong here, fix it here.",
        dwell: 5200 },

      // Type a placeholder value into the first text input so the operator
      // sees a rule flip from FAIL → PASS live. The helper picks whichever
      // field came back from the real extraction — we don't pre-bake a
      // field name because the WebP is processed by a real VLM.
      { action: 'call', fn: 'regDemoTypeIntoFirstTestInput', args: ['Acme Construction Pte Ltd'], after: 600 },

      { action: 'annotate',
        anchor: '#register-test-modal [data-reg-test-rules-list]',
        label: 'One keystroke, one rule turns green',
        rationale: "Diane typed into the first field. Watch the rules panel — the rule tied to that field flipped from FAILS to PASSES, and the Submit button is one keystroke closer to unlocking. Same engine evaluates real contractor submissions; same feedback they'll see.",
        dwell: 4800 },

      { action: 'click', target: '#register-test-modal [data-demo="test.close"]', dwell: 600 },

      // ---- Publish ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.publish"]', dwell: 900 },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 10 of 10 — Done. The Workhead Track Record is in the catalogue.',
        rationale: "From handing Diane a paper form to anyone setting up a new agreement being able to pick this form: one screen, one platform admin, one afternoon. No service request was filed, no developer was paged. The next contractor who needs to submit one will fill in the same fields the BCA inspector wrote on the original.",
        dwell: 5400 }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(flow);
  } else {
    window.__pendingDemoFlows = window.__pendingDemoFlows || [];
    window.__pendingDemoFlows.push(flow);
  }
})(window);
