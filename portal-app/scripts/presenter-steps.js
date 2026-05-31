// portal-app/scripts/presenter-steps.js
//
// Declarative camera stops for the Prezi presenter view.
// Each step is consumed by presenter.js, wrapped in <div class="step" data-x ... >,
// and handed to Impress.js for animation.
//
// data-scale convention (Impress.js v2.0.0): the CAMERA applies scale(1/data-scale).
//   - data-scale < 1  → camera magnifies → content appears LARGER (zoomed in, readable)
//   - data-scale = 1  → content appears at natural size
//   - data-scale > 1  → camera retreats → content appears SMALLER (wide context)
//
// For our use case (back-of-room readability at ~5m projection): use data-scale ≤ 0.7
// on every narrated step so the smallest narrated text projects at >= 18 effective px.
//
// Layout: linear horizontal canvas. Each section sits at (i × 3000, 0) with scale 0.7.
// 3000px horizontal spacing × 0.7 scale gives a 1100-px-wide step a footprint of
// 770px, leaving 2230px clearance between adjacent sections — no overlap.
//
// Section 00 is the tallest section in the landing page; the camera focuses
// on its top half (headline + customer grid). The internal grid + stats strip
// extend below the camera viewport. The speaker narrates those from notes —
// per the spec's "wide shots only" constraint (no card-by-card zooms).
//
// IDs sectionId/notesKey reference: portal-app/index.html section IDs and
// portal-app/portal-rewrite-keynotes.md `## ...` headings respectively.

(function (global) {
  global.PRESENTER_STEPS = [
    { step:  1, sectionId: 'ov-stakes',    x:      0, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 00 — Ten frictions',                       notesKey: 'Section 00' },
    { step:  2, sectionId: 'ov-mental-01', x:   3000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 01 — Consent funnel',                     notesKey: 'Section 01' },
    { step:  3, sectionId: 'ov-mental-02', x:   6000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 02 — Compose shift',                      notesKey: 'Section 02' },
    { step:  4, sectionId: 'ov-ba-03',     x:   9000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 03 — 7→5 operator steps',                 notesKey: 'Section 03' },
    { step:  5, sectionId: 'ov-ba-04',     x:  12000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 04 — 9→5 admin steps',                    notesKey: 'Section 04' },
    { step:  6, sectionId: 'ov-concept',   x:  15000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 05 — Work · Exchange · Directory',       notesKey: 'Section 05' },
    { step:  7, sectionId: 'ov-decisions', x:  18000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 06 — Ten decisions',                      notesKey: 'Section 06' },
    { step:  8, sectionId: 'ov-roadmap',   x:  21000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 07 — v1 vs deferred',                     notesKey: 'Section 07' },
    { step:  9, sectionId: 'ov-migration', x:  24000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 08 — Soft landing',                       notesKey: 'Section 08' },
    { step: 10, sectionId: 'ov-new-orgs',  x:  27000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 09 — Pre-staged Drafts',                  notesKey: 'Section 09' },
    { step: 11, sectionId: 'ov-asks',      x:  30000, y: 0, scale: 0.7, rotate: 0, readability: 'narration', narrative: 'Section 10 — The three asks',                     notesKey: 'Section 10' }
  ];
}(typeof window !== 'undefined' ? window : globalThis));
