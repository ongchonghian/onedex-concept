/* ============================================================
   DEMOS — flow: Register new Data Element (greenfield via Plain English)
   Per ADR 0034 + 0039.

   Story: Sarah (SGTradex platform-admin) registers a brand-new Concrete
   cube test element. She uses the Plain English on-ramp — describes the
   document in words — and the system seeds the canvas with a draft schema.
   She picks high-stakes complexity, adds a cross-field validation rule,
   reviews the consequences of publish, and ships v1.0. The 9-step legacy
   relay (Excel → SR → Dev → YAML → SwaggerHub → Postman → DevOps restart,
   per update-process-190526-231734.pdf) collapses to one Sarah-authored
   screen.

   Per ADR 0037, this flow targets stable demo anchors. Class selectors
   and nth-child positionals are not used.

   ADRs demonstrated:
     · 0001 — URL-anchored DEX
     · 0015 — no tours; structural friction (Review tab IS the review)
     · 0025 — compose_complexity is DEX-admin-owned, no auto-suggest
     · 0026 — snapshot immutability at publish
     · 0033 — reactive capture (pack-fit suggestion at the moment of friction)
     · 0038 — three-layer governance (Schema · Rules · Routing)
     · 0039 — the registration UX itself
   ============================================================ */

(function (window) {
  'use strict';

  const registerElement = {
    id: 'register-element',
    title: 'Register a new Data Element',
    description: "Sarah, a platform admin on SGTradex, registers a brand-new Concrete cube test element. She describes it in plain English, the system drafts the schema, and she ships v1.0 herself — no service request, no engineering relay.",
    adrs: ['0001', '0015', '0025', '0026', '0033', '0038', '0039'],
    durationSec: 95,

    seed: (workspace) => {
      // Pin Sarah as the active platform-tier admin on SGTradex. Two-step:
      // (1) set user/dex on the workspace meta so chrome readers (sidebar,
      // role chip, etc.) see Sarah, (2) flip currentPersona to 'platform-admin'
      // so currentDexUserRole() returns 'SGTradex Admin' from PLATFORM_INBOX
      // (per app.js:8050). The capability gate added in Impl A then exposes
      // the +New element / +New version CTAs on the catalogue page.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'sarah', dexId: 'tx' });
      }
      if (typeof window.switchPersona === 'function') {
        window.switchPersona('platform-admin');
      }
      // Clear any in-flight registration work from a previous session so the
      // "fresh start" story is honest.
      try {
        if (window.localStorage) window.localStorage.removeItem('registerElement.wip');
      } catch (e) { /* private mode / quota — best-effort */ }
    },

    steps: [
      // ---- Catalogue ----
      { action: 'goto', target: 'data-elements' },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 1 of 9 — Sarah opens the catalogue',
        rationale: "Sarah is a platform admin on SGTradex, so she sees the two register buttons her colleagues without admin rights don't. She's going to author a new data element directly — no service request, no email to the dev team, no waiting for a build.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]', dwell: 700 },

      // ---- On-ramp picker ----
      { action: 'expect', target: '#register-onramp-picker [data-demo="onramp.nl"]' },

      { action: 'annotate',
        anchor: '#register-onramp-picker [data-demo="onramp.nl"]',
        label: 'Step 2 of 9 — Four ways to start',
        rationale: "Sarah can drop a sample CSV, upload an existing PDF form, describe what she needs in plain English, or start from a schema her team already publishes. Four ways in — the same canvas waiting on the other side. She picks the plain-English path because the form is brand new.",
        dwell: 4400 },

      { action: 'click', target: '#register-onramp-picker [data-demo="onramp.nl"]', dwell: 600 },

      // ---- Plain English on-ramp ----
      { action: 'expect', target: '#register-nl-onramp [data-demo="onramp.nl.example-concrete"]' },

      { action: 'annotate',
        anchor: '#register-nl-onramp [data-demo="onramp.nl.example-concrete"]',
        label: 'Step 3 of 9 — Describe it in plain English',
        rationale: "Sarah picks the Concrete cube test example — \"concrete cube test from contractors with project reference, sample date, location, and compressive strength in MPa.\" The system reads her description and starts drafting the schema field by field, the way someone listening to her would write it down.",
        dwell: 4600 },

      { action: 'click', target: '#register-nl-onramp [data-demo="onramp.nl.example-concrete"]', dwell: 600 },

      // Stream is live now — let it play for a moment, then commit.
      { action: 'wait', ms: 2400 },

      { action: 'annotate',
        anchor: '#register-nl-onramp [data-demo="onramp.nl.stream"]',
        label: 'Step 4 of 9 — The fields appear',
        rationale: "Project reference, sample date, location, compressive strength, grade — one after another. Sarah reads what the system understood. If she'd worded her description differently she'd get different fields; she can also rename, drop, or add anything before she commits.",
        dwell: 3800 },

      { action: 'click', target: '#register-nl-onramp [data-demo="onramp.nl.use"]', dwell: 800 },

      // ---- Canvas — Schema tab ----
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="schema"] [data-reg-field-list]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-json-preview]',
        label: 'Step 5 of 9 — What the contractor will see',
        rationale: "On the right, Sarah sees exactly what the contractor on the receiving end will fill in when this element gets composed — same labels, same input shapes. Every edit she makes on the left updates the preview instantly. No guesswork about what landed; no surprise at the other end.",
        dwell: 4600 },

      // ---- Compose complexity tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-reg-tab="complexity"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]',
        label: 'Step 6 of 9 — Routine or legally significant?',
        rationale: "Some documents are routine — fill, send, done. Others are legally significant and deserve a review step before submission. Sarah marks this one high-stakes — contractors will get a 3-step form with an explicit review, not a single-page submit. The system noticed signals in her schema (a signature field, a regulatory grade) and points them out — but the decision is hers, not its.",
        dwell: 4800 },

      { action: 'click', target: '.screen[data-screen="register-element"].active [data-complexity="high-stakes"]', dwell: 700 },

      // ---- Rules tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-reg-tab="rules"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="rules"]',
        label: 'Step 7 of 9 — Add a business rule',
        rationale: "Beyond what the form looks like, Sarah adds business rules — \"test date must be on or after sample date,\" \"compressive strength must be within range.\" The system shows pass/fail against a sample record as she writes them, so she catches mistakes here, not after contractors start submitting.",
        dwell: 4600 },

      // ---- Review tab ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-reg-tab="review"]', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences' },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-consequences',
        label: 'Step 8 of 9 — One last look before publishing',
        rationale: "The Review tab shows Sarah everything in one place — name, fields, complexity, rules. It also spells out what publish actually does: new agreements created from today will pick this version. If she publishes a new version later, agreements already running won't change underneath their participants.",
        dwell: 4800 },

      { action: 'annotate',
        anchor: '.screen[data-screen="register-element"].active [data-reg-tab-panel="review"] .reg-review-pack',
        label: 'Group it with related elements (optional)',
        rationale: "The system noticed Sarah's schema overlaps with the Vessel arrival pack and offers to add it. She can accept the suggestion or skip — packs are organisational only, and she can revisit on the pack page anytime.",
        dwell: 3800 },

      // ---- Publish ----
      { action: 'click', target: '.screen[data-screen="register-element"].active [data-demo="review.publish"]', dwell: 900 },
      { action: 'expect', target: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-elements"].active [data-demo="catalogue.new-element-cta"]',
        label: 'Step 9 of 9 — Done. It\'s live.',
        rationale: "Concrete cube test v1.0 is in the catalogue. Anyone setting up a new agreement can pick it from today. No service request was filed, no developer was paged, no infrastructure was touched. The whole loop — from Sarah deciding the form exists to contractors being able to submit one — happened on a single screen.",
        dwell: 5000 }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(registerElement);
  } else {
    console.warn('demos/register-element.js loaded before runtime.js — flow not registered');
  }

})(window);
