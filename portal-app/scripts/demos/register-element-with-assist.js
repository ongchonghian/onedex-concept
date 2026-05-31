/* ============================================================
   DEMOS — flow: Register a Data Element with Smart Start assist
   Per ADR 0034 + 0037 + 0039 + 0040.

   Story: Diane is a platform admin on SGBuildex. A BCA-issued
   "Environmental Site Observations" form needs to land in the catalogue.
   She uploads the PDF; Smart Start assist extracts the fields, groups
   them by section, and overlays suggestions across Schema / Complexity /
   Rules / Review with citable provenance. She walks the canvas, opens
   Test as operator to see the validation rules fire live against typed
   values, then publishes v1.0.

   This demo exercises the Phase 1 deliverable from ADR 0040 §16:
     · Form/PDF on-ramp triggers assist
     · Grouped extraction renders in the Form-onramp preview, the Schema
       tab, the Composer rail, the Review tab, and the Test-as-operator
       modal — same grouping at every surface
     · Canned-response fixture (env-site-obs on bx) provides the assist
       suggestions; no live API key needed
     · Test-as-operator runs the production rule engine live against
       typed values; Submit gates on every rule passing

   Per ADR 0037, targets stable data-demo anchors only. Class selectors
   and nth-child positionals are not used.
   ============================================================ */

