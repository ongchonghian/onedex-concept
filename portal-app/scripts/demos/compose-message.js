/* ============================================================
   DEMOS — flow #5: Compose Message (schema-driven)
   Per ADR 0034 + 0043 sub-decision 6/8.

   Story: Marcus's Bill-of-Lading Agreement with Maersk is Active.
   A new shipment just left port — he sends the Bill of Lading
   through the portal. The Agreement was created against a
   workspace-published Element version, so the Composer renders
   from elementSchema (not a static fixture), and Submit runs
   both AJV (schema-level) and govaluate (cross-field rule) gates
   per CONTEXT.md three-layer governance.

   Why the schema-driven path: the legacy scenario Composer
   (push-high-stakes etc.) is fixture-driven and skips both gates.
   By seeding a published BoL Element version into workspace.dataElements
   and pointing the Agreement's elementSnapshot at it, the existing
   "click Compose on the detail page" affordance auto-routes through
   openComposerFromDetail → openComposerSchemaDriven, exercising both
   AJV and govaluate against operator-typed values.

   Per ADR 0037, this flow targets stable demo anchors.

   ADRs demonstrated: 0024 (agreement-anchored composer),
   0021 (message lifecycle), 0043 (schema-driven composer),
   0047 (AJV L1 schema validation)
   ============================================================ */

