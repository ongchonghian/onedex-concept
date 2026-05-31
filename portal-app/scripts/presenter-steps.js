// portal-app/scripts/presenter-steps.js
//
// Declarative camera stops for the Prezi presenter view.
// Each step is consumed by presenter.js, wrapped in <div class="step" data-x ... >,
// and handed to Impress.js for animation.
//
// data-scale convention (Impress.js): higher = content appears bigger (closer camera).
// Steps tagged readability:'narration' MUST have scale >= 1.5 (readable at back of room
// at ~5m projection distance — see spec section 5).
//
// IDs sectionId/notesKey reference: portal-app/index.html section IDs and
// portal-rewrite-keynotes.md `## ...` headings respectively.

(function (global) {
  global.PRESENTER_STEPS = [
    { step:  1, sectionId: 'ov-stakes',    x:     0, y:     0, scale: 0.6, rotate:  0, readability: 'context',   narrative: 'Opener — 60 sec framing',                       notesKey: 'Opener' },
    { step:  2, sectionId: 'ov-stakes',    x:     0, y:  -300, scale: 1.8, rotate:  0, readability: 'narration', narrative: 'Section 00 — headline + lede',                  notesKey: 'Section 00' },
    { step:  3, sectionId: 'ov-stakes',    x:  -280, y:    80, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Customer-side 5 cards (wide)',                         notesKey: 'Section 00' },
    { step:  4, sectionId: 'ov-stakes',    x:   280, y:    80, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Internal-side 5 cards (wide)',                         notesKey: 'Section 00' },
    { step:  5, sectionId: 'ov-stakes',    x:     0, y:   380, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Numbers strip + close 00',                      notesKey: 'Section 00' },
    { step:  6, sectionId: 'ov-mental-01', x: -1800, y:  -400, scale: 1.5, rotate: -3, readability: 'narration', narrative: 'Section 01 — consent funnel',                   notesKey: 'Section 01' },
    { step:  7, sectionId: 'ov-mental-02', x: -1800, y:   200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 02 — compose shift',                    notesKey: 'Section 02' },
    { step:  8, sectionId: 'ov-ba-03',     x: -1800, y:   800, scale: 1.5, rotate:  3, readability: 'narration', narrative: 'Section 03 — 7→5 steps',                        notesKey: 'Section 03' },
    { step:  9, sectionId: 'ov-ba-04',     x: -1800, y:  1400, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 04 — admin 9→5',                        notesKey: 'Section 04' },
    { step: 10, sectionId: 'ov-concept',   x:     0, y: -1200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 05 — Work · Exchange · Directory',     notesKey: 'Section 05' },
    { step: 11, sectionId: 'ov-decisions', x:  1800, y:  -400, scale: 1.6, rotate:  0, readability: 'narration', narrative: 'Section 06 — constellation overview',           notesKey: 'Section 06' },
    { step: 12, sectionId: 'ov-roadmap',   x:  1600, y:   800, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 07 — v1 vs deferred',                   notesKey: 'Section 07' },
    { step: 13, sectionId: 'ov-migration', x:   800, y:  1200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 08 — soft landing',                     notesKey: 'Section 08' },
    { step: 14, sectionId: 'ov-new-orgs',  x:   200, y:  1400, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 09 — pre-staged drafts',                notesKey: 'Section 09' },
    { step: 15, sectionId: 'ov-asks',      x:     0, y:  1700, scale: 1.0, rotate:  0, readability: 'context',   narrative: 'Section 10 — open frame',                       notesKey: 'Section 10' },
    { step: 16, sectionId: 'ov-asks',      x:  -220, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask A — data-owner rule',                       notesKey: 'Section 10' },
    { step: 17, sectionId: 'ov-asks',      x:     0, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask B — revoke and recreate',                   notesKey: 'Section 10' },
    { step: 18, sectionId: 'ov-asks',      x:   220, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask C — user-test greenlight',                  notesKey: 'Section 10' },
    { step: 19, sectionId: 'ov-asks',      x:     0, y:  1820, scale: 1.4, rotate:  0, readability: 'context',   narrative: 'Closer + Q&A landing',                          notesKey: 'Section 10' }
  ];
}(typeof window !== 'undefined' ? window : globalThis));