(function (window) {
  'use strict';

  const registerElementWithAssist = {
    id: 'register-element-with-assist',
    title: 'Register with Smart Start assist',
    description: "Diane on SGBuildex uploads an Environmental Site Observations PDF. Smart Start assist extracts the fields grouped by section, overlays grounded suggestions across all four tabs, runs validation rules live in Test as operator, and Diane ships v1.0.",
    adrs: ['0034', '0037', '0038', '0039', '0040'],
    durationSec: 120,

    seed: (workspace) => {
      // Pin Diane (Diane) as the active platform-tier admin on SGBuildex.
      // Per PLATFORM_ADMIN_BY_DEX (state.js), Diane is the BX platform
      // admin; setActivePersona ties her to the BX chrome.
      // setActivePersona writes workspace.meta.activeUserId / activeDexId.
      // The runtime's seedWorkspaceForFlow calls initializeWorkspaceApp()
      // *after* this seed returns, and initializeWorkspaceApp reads
      // workspace.meta.activeDexId and applies the matching theme + DEX
      // chrome via switchDex(). So the theme flip is handled automatically;
      // no need to call switchDex from the seed.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'diane', dexId: 'bx' });
      }
      if (typeof window.switchPersona === 'function') {
        window.switchPersona('platform-admin');
      }
      // Clear any in-flight registration work + any operator-supplied API
      // keys, so the demo runs deterministically through the canned path.
      try {
        if (window.localStorage) {
          window.localStorage.removeItem('registerElement.wip');
          if (window.smartStart) {
            if (typeof window.smartStart.clearApiKey === 'function') window.smartStart.clearApiKey();
            if (typeof window.smartStart.clearMoonshotKey === 'function') window.smartStart.clearMoonshotKey();
            if (typeof window.smartStart.clearXaiKey === 'function') window.smartStart.clearXaiKey();
          }
        }
      } catch (e) { /* best-effort */ }
    },

    steps: [
      // ---- Catalogue ----
      { action: 'goto', target: 'data-elements' },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 1 of 10 — Diane opens the SGBuildex catalogue',
        rationale: "Diane is the platform admin on SGBuildex. A BCA inspector handed her an Environmental Site Observations form on PDF and asked for it in the catalogue by next week. The +New element button is hers — no service request, no ticket, no waiting on engineering.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]', dwell: 700 },

      // ---- On-ramp picker ----
      { action: 'expect', target: '#register-onramp-picker [data-demo="onramp.form"]' },

      { action: 'annotate',
        anchor: '#register-onramp-picker [data-demo="onramp.form"]',
        label: 'Step 2 of 10 — Pick the PDF on-ramp',
        rationale: "Four ways to seed the canvas. Diane has the actual document, so she picks the PDF path — the system will read it, extract the fields, and group them by section before she ever touches the schema editor.",
        dwell: 4400 },

      { action: 'click', target: '#register-onramp-picker [data-demo="onramp.form"]', dwell: 700 },

      // ---- Form on-ramp — drop the PDF ----
      { action: 'expect', target: '#register-form-onramp [data-demo="onramp.form.dropzone"]' },

      { action: 'annotate',
        anchor: '#register-form-onramp [data-demo="onramp.form.dropzone"]',
        label: 'Step 3 of 10 — Drop the PDF',
        rationale: "Diane drops the BCA Environmental Site Observations form on the dropzone. Stage 1 reads the PDF page by page and asks a vision model to pull out every labelled field. Stage 2 organises what came back into the logical sections the document itself uses.",
        dwell: 4600 },

      // Simulate a successful VLM extraction without driving a real File
      // drop. The helper opens the modal (already open here), lands a
      // pre-grouped env-site-obs seed, and flips stage to 'done' so the
      // "Use this schema" button enables.
      { action: 'call', fn: 'regDemoSimulateFormUpload', after: 400 },

      { action: 'expect', target: '#register-form-onramp [data-demo="onramp.form.use"]:not([disabled])' },

      { action: 'annotate',
        anchor: '#register-form-onramp [data-demo="onramp.form.summary"]',
        label: 'Step 4 of 10 — Extracted, grouped, ready to review',
        rationale: "Three sections came back the way the form lays them out — Site identification, Observation, Sign-off. Diane sees the field types the system inferred and the count per group. If she'd uploaded a different form she'd get different groups; the grouping is what the document said, not what the system guessed.",
        dwell: 5200 },

      { action: 'click', target: '#register-form-onramp [data-demo="onramp.form.use"]', dwell: 800 },

      // ---- Canvas — Schema tab ----
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list]',
        label: 'Step 5 of 10 — Grouping survives the handoff',
        rationale: "The Schema tab keeps the same three groups Diane saw in the preview. The system added a couple of suggestions she didn't have — a residency-strict flag, a tighter type on observation_id — each with a provenance chip she can click to see the citation. Nothing's been committed yet; every change still needs her sign-off.",
        dwell: 5400 },

      // ---- Compose complexity tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-complexity"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="complexity"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="complexity"]',
        label: 'Step 6 of 10 — Routine, or legally significant?',
        rationale: "The assist suggests high-stakes — the form carries a signature field and a regulatory citation, so contractors should get a 3-step review flow rather than a single-page submit. The suggestion is a recommendation with citations; the decision is Diane's, not the system's.",
        dwell: 4800 },

      // Diane confirms the assist's recommendation. The click also satisfies
      // the regPublish gate later (regPublish silently returns when
      // composeComplexity is null) — the canned-response auto-apply sets it
      // optimistically, but an explicit user click is the demo's promise.
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]', dwell: 700 },

      // ---- Rules tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-rules"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]',
        label: 'Step 7 of 10 — Validation rules, already drafted',
        rationale: "Three rules came back with the assist: observation date can't be in the future, observation ID matches the BCA-prescribed format, and negative observations must carry a severity. Below them, the Suggested for your schema panel offers more in two clearly labelled groups — per-field rules (formats, ranges) and cross-field rules (date order, mutual exclusivity). Diane can pick more as she likes.",
        dwell: 5400 },

      // ---- Review tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="register-canvas.tab-review"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences',
        label: 'Step 8 of 10 — One last look before publishing',
        rationale: "The Review tab shows everything together — schema with groups, every rule with the operator-visible failure message, the sample payload the rules evaluate against, and a pack-fit suggestion. It also spells out what publish actually does: new agreements from today will pick this version; agreements already running stay on whatever they were created with.",
        dwell: 5400 },

      // ---- Test as operator — open the modal and show live validation ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.test-as-operator"]', dwell: 700 },
      { action: 'expect', target: '#register-test-modal [data-demo="test.submit"]' },

      { action: 'annotate',
        anchor: '#register-test-modal [data-demo="test.submit"]',
        label: 'Step 9 of 10 — Test as operator',
        rationale: "Before publishing, Diane wants to feel what a contractor will feel. The Test as operator modal renders the same form the contractor will get and runs every validation rule live against what she types. Submit stays locked until every rule passes — same engine, same messages, same gates as production.",
        dwell: 5000 },

      // Type a valid observation_id so the matches() rule passes.
      { action: 'type',
        target: '#register-test-modal [data-demo="test.input.observation_id"]',
        text: 'ENV-2026-05-21-001',
        after: 400 },

      { action: 'annotate',
        anchor: '#register-test-modal [data-demo="test.input.observation_id"]',
        label: 'Watch the rules light up',
        rationale: "Diane types a valid observation ID. The matches() rule on the right flips from FAILS to PASSES the moment the pattern matches. If she'd typed something off-format, she'd see the operator-visible error message the same way a real contractor would.",
        dwell: 4600 },

      // Close the test modal and ship it.
      { action: 'click', target: '#register-test-modal [data-demo="test.close"]', dwell: 600 },

      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.publish"]', dwell: 900 },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 10 of 10 — Done. Environmental Site Observations v1.0 is live.',
        rationale: "From dropping the PDF to a publishable v1.0: one screen, one platform admin, no service request, no engineering relay. The grouping she saw in the preview survives into the form contractors will fill, and every assist suggestion she accepted carries a citation that future reviewers can trace.",
        dwell: 5400 }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(registerElementWithAssist);
  } else {
    // Stash for late wiring if runtime hasn't loaded yet (e.g. JSDOM test
    // where load order is enforced separately).
    window.__pendingDemoFlows = window.__pendingDemoFlows || [];
    window.__pendingDemoFlows.push(registerElementWithAssist);
  }
})(window);