(function (window) {
  'use strict';

  const BOL_ELEMENT_ID = 'demo-bill-of-lading';
  const BOL_ELEMENT_VERSION = 'v1.0';
  const BOL_ELEMENT_REF = BOL_ELEMENT_ID + '@' + BOL_ELEMENT_VERSION;
  const DEMO_AGREEMENT_ID = 'AGR-DEMO-BOL-MAERSK';

  /* Minimal BoL elementSchema — JSON Schema 2020-12 shape that
     interop-clean publish produces. Required fields exercise AJV's
     `required` keyword; `format: date` exercises a registered format. */
  const BOL_ELEMENT_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Bill of Lading',
    required: ['blNumber', 'shipper', 'consignee', 'shipDate'],
    properties: {
      blNumber:  { type: 'string', title: 'B/L number',         minLength: 6 },
      shipper:   { type: 'string', title: 'Shipper' },
      consignee: { type: 'string', title: 'Consignee' },
      shipDate:  { type: 'string', title: 'Shipped on', format: 'date' },
      weightKg:  { type: 'number', title: 'Gross weight (kg)',  minimum: 0 }
    },
    additionalProperties: false
  };

  /* Single cross-field rule — exercises govaluate via regEvalExpression.
     `shipper !== consignee` is a real BoL invariant: a party can't ship
     to itself on a real Bill of Lading. */
  const BOL_RULES = [
    {
      name: 'shipper-not-consignee',
      expression: 'shipper !== consignee',
      on_failure: 'Shipper and Consignee must be different parties on a Bill of Lading.'
    }
  ];

  function seedSchemaDrivenBol(workspace) {
    if (!workspace) return;
    const userId = (workspace.meta && workspace.meta.activeUserId) || 'marcus';

    workspace.dataElements = workspace.dataElements || {};
    workspace.dataElements[BOL_ELEMENT_REF] = {
      id: BOL_ELEMENT_ID,
      version: BOL_ELEMENT_VERSION,
      name: 'Bill of Lading',
      dexId: 'tx',
      publishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      publishedBy: 'sarah',
      elementSchema: BOL_ELEMENT_SCHEMA,
      uiSchema: {
        blNumber:  { 'ui:placeholder': 'BL-2026-…' },
        shipDate:  { 'ui:widget': 'date' },
        weightKg:  { 'ui:placeholder': 'e.g. 24500' }
      },
      uiRules: {},
      authoringMetadata: { sourceOnramp: 'plain-english' },
      composeComplexity: 'high-stakes',
      rules: BOL_RULES,
      pack: null,
      meta: {
        type: 'DOCUMENT',
        changeType: 'INITIAL',
        changeDescription: 'Initial publish — demo BoL'
      },
      auditTrail: [
        { kind: 'element-version-published', at: new Date().toISOString(), by: 'sarah' }
      ]
    };

    /* Mint an Active Agreement that points at the published version via
       elementSnapshot.source='published' — this is the trigger that makes
       openComposerFromDetail route to the schema-driven path. */
    workspace.agreements = workspace.agreements || {};
    workspace.agreements[DEMO_AGREEMENT_ID] = {
      agreementId: DEMO_AGREEMENT_ID,
      sourceDraftId: null,
      dexId: 'tx',
      state: 'active',
      type: 'DIRECT',
      direction: 'send',
      operatorOrgId: 'cosco',
      counterpartyOrgId: 'maersk',
      counterpartyOrgName: 'Maersk Logistics',
      title: 'Bill of Lading with Maersk Logistics',
      dataElementSummary: { name: 'Bill of Lading', detail: BOL_ELEMENT_VERSION },
      elementSnapshot: {
        source:  'published',
        id:      BOL_ELEMENT_ID,
        version: BOL_ELEMENT_VERSION
      },
      terms: {
        effectiveFrom: '18 May 2026',
        durationMonths: 12,
        residency: 'standard'
      },
      activity: [
        { kind: 'agreement-created', actorUserId: userId, ts: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    /* Land the operator on this Agreement so goto('detail') shows it and
       the compose button routes via the schema-driven path. */
    if (typeof window.setSelectedAgreementId === 'function') {
      window.setSelectedAgreementId(DEMO_AGREEMENT_ID);
    }
  }

  const composeMessage = {
    id: 'compose-message',
    title: 'Compose Message',
    description: "Marcus's Bill-of-Lading Agreement with Maersk is Active. The Agreement points at a published Element version, so the Composer renders from elementSchema and Submit runs the AJV + govaluate gates.",
    adrs: ['0024', '0021', '0043', '0047'],
    durationSec: 75,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      seedSchemaDrivenBol(workspace);
    },

    steps: [
      // ---- Agreement detail page ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-compose-btn' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Step 1 of 6 — An Active Agreement, ready to use',
        rationale: "This Agreement with Maersk is Active. It was created against a published Bill of Lading Element — the schema, UI hints and validation rules all live in the workspace, not in fixture code.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-compose-btn',
        label: 'Step 2 of 6 — Send a Message under it',
        rationale: "One button opens the composer. Because the Agreement points at a published Element version, the composer will render its form straight from elementSchema — no fixture HTML.",
        dwell: 4200 },

      { action: 'click', target: '#detail-compose-btn', dwell: 800, after: 600 },

      // ---- Schema-driven Composer ----
      { action: 'expect', target: '.screen[data-screen="compose"].active #compose-form.sw-root [data-field-path="blNumber"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-form',
        label: 'Step 3 of 6 — Form rendered from the schema',
        rationale: "Every field, type and required-marker comes from the published elementSchema. The walker pairs it with the co-versioned uiSchema for placeholders. Marcus sees exactly what Sarah authored — no drift.",
        dwell: 4800 },

      // Fill the form by data-field-path. These selectors are stable across
      // schema-walker output because each input carries data-field-path="<key>".
      { action: 'type',   target: '#compose-form [data-field-path="blNumber"]',  text: 'BL-2026-118504' },
      { action: 'type',   target: '#compose-form [data-field-path="shipper"]',   text: 'Cosco Shipping' },
      { action: 'type',   target: '#compose-form [data-field-path="consignee"]', text: 'Maersk Logistics' },
      { action: 'type',   target: '#compose-form [data-field-path="shipDate"]',  text: '2026-06-01' },
      { action: 'type',   target: '#compose-form [data-field-path="weightKg"]',  text: '24500' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-submit',
        label: 'Step 4 of 6 — Submit runs two gates',
        rationale: "Click Submit and the portal runs AJV against elementSchema first — required fields, types, formats. If that clears, it evaluates the published rules with govaluate. Both gates must pass before the Message goes on the wire.",
        dwell: 5200 },

      { action: 'click', target: '.screen[data-screen="compose"].active #compose-submit', dwell: 1200, after: 1400 },

      // ---- Success ----
      { action: 'expect', target: '.screen[data-screen="compose-success"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose-success"].active [data-demo="compose-success.subline"]',
        label: 'Step 5 of 6 — Both gates cleared',
        rationale: "AJV approved the shape, the shipper-not-consignee rule held, and the payload is persisted under this Agreement. If either gate had failed, Submit would have blocked with the operator-readable reason instead.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose-success"].active [data-demo="compose-success.subline"]',
        label: 'Step 6 of 6 — On its way to Maersk',
        rationale: "Within seconds, Maersk's portal acknowledges receipt. If anything fails downstream, Marcus gets a notification with a clear retry path — he doesn't have to babysit the transmission.",
        dwell: 4400 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(composeMessage);
  } else {
    console.warn('demos/compose-message.js loaded before runtime.js — flow not registered');
  }

})(window);
