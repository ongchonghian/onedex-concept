/* ============================================================
   DEMOS — flow: Publish a new version of an existing Data Element (fork)
   Per ADR 0034 + 0039 §2.

   Story: Sarah needs to bump Bill of Lading from v2.1 to v2.2. She uses
   the +New version CTA (distinct from +New element per ADR 0039 §2), picks
   the source from the element picker, the fork on-ramp pre-fills the full
   schema, version auto-bumps, and Publish creates a new immutable record —
   existing Agreements stay on their v2.1 snapshot, new Agreements pick v2.2.

   This demo is shorter than register-element.js — its job is to make the
   "two CTAs = two distinct governance acts" decision (Q3) visible by
   actually walking the second CTA. And to make ADR 0026's snapshot
   immutability tangible: not "your edits go live everywhere," but
   "a new version is a new record, and existing things keep what they had."

   ADRs demonstrated:
     · 0026 — snapshot immutability (the load-bearing one)
     · 0039 §2 — two distinct CTAs
     · 0039 §10 — fork on-ramp seeds the canvas
   ============================================================ */

(function (window) {
  'use strict';

  const versionElement = {
    id: 'version-element',
    title: 'Publish a new version',
    description: "Sarah bumps Bill of Lading from v2.1 to v2.2. The fork starts her on the existing schema; publishing creates a new record while everything already running stays on v2.1.",
    adrs: ['0026', '0039'],
    durationSec: 50,

    seed: (workspace) => {
      // Same Sarah-as-platform-admin seed as the register flow.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'sarah', dexId: 'tx' });
      }
      if (typeof window.switchPersona === 'function') {
        window.switchPersona('platform-admin');
      }
      try {
        if (window.localStorage) window.localStorage.removeItem('registerElement.wip');
      } catch (e) { /* best-effort */ }
    },

    steps: [
      // ---- Catalogue ----
      { action: 'goto', target: 'data-elements' },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-version-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-version-cta"]',
        label: 'Step 1 of 6 — Bump, not fork',
        rationale: "Sarah needs to update Bill of Lading, not invent a new document. The +New version button is for that — bumping an element she already publishes. Keeping it separate from +New element means she can't accidentally clone a duplicate when she meant to revise.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-version-cta"]', dwell: 700 },

      // ---- On-ramp picker — fork is the only seeder that fully wires v2.1's
      //      schema into the canvas (Spec-sheet refit lands by-element diff;
      //      Smart Start re-extracts). Pick fork explicitly per ADR 0042 §2. ----
      { action: 'expect', target: '#register-onramp-picker [data-demo="onramp.fork"]' },
      { action: 'click',  target: '#register-onramp-picker [data-demo="onramp.fork"]', dwell: 600 },

      // ---- Element picker ----
      { action: 'expect', target: '#register-element-picker [data-element-id="bill-of-lading"]' },

      { action: 'annotate',
        anchor: '#register-element-picker [data-element-id="bill-of-lading"]',
        label: 'Step 2 of 6 — Pick what to update',
        rationale: "Going straight into the picker — there's only one sensible starting point for a version bump, which is the element being bumped. Sarah picks Bill of Lading.",
        dwell: 4400 },

      { action: 'click', target: '#register-element-picker [data-element-id="bill-of-lading"]', dwell: 800 },

      // ---- Canvas — Schema tab ----
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list] .reg-field-row' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-page-title]',
        label: 'Step 3 of 6 — Same form, ready to revise',
        rationale: "The canvas opens with Bill of Lading already filled in — same name, same fields, version bumped to v2.2. Sarah edits only what's actually changing in the new version. Everything else stays put.",
        dwell: 4600 },

      // ---- Compose complexity — pick high-stakes for the bump ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-reg-tab="complexity"]', dwell: 700 },
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]', dwell: 700 },

      // ---- Review tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-reg-tab="review"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences',
        label: 'Step 4 of 6 — Existing partners stay put',
        rationale: "Before Sarah publishes, the Review tab spells out what bumping a version actually means: every agreement already using v2.1 keeps it exactly as it was. Anyone creating a new agreement from today picks v2.2 by default. Partners on existing relationships aren't bothered — their version doesn't change underneath them.",
        dwell: 5200 },

      // ---- Publish ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.publish"]', dwell: 900 },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 5 of 6 — Two versions, both live',
        rationale: "Both versions sit in the catalogue now. v2.1 is still serving everything that was already running. v2.2 is the new default for anything created from today. Sarah didn't have to coordinate a migration window; she didn't have to email partners; nothing they're already doing changes.",
        dwell: 5000 },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-version-cta"]',
        label: 'Step 6 of 6 — Sarah\'s done',
        rationale: "Two clicks to start, then the same canvas she'd use for any element. Sarah doesn't need a different tool for version bumps versus brand-new elements — same workflow, just a different starting point.",
        dwell: 4800 }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(versionElement);
  } else {
    console.warn('demos/version-element.js loaded before runtime.js — flow not registered');
  }

})(window);
