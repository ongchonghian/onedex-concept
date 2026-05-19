/* ============================================================
   WORKSPACE FIXTURES — seed data the workspace bootstrap loads
   once at first boot.
   ============================================================
   Phase 7 of the workspace migration moved these mutable seed
   datasets out of state.js into this dedicated fixture file.
   state.js retains only stable reference/config data (ORGS,
   USERS, USER_ORG_AFFILIATIONS, ORG_DEX_MEMBERSHIPS, role +
   capability tables, wizard step config, pitstop topology).

   This file's contents are pure input data — never read at
   runtime after the workspace snapshot exists. The bootstrap
   path is:

       workspace-bootstrap.js → buildWorkspaceFromFixtures()
                              → seedReferenceCollections(workspace)
                              → mergeSceneIntoWorkspace(workspace, scene)
                                  → seedFor(scene, screenId)  ← reads SCENE_SEEDS

   Editing any of the four blocks below changes what a fresh
   browser session sees on first load; existing localStorage
   snapshots are unaffected until the schema version bumps.
   ============================================================ */

/* Cross-DEX platform-admin inbox — the work that lives at the platform tier:
   org onboarding KYC, Data Element promotions (Super SGTradex Admin only),
   network setup, cross-org user provisioning. Mirrors the items the admin-ui
   admin branch surfaces (Navigation/index.js:135-140 + maker-checker matrix). */
const PLATFORM_INBOX = {
  count: 9, mineCount: 4, teamCount: 5,
  role: 'SGTradex Admin', // promote to 'Super SGTradex Admin' to unlock DE.Create work
  mine: [
    { title: 'Pacific Container Lines — onboarding KYC review', meta: 'Org onboarding · KYC submitted 3d ago · awaiting your decision', btn: 'Review', cta: 'review-org', intent: 'decide', sourceType: 'governance' },
    { title: 'Acme Construction → SGBuildex · network admission', meta: 'Cross-DEX admission request · 2 of 3 platform admins approved', btn: 'Approve', cta: 'approve-network', intent: 'decide', sourceType: 'governance' },
    { title: 'Promote Bill of Lading v2.1 → Active (SGTradex)', meta: 'Data element governance · drafted by Kagura · review window closes today', btn: 'Open', cta: 'open-de-promotion', intent: 'decide', sourceType: 'governance', requires: 'Super SGTradex Admin' },
    { title: 'Issue SGHealthdex network certificate renewal', meta: 'Network · current cert expires in 21d · renewal SOP applies', btn: 'Renew', cta: 'renew-network', intent: 'confirm', sourceType: 'governance' }
  ],
  team: [
    { title: 'Onboard 4 SGBuildex contractor orgs — batch KYC', meta: 'Org onboarding · queued by automation · 2 admins eligible', btn: 'Claim', intent: 'decide', sourceType: 'governance' },
    { title: 'Lesley approved Greater Bay Logistics org admin role', meta: 'Completed 12 min ago · disappears from inbox in 3 min', completion: true },
    { title: 'Maersk requested SP appointment authority on SGTradex', meta: 'Service-Provider authorisation · pending platform sign-off', btn: 'Claim', intent: 'decide', sourceType: 'governance' }
  ]
};
/* ---------- Per-DEX inbox data ----------
   Each DEX records the role the demo operator (Marcus, Cosco-org) holds there.
   Marcus is a participant across all three DEXes but at different per-org role tiers,
   demonstrating how the UI gates by capability. */
const INBOX_BY_DEX = {
  tx: {
    name: 'SGTradex',
    count: 12, mineCount: 4, teamCount: 8,
    chip: 'tx',
    userType: 'participant',
    role: 'Admin User',            // can create + accept Agreements, no user mgmt
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Maersk wants to receive Bills of Lading from you', meta: 'Invited 2h ago · waiting on you to accept or decline', btn: 'Review', cta: 'review', intent: 'decide', sourceType: 'agreement', dir: 'in' },
      { title: 'Your ETA request to PSA — awaiting their decision', meta: 'Sent 4h ago · 30-day window · pending PSA accept · auto-reminder at day 21', btn: 'Open', cta: 'open', intent: 'confirm', sourceType: 'message', dir: 'out' },
      { title: 'Extend Agreement with Cosco before 30 Sep', meta: 'Renewal · expires in 9 days · auto-extend disabled', btn: 'Extend 12mo', cta: 'extend', intent: 'confirm', sourceType: 'agreement', dueAt: '2026-05-28T00:00:00+08:00' }
    ],
    team: [
      { title: 'PSA bunker delivery — 3 contributor enrolments pending', meta: 'Approval · oldest 4h ago · 3 admins eligible', btn: 'Claim', intent: 'decide', sourceType: 'agreement' },
      { title: 'Layla approved CrimsonLogic appointment for ABC Logistics', meta: 'Completed 2 min ago · disappears from inbox in 3 min', completion: true },
      { title: 'Review onboarding KYC for Pacific Container Lines', meta: 'Approval · 1d ago · 3 admins eligible', btn: 'Claim', intent: 'decide', sourceType: 'governance' }
    ]
  },
  bx: {
    name: 'SGBuildex',
    count: 4, mineCount: 1, teamCount: 3,
    chip: 'bx',
    userType: 'participant',
    role: 'Operation User',        // Pitstop runtime/data ops only — cannot create Agreements
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Concrete pour QC sign-off from JTC due tomorrow', meta: 'Approval · contractor-side · expires in 18h', btn: 'Open', cta: 'open', intent: 'decide', sourceType: 'agreement', dueAt: '2026-05-20T00:00:00+08:00' }
    ],
    team: [
      { title: 'Builder safety incident reports — 2 awaiting upload', meta: 'Compliance · oldest 6h ago', btn: 'Claim', intent: 'decide', sourceType: 'agreement' },
      { title: 'Layla approved subcontractor onboarding', meta: 'Completed 4 min ago', completion: true }   // Issue 0002 — reattributed from Wei Lin (who is canonically platform-tier per Issue 0004)
    ]
  },
  hx: {
    name: 'SGHealthdex',
    count: 3, mineCount: 1, teamCount: 2,
    chip: 'hx',
    userType: 'participant',
    role: 'Super Admin',           // org-tier governance: user mgmt + use cases + relationships
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Annual compliance certificate expires in 14 days', meta: 'Renewal · residency-strict · no grace period', btn: 'Renew', cta: 'renew-strict', intent: 'confirm', sourceType: 'agreement', dueAt: '2026-06-02T00:00:00+08:00' }
    ],
    team: [
      { title: 'Patient registry data classification review', meta: 'Governance · residency-strict · 2 Super Admins eligible', btn: 'Claim', intent: 'decide', sourceType: 'governance' },
      { title: 'Lab partnership Agreement awaiting compliance sign-off', meta: 'Compliance review · with legal · 24h SLA', btn: 'Open', intent: 'decide', sourceType: 'agreement' }
    ]
  }
};
/* ---------- State-switcher scenarios (PRD §Testing Decisions) ----------
   The Composer / wizard / Messages list expose a state-switcher that cycles
   through these six scenarios to demonstrate the multi-Pitstop design
   without firing real actions. */
let activeMpScenario = 'C'; // default — multi-Pitstop with established scope

const MP_SCENARIOS = {
  'A': {
    label: 'A · Single-Pitstop op',
    detail: 'Cosco\'s construction subsidiary on SGSGBuildex, single Pitstop. Submits Manpower utilization to BCA per the orchestrator-seed flow (person_id_no, work_pass_type, trade, employer, attendance — 11 required fields). Chip never appears; wizard stays at 4 steps; UX identical to today.',
    operatorOrg: 'cosco',
    operatorDex: 'bx',
    element: 'manpower-utilization',
    counterparty: 'bca',
    counterpartyOrgId: 'bca',
    expectedSteps: 4,
    chipVisibility: 'hidden',
    expectedPersona: 'participant',
    display: {
      counterpartyName: 'BCA · Building & Construction Authority',
      counterpartyShort: 'BCA',
      counterpartyInitials: 'BC',
      elementName: 'Manpower utilization',
      elementVersion: 'v3.2',
      dexChip: 'bx',
      dexLabel: 'SGBuildex',
      agrId: 'AGR-2026-05103',
      idemKey: 'idem_b21f9a8c',
      complexity: 'high-stakes',
      title: 'Manpower utilization → BCA',
      submitLabel: 'Submit · send to BCA',
      snapshotLine: 'Snapshot v3.2 · captured 18 Mar 2026 at Agreement creation · 11 required fields per BCA submission schema · SGSGBuildex · single Pitstop',
      actingAs: null
    }
  },
  'B': {
    label: 'B · First-use capture',
    detail: 'Multi-Pitstop Cosco creates its first Bunker Requisition Form Agreement (with TFG Marine, a real SGTradex bunker supplier). Cosco hasn\'t routed bunker requisitions before; the wizard\'s inline scope-set step asks which of Cosco\'s 3 Pitstops should produce this element going forward. Multi-select checkboxes — Cosco could pick SG-Logistics for ops, or split across SG-Logistics + SG-Finance for failover.',
    operatorOrg: 'cosco',
    operatorDex: 'tx',
    element: 'bunker-requisition-form',
    counterparty: 'tfg-marine',
    counterpartyOrgId: 'tfg-marine',
    expectedSteps: 5,
    chipVisibility: 'first-time',
    expectedPersona: 'participant',
    display: {
      counterpartyName: 'TFG Marine Pte Ltd',
      counterpartyShort: 'TFG Marine',
      counterpartyInitials: 'TF',
      elementName: 'Bunker Requisition Form',
      elementVersion: 'v1.0',
      dexChip: 'tx',
      dexLabel: 'SGTradex',
      agrId: 'AGR-2026-05210',
      idemKey: 'idem_v3f7d011',
      complexity: 'simple',
      title: 'Bunker Requisition Form → TFG Marine',
      submitLabel: 'Submit · send to TFG Marine',
      snapshotLine: 'Snapshot v1.0 · captured today at Agreement creation · scope-set captured inline · 9 fields including vessel name, ETA at oil terminal, fuel grade, requested quantity',
      actingAs: null
    }
  },
  'C': {
    label: 'C · Repeat use',
    detail: 'Multi-Pitstop Cosco creates an Agreement for an established-scope element — Mass Flow Meter Receipt to PSA. Cosco\'s SG-Logistics Pitstop has handled this element under prior Agreements (it\'s the post-delivery measurement document for bunker fuel, MPA-regulated). The resolver auto-fills the chip with no further interaction; wizard 4 steps.',
    operatorOrg: 'cosco',
    operatorDex: 'tx',
    element: 'mass-flow-meter-receipt',
    counterparty: 'psa',
    counterpartyOrgId: 'psa',
    expectedSteps: 4,
    chipVisibility: 'auto-filled',
    expectedPersona: 'participant',
    display: {
      counterpartyName: 'PSA International',
      counterpartyShort: 'PSA',
      counterpartyInitials: 'PS',
      elementName: 'Mass Flow Meter Receipt',
      elementVersion: 'v2.4',
      dexChip: 'tx',
      dexLabel: 'SGTradex',
      agrId: 'AGR-2026-04829',
      idemKey: 'idem_a7f3c91d',
      complexity: 'high-stakes',
      title: 'Mass Flow Meter Receipt → PSA International',
      submitLabel: 'Submit · send to PSA',
      snapshotLine: 'Snapshot v2.4 · captured 21 Mar 2026 at Agreement creation · MPA-compliant bunker measurement document · routes via SG-Logistics',
      actingAs: null
    }
  },
  'D': {
    label: 'D · SP · multi-Pitstop',
    detail: 'CrimsonLogic (real Singapore trade-documents SP) acts on Maersk\'s behalf to submit Container Booking data to Cosco. Maersk delegates the actual transmission so its own carriage-tech team stays focused on customs. CrimsonLogic has two Pitstops (CL-Shipping for vessel-side, CL-Customs for customs-side); Pat picks per dispatch. Both chips visible: Acting as Maersk (identity) + Send from {CL-Shipping or CL-Customs} (endpoint).',
    operatorOrg: 'crimsonlogic',
    operatorDex: 'tx',
    element: 'container-booking',
    actingAsOrg: 'maersk',
    counterparty: 'cosco',
    counterpartyOrgId: 'cosco',
    expectedSteps: 4,
    chipVisibility: 'visible-with-choice',
    expectedPersona: 'sp-operator',
    display: {
      counterpartyName: 'Cosco Shipping',
      counterpartyShort: 'Cosco',
      counterpartyInitials: 'Cs',
      elementName: 'Container Booking',
      elementVersion: 'v1.8',
      dexChip: 'tx',
      dexLabel: 'SGTradex',
      agrId: 'AGR-2026-04711',
      idemKey: 'idem_cl_8b2e44',
      complexity: 'high-stakes',
      title: 'Container Booking → Cosco Shipping',
      submitLabel: 'Submit · send to Cosco',
      snapshotLine: 'Snapshot v1.8 · captured 14 Feb 2026 at Agreement creation · SP-relationship · Maersk is data owner, CrimsonLogic transmits',
      actingAs: { ownerOrg: 'Maersk Logistics', ownerShort: 'Maersk' }
    }
  },
  'E': {
    label: 'E · Pitstop retired',
    detail: 'Cosco sends Vessel Voyage Schedule (real SGTradex element — vessel arrival window, port-call schedule) to Maersk. SG-Logistics-Old (retired 4 Mar 2026 after the SG-Logistics consolidation) handled vessel-scheduling traffic for ~18 months. Historical Messages still surface its name with a "retired" annotation; new compositions route via the active SG-Logistics Pitstop. Asymmetry rule preserved — Maersk only sees the active Pitstop\'s id on incoming Messages.',
    operatorOrg: 'cosco',
    operatorDex: 'tx',
    element: 'vessel-voyage-schedule',
    counterparty: 'maersk',
    counterpartyOrgId: 'maersk',
    showRetired: true,
    expectedSteps: 4,
    chipVisibility: 'auto-filled',
    expectedPersona: 'participant',
    display: {
      counterpartyName: 'Maersk Logistics',
      counterpartyShort: 'Maersk',
      counterpartyInitials: 'Mk',
      elementName: 'Vessel Voyage Schedule',
      elementVersion: 'v2.1',
      dexChip: 'tx',
      dexLabel: 'SGTradex',
      agrId: 'AGR-2025-09844',
      idemKey: 'idem_e4d18a02',
      complexity: 'high-stakes',
      title: 'Vessel Voyage Schedule → Maersk Logistics',
      submitLabel: 'Submit · send to Maersk',
      snapshotLine: 'Snapshot v2.1 · captured 11 Sep 2025 at Agreement creation · routing fell back from retired SG-Logistics-Old (4 Mar 2026) to active SG-Logistics · 7 voyage-leg fields per MPA schedule schema',
      actingAs: null
    }
  },
  'F': {
    label: 'F · Joint-state warning',
    detail: 'Cosco sends Statement of Facts (real SGTradex element — port-call event log signed by master & terminal) to Maersk. Maersk lost consume-scope on their side (their Singapore Pitstop\'s scope-set was edited out, perhaps during a Maersk-internal reorg). Composer form-open shows symmetric-language banner BEFORE payload-fill — copy names only the joint fact, never which Maersk Pitstop changed or when. Asymmetry rule preserved.',
    operatorOrg: 'cosco',
    operatorDex: 'tx',
    element: 'statement-of-facts',
    counterparty: 'maersk',
    counterpartyOrgId: 'maersk',
    counterpartyDegraded: true,
    expectedSteps: 4,
    chipVisibility: 'auto-filled',
    expectedPersona: 'participant',
    display: {
      counterpartyName: 'Maersk Logistics',
      counterpartyShort: 'Maersk',
      counterpartyInitials: 'Mk',
      elementName: 'Statement of Facts',
      elementVersion: 'v1.5',
      dexChip: 'tx',
      dexLabel: 'SGTradex',
      agrId: 'AGR-2026-05011',
      idemKey: 'idem_f93c2117',
      complexity: 'high-stakes',
      title: 'Statement of Facts → Maersk Logistics',
      submitLabel: 'Submit · send to Maersk',
      snapshotLine: 'Snapshot v1.5 · captured 02 Feb 2026 at Agreement creation · joint port-call event log · receiver scope currently empty',
      actingAs: null
    }
  }
};
/* ============================================================
   SCENE_SEEDS — per (affiliation, dex, scenario) screen fixtures
   ============================================================
   Per ADR 0029 + Issue 0010 (./docs/issues/0010-scene-seeds-key-migration.md).

   Each top-level key is a sceneId of the shape `<affiliationId>-<dexId>-<scenarioId>`
   where affiliationId is the `<userId>-<orgId>` composite that uniquely identifies
   the (user, org) tuple. Example: `marcus-cosco-tx-C`.

   Key components:
     - affiliationId = `<userId>-<orgId>`  (matches USER_ORG_AFFILIATIONS key shape)
     - dexId         = 'tx' | 'bx' | 'hx'
     - scenarioId    = 'A' | 'B' | 'C' | ... | 'F'  (per ADR 0028)

   The richer key shape resolves a class of name collisions that the prior
   `<userId>-<scenarioId>` shape couldn't represent — for instance, when a user
   has multiple affiliations under N:M (ADR 0029), or when a single user might
   demo the same scenario across multiple DEXes.

   Second-level key is a screen id (matching data-screen="…"). Values are the
   fixture object that screen's renderer consumes via renderScreenFromSeed().

   Alias values `{ alias: 'sceneKey/screenId' }` let one entry point at another
   entry — used so message-detail and messages[0] are the same record.

   LEGACY FALLBACK — DEPRECATED:
   The resolver (`seedFor` in access.js) falls back to the legacy
   `<userId>-<scenarioId>` shape during the migration window for any caller that
   still constructs the old shape. The fallback removes after the
   next 3 implementation PRs land — track via the deprecation deadline named
   in resolveSeedKey()'s comment block in access.js.
   ============================================================ */

const SCENE_SEEDS = {

  /* ----------------------------------------------------------
     alice-cosco-bx-C — Issue 0010 placeholder for Alice's BX scenes
     Alice is Cosco's BX Operation User. Per-DEX inbox/agreements/messages
     for SGBuildex come from INBOX_BY_DEX.bx fallback today; this entry exists
     so the resolver returns a non-null scope when the active scene asks for
     Alice. Detail screen seed deferred — Alice's scenes get full seeds when
     BX-specific demo content is authored (separate workstream).
     ---------------------------------------------------------- */
  'alice-cosco-bx-C': {
    /* Full seed — replaces the Issue 0010 placeholder.
       Alice operates Cosco Construction's SGBuildex Pitstop as an Operation User.
       The three data elements seeded here exercise SGBuildex's regulatory + contractor
       surface:
         · Subcontractor Onboarding v1.0  — Cosco ↔ Acme (cross-DEX counterparty)
         · BCA Compliance Filing v1.2     — Cosco ↔ BCA (statutory submission)
         · Manpower utilization v3.2      — Cosco ↔ BCA (real SGSGBuildex orchestrator element) */
    detail: {
      agrId:           'AGR-2026-05312',
      dex:             'bx',
      dexLabel:        'SGBuildex',
      title:           'Share Subcontractor Onboarding with Acme Construction',
      composerTooltip: 'Compose and send a new Subcontractor Onboarding payload to Acme under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Construction (SG) Pte Ltd',
        uen:      'UEN 200807456C',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'Acme Construction Pte Ltd',
        short:        'Acme',
        orgId:        'acme',
        uen:          'UEN 201111223J',
        roleLabel:    'Contractor',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Khufra (Acme)',
        primaryUserId:'boonkeng'                       // ADR 0031 — user-record-backed
      },
      element: {
        name:        'Subcontractor Onboarding',
        version:     'v1.0',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 02 May · 24 fields including safety certifications, BCA grade, prior accident record'
      },
      pack: {
        visible: true,
        name:    'Subcontractor enablement pack',
        count:   3
      },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '24 Apr · invited by Cosco',   done: true },
        { stateKey: 'active',  label: 'Active',  time: '28 Apr · Acme accepted',      current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '28 Apr 2027 · annual renewal',muted: true }
      ],
      terms: {
        effectiveFrom: '28 Apr 2026',
        extendedUntil: '28 Apr 2027 <span style="color:var(--g-50)">(annual)</span>',
        residency:     'Standard · cross-DEX OK with warning (Acme primary is SGBuildex)',
        autoRenew:     'On — managed by BCA contractor lifecycle'
      },
      nudge: {
        icon:    'shield-check',
        text:    'Acme is a cross-DEX counterparty (primary SGBuildex). Payload validation runs against BCA grade schema before dispatch — Operation Users cannot bypass.',
        ctaLabel:'Open validation log'
      },
      // Activity rows — Alice is operator (literal actor); Acme's boonkeng is cross-org
      // (actorUserId); BCA + Marcus historical (literal actor).
      activity: [
        { actor: 'Layla',              action: 'submitted Subcontractor Onboarding payload for May intake', time: 'Today · 11:30 SGT',         timeISO: '2026-05-17T11:30+08:00', dot: 'bx' },
        { actor: 'BCA Compliance Desk',action: 'acknowledged 142 submissions this week',                    time: 'Today · 09:00 SGT · automated', timeISO: '2026-05-17T09:00+08:00', dot: 'bx' },
        { actorUserId: 'boonkeng',     action: 'accepted the Agreement',                                     time: '28 Apr · 14:30 SGT',         timeISO: '2026-04-28T14:30+08:00', dot: 'green' },
        { actor: 'Marcus Ong',         action: 'created the Agreement and sent the invitation (BX seat since reassigned to Layla per Issue 0002)', time: '24 Apr · 11:00 SGT', timeISO: '2026-04-24T11:00+08:00', dot: 'muted' }
      ]
    },

    /* INBOX — Operation User on SGBuildex. Mine items are ops-actionable: payload
       validation, dispatch retries, scope sync. No Agreement-creation CTAs. */
    inbox: {
      name: 'SGBuildex · Cosco Construction',
      count: 5, mineCount: 2, teamCount: 3,
      chip: 'bx',
      role: 'Operation User',
      orgName: 'Cosco Construction',
      mine: [
        { title: 'Subcontractor Onboarding — Acme payload pending field-level validation', meta: 'Operations · 24 fields × 11 subcontractors · expires in 6h',        btn: 'Open',  cta: 'open', intent: 'decide', sourceType: 'agreement' },
        { title: 'Concrete pour QC sign-off from JTC due tomorrow',                         meta: 'Approval · contractor-side · expires in 18h',                       btn: 'Open',  cta: 'open', intent: 'decide', sourceType: 'agreement', dueAt: '2026-05-20T00:00:00+08:00' }
      ],
      team: [
        { title: 'Builder safety incident reports — 2 awaiting upload',                     meta: 'Compliance · oldest 6h ago',                                        btn: 'Claim', intent: 'decide', sourceType: 'agreement' },
        { title: 'Layla approved subcontractor onboarding',                                  meta: 'Completed 4 min ago',                                              completion: true },
        { title: 'Manpower utilization · May submission failed (retry available)',           meta: 'Operations · BCA receiver · 1 of 1 retries remaining',             btn: 'Claim', intent: 'fix', sourceType: 'message' }
      ]
    },

    /* MESSAGE-DETAIL aliases the first row in messages[] so /message detail
       deep-links cleanly without authoring a separate fixture.
       PACK-DETAIL aliases the entire agreements[] array so the pack-detail
       renderer can find the pack-parent + member rows in one place. */
    'message-detail': { alias: 'alice-cosco-bx-C/messages[0]' },
    'pack-detail':    { alias: 'alice-cosco-bx-C/agreements' },

    /* DASHBOARD deferred — INBOX_BY_DEX.bx fallback covers the placeholder shape. */
    dashboard: null,

    /* DRAFTS — Operation User cannot create Agreements (canCreateAgreement=false),
       so this list holds Message-payload drafts saved before submit. */
    drafts: [
      { id: 'MD-2026-0517-A', title: 'Subcontractor Onboarding — May intake (11 records)', icon: 'file-text', type: 'Direct', meta: 'last edited 30 min ago · 24 fields × 11 subcontractors · 8 of 11 validated', resumeKey: 'Subcontractor Onboarding — May intake' },
      { id: 'MD-2026-0516-B', title: 'BCA Compliance Filing — Q2 manpower roll-up',         icon: 'file-text', type: 'Direct', meta: 'last edited yesterday · awaiting JTC site inspector sign-off',           resumeKey: 'BCA Compliance Filing — Q2 manpower' }
    ],

    /* PARTICIPANTS — directory cards anchored to ORGS + primary contacts. */
    participants: [
      { initials: 'BC', name: 'BCA',                       orgId: 'bca',              meta: 'Regulator · Statutory Board · 14 team members · 2 active Agreements with you',                useCases: ['Manpower utilization', 'Compliance filing'],   status: { kind: 'active',  label: 'Active' },     joined: 'Joined 19 Mar 2026' },
      { initials: 'AC', name: 'Acme Construction Pte Ltd', orgId: 'acme',             meta: 'Contractor · UEN 201111223J · 5 team members · 1 active Agreement with you',                  useCases: ['Subcontractor onboarding'],                   status: { kind: 'active',  label: 'Active' },     joined: 'Joined 04 Nov 2024', primaryUserId: 'boonkeng' },
      { initials: 'JT', name: 'JTC Corporation',           orgId: 'jtc',              meta: 'Statutory board · Industrial land authority · 1 active Agreement with you',                  useCases: ['Site safety sign-off'],                       status: { kind: 'active',  label: 'Active' },     joined: 'Joined 18 May 2023', primaryUserId: 'kelvin' },
      { initials: 'PC', name: 'Pacific Contracting Pte Ltd', meta: 'Contractor · UEN 202312456H · KYC review pending',                                                                     useCases: ['Subcontractor onboarding (pending)'],         status: { kind: 'pending', label: 'Pending KYC' }, joined: 'Invited 9 days ago' }
    ],

    /* AGREEMENTS — three BX data elements rendered across flat rows + one pack. */
    agreements: [
      // Headline — same record as detail seed above.
      { kind: 'flat', id: 'AGR-2026-05312', cp: { name: 'Acme Construction',   initials: 'AC', role: 'Contractor',         dex: 'SGBuildex' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, type: 'Direct',           status: { kind: 'active', label: 'Active' },                  until: '28 Apr 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      // Pack — Subcontractor enablement pack across 3 BX consumers.
      { kind: 'pack-parent', id: 'PACK-2026-0428-BX', name: 'Subcontractor enablement pack', packTag: 'PACK', childCount: 3, cpCount: 3, element: { name: 'Subcontractor enablement pack', summary: '3 elements split' }, type: 'Direct ×3', status: { kind: 'active', label: 'Active (3 of 3)' }, until: '28 Apr 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                          cp: { name: 'Acme Construction',  initials: 'AC', role: 'Contractor',          dex: 'SGBuildex' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'BCA',                initials: 'BC', role: 'Regulator',           dex: 'SGBuildex' }, element: { name: 'Manpower utilization',     version: 'v3.2' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'JTC Corporation',    initials: 'JT', role: 'Statutory board',     dex: 'SGBuildex' }, element: { name: 'Site safety incident report', version: 'v1.1' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-05103', cp: { name: 'BCA',                 initials: 'BC', role: 'Regulator',          dex: 'SGBuildex' }, element: { name: 'BCA Compliance Filing',     version: 'v1.2' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },               until: 'Renews annually', untilNote: 'BCA regulatory', actions: ['extend'] },
      { kind: 'flat', id: 'AGR-2026-04211', cp: { name: 'BCA',                 initials: 'BC', role: 'Regulator',          dex: 'SGBuildex' }, element: { name: 'Manpower utilization',      version: 'v3.2' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },               until: 'Renews annually', untilNote: 'BCA regulatory', actions: ['extend'] },
      { kind: 'flat', id: 'AGR-2025-11008', cp: { name: 'JTC Corporation',     initials: 'JT', role: 'Statutory board',    dex: 'SGBuildex' }, element: { name: 'Site safety incident report', version: 'v1.1' }, type: 'Direct',         status: { kind: 'active',  label: 'Active' },               until: '18 May 2027', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-04999', cp: { name: 'Pacific Contracting', initials: 'PC', role: 'Contractor',         dex: 'SGBuildex' }, element: { name: 'Subcontractor Onboarding',  version: 'v1.0' }, type: 'Direct',           status: { kind: 'pending', label: 'Pending KYC' },           until: 'Awaiting KYC clearance', actions: ['withdraw'] }
    ],

    /* MESSAGES — three BX data elements across sent/received/failed rows. */
    messages: [
      // New arrival — Subcontractor Onboarding payload just dispatched to Acme.
      { id: 'MSG-BX-1247', dir: 'sent',     newArrival: true, cp: { name: 'Acme Construction', initials: 'AC' }, pitstop: { name: 'SGBuildex-Main' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, agreement: 'AGR-2026-05312', status: { kind: 'active',  label: 'Delivered' },     time: 'just now',     actions: ['view'] },
      // BCA Compliance Filing — acknowledged this morning.
      { id: 'MSG-BX-1238', dir: 'sent',                       cp: { name: 'BCA',               initials: 'BC' }, pitstop: { name: 'SGBuildex-Main' }, element: { name: 'BCA Compliance Filing',    version: 'v1.2' }, agreement: 'AGR-2026-05103', status: { kind: 'active',  label: 'Acknowledged' },  time: '2h ago',       actions: ['view'] },
      // Manpower utilization — failed · mine (schema validation error on May submission).
      { id: 'MSG-BX-1240', dir: 'sent', failed: true, cp: { name: 'BCA', initials: 'BC' }, pitstop: { name: 'SGBuildex-Main' }, element: { name: 'Manpower utilization', version: 'v3.2' }, agreement: 'AGR-2026-04211', status: { kind: 'failed', label: 'Failed', owner: 'mine', errorLine: 'Schema validation failed · field <code>foreignWorkerCount</code> exceeds quota of 350', errorIcon: 'x-circle' }, time: '12 min ago', actions: ['retry'] },
      // Received — JTC site safety acknowledgment back to Cosco.
      { id: 'MSG-BX-1235', dir: 'received',                   cp: { name: 'JTC Corporation',   initials: 'JT' }, element: { name: 'Site safety incident report', version: 'v1.1 · ack' }, agreement: 'AGR-2025-11008', status: { kind: 'active', label: 'Acknowledged' }, time: '4h ago', actions: ['view'] },
      // PULL — Acme requested back-fill of prior onboarding records.
      { id: 'MSG-BX-1241', dir: 'received',                   cp: { name: 'Acme Construction', initials: 'AC' }, element: { name: 'Subcontractor Onboarding · back-fill', version: 'v1.0 · request' }, agreement: 'AGR-2026-05312', status: { kind: 'pending', label: 'In flight' }, time: '6 min ago', actions: ['inspect-pull'] },
      // Queued — Pacific Contracting pending KYC, payload staged.
      { id: 'MSG-BX-1239', dir: 'sent', queued: true, cp: { name: 'Pacific Contracting', initials: 'PC' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, agreement: 'AGR-2026-04999', status: { kind: 'pending', label: 'In flight' }, time: '1h ago', actions: ['view'] }
    ]
  },

  /* ----------------------------------------------------------
     david-cosco-hx-C — Issue 0010 placeholder for David's HX scenes
     David is Cosco's HX Super Admin. Same pattern as Alice's placeholder —
     INBOX_BY_DEX.hx is the rendering source today; this entry preserves the
     resolver's null-safety until HX-specific demo content is authored.
     ---------------------------------------------------------- */
  'david-cosco-hx-C': {
    /* Full seed — replaces the Issue 0010 placeholder.
       David is Cosco Health Services' SGHealthdex Super Admin. All three data
       elements are residency-strict (Singapore-only, no grace period):
         · Patient Referral Record v3.0       — Cosco ↔ SingHealth
         · Prescription Dispense Record v2.1  — Cosco ↔ MOH-ESC
         · Diabetic Foot Screening v3.0       — Cosco ↔ Polyclinic Bedok (real element
                                                  per healthdex-ui-proposals/src/data/sharedDataFields.js
                                                  DATA_ELEMENTS array — anchored in dex-monorepo) */
    detail: {
      agrId:           'AGR-2026-05418',
      dex:             'hx',
      dexLabel:        'SGHealthdex',
      title:           'Share Patient Referral Record with SingHealth',
      composerTooltip: 'Compose and send a new Patient Referral Record to SingHealth under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Health Services (SG) Pte Ltd',
        uen:      'UEN 201902456H',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'SingHealth',
        short:        'SingHealth',
        orgId:        'singhealth',
        uen:          'UEN 200002698R',
        roleLabel:    'Healthcare cluster',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Dr Estes (SingHealth)',
        primaryUserId:'priya'                          // ADR 0031 — user-record-backed
      },
      element: {
        name:        'Patient Referral Record',
        version:     'v3.0',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 12 Feb · 31 fields including NRIC hash, referral reason, attending clinician'
      },
      pack: {
        visible: true,
        name:    'Clinical referral pack',
        count:   3
      },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '08 Feb · invited by you',       done: true },
        { stateKey: 'active',  label: 'Active',  time: '12 Feb · SingHealth accepted', current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '12 Feb 2027 · annual renewal', muted: true }
      ],
      terms: {
        effectiveFrom: '12 Feb 2026',
        extendedUntil: '12 Feb 2027 <span style="color:var(--g-50)">(annual)</span>',
        residency:     'Strict · Singapore-only · no grace period',
        autoRenew:     'Off — Super Admin must re-attest annually'
      },
      nudge: {
        icon:    'shield-check',
        text:    'Patient Referral Record is residency-strict — cross-DEX action requires governance pre-approval (residency lock per ADR glossary). Annual re-attestation due 12 Feb 2027.',
        ctaLabel:'Open attestation panel'
      },
      // Activity rows — David is operator; priya (SingHealth) is cross-org;
      // MOH automated entries use literal actor strings.
      activity: [
        { actor: 'Lancelot',           action: 'completed annual data-classification review for HX residency-strict elements', time: '2 days ago · 16:00 SGT', timeISO: '2026-05-15T16:00+08:00', dot: 'hx' },
        { actor: 'MOH Compliance Desk', action: 'audited 1,284 patient referral records this quarter (no findings)',           time: '08 May · 09:00 SGT · automated', timeISO: '2026-05-08T09:00+08:00', dot: 'hx' },
        { actorUserId: 'priya',         action: 'accepted the Agreement',                                                       time: '12 Feb · 10:42 SGT',     timeISO: '2026-02-12T10:42+08:00', dot: 'green' },
        { actor: 'Lancelot',           action: 'created the Agreement and sent the invitation',                                time: '08 Feb · 11:08 SGT',     timeISO: '2026-02-08T11:08+08:00', dot: 'muted' }
      ]
    },

    /* INBOX — Super Admin on SGHealthdex. Mine items reflect governance work:
       attestations, residency-strict classification, user management. */
    inbox: {
      name: 'SGHealthdex · Cosco Health Services',
      count: 6, mineCount: 3, teamCount: 3,
      chip: 'hx',
      role: 'Super Admin',
      orgName: 'Cosco Health Services',
      mine: [
        { title: 'Annual compliance certificate expires in 14 days',                   meta: 'Renewal · residency-strict · no grace period',                                       btn: 'Renew',  cta: 'renew-strict', intent: 'confirm', sourceType: 'agreement', dueAt: '2026-06-02T00:00:00+08:00' },
        { title: 'Re-attest Patient Referral Record classification with SingHealth',   meta: 'Governance · residency-strict · attestation due 24 May',                            btn: 'Attest', cta: 'attest', intent: 'confirm', sourceType: 'governance', dueAt: '2026-05-24T00:00:00+08:00' },
        { title: 'Promote Dr Angela to Operation User on SGHealthdex',                    meta: 'User management · 1 pending nomination from Polyclinic Bedok',                      btn: 'Open',   cta: 'open', intent: 'decide', sourceType: 'governance' }
      ],
      team: [
        { title: 'Patient registry data classification review',                         meta: 'Governance · residency-strict · 2 Super Admins eligible',                            btn: 'Claim', intent: 'decide', sourceType: 'governance' },
        { title: 'Lab partnership Agreement awaiting compliance sign-off',              meta: 'Compliance review · with legal · 24h SLA',                                           btn: 'Claim', intent: 'decide', sourceType: 'agreement' },
        { title: 'Lancelot approved Diabetic Foot Screening flow from Polyclinic Bedok',  meta: 'Completed 6 min ago · disappears from inbox in 3 min',                            completion: true }
      ]
    },

    'message-detail': { alias: 'david-cosco-hx-C/messages[0]' },
    'pack-detail':    { alias: 'david-cosco-hx-C/agreements' },

    dashboard: null,

    /* DRAFTS — Super Admin can create. Agreement drafts in progress. */
    drafts: [
      { id: 'D-2026-0510-A', title: 'Patient Referral Record — KK Women’s & Children’s Hospital onboarding', icon: 'file-text',   type: 'Direct',           meta: 'last edited 3h ago · counterparty + terms set · attestation step remaining', resumeKey: 'Patient Referral Record — KKH' },
      { id: 'D-2026-0508-B', title: 'Diabetic screening pack — polyclinic network rollout',                            icon: 'stack',       type: 'Direct',           meta: 'last edited yesterday · data elements only · 4 polyclinic counterparties',     resumeKey: 'Diabetic screening pack' },
      { id: 'D-2026-0505-C', title: 'Specialist Centre D as SP for prescription dispense aggregation',                  icon: 'users-group', type: 'Service-Provider', meta: 'last edited 5d ago · SP wizard step 2 — flow direction set to receive',         resumeKey: 'Specialist Centre D as SP' }
    ],

    /* PARTICIPANTS — directory cards anchored to ORGS + primary contacts. */
    participants: [
      { initials: 'SH', name: 'SingHealth',                  orgId: 'singhealth',       meta: 'Healthcare cluster · UEN 200002698R · 18 team members · 1 active Agreement with you', useCases: ['Patient referral', 'Clinical handover'],   status: { kind: 'active',  label: 'Active' },     joined: 'Joined 12 Feb 2024', primaryUserId: 'priya' },
      { initials: 'ME', name: 'MOH Eye Screening Centre',    orgId: 'moh-esc',          meta: 'Regulator · MOH Singapore · 6 clinical leads · 1 active Agreement with you',          useCases: ['Diabetic Retinal Photography', 'Prescription dispense'], status: { kind: 'active', label: 'Active' }, joined: 'Joined 03 Apr 2024', primaryUserId: 'ruby' },
      { initials: 'PB', name: 'Polyclinic Bedok',            orgId: 'polyclinic-bedok', meta: 'Polyclinic · MOH-linked · 9 clinicians · 1 active Agreement with you',                 useCases: ['Diabetic Foot Screening'],                 status: { kind: 'active',  label: 'Active' },     joined: 'Joined 21 Jun 2024', primaryUserId: 'joshua' },
      { initials: 'KK', name: 'KK Women’s and Children’s Hospital', meta: 'Specialist hospital · KKH · onboarding in progress',                                              useCases: ['Patient referral (pending)'],              status: { kind: 'pending', label: 'Pending attestation' }, joined: 'Invited 4 days ago' }
    ],

    /* AGREEMENTS — three HX data elements across flat rows + one pack. */
    agreements: [
      // Headline — same record as detail seed above.
      { kind: 'flat', id: 'AGR-2026-05418', cp: { name: 'SingHealth',          initials: 'SH', role: 'Healthcare cluster',  dex: 'SGHealthdex' }, element: { name: 'Patient Referral Record', version: 'v3.0' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '12 Feb 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      // Pack — Clinical referral pack across 3 HX consumers.
      { kind: 'pack-parent', id: 'PACK-2026-0212-HX', name: 'Clinical referral pack', packTag: 'PACK', childCount: 3, cpCount: 3, element: { name: 'Clinical referral pack', summary: '3 elements split' }, type: 'Direct ×3', status: { kind: 'active', label: 'Active (3 of 3)' }, until: '12 Feb 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                          cp: { name: 'SingHealth',         initials: 'SH', role: 'Healthcare cluster', dex: 'SGHealthdex' }, element: { name: 'Patient Referral Record',      version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'MOH Eye Screening Centre', initials: 'ME', role: 'Regulator',     dex: 'SGHealthdex' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'Polyclinic Bedok',   initials: 'PB', role: 'Polyclinic',         dex: 'SGHealthdex' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-04806', cp: { name: 'MOH Eye Screening Centre', initials: 'ME', role: 'Regulator',     dex: 'SGHealthdex' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '03 Apr 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-04812', cp: { name: 'Polyclinic Bedok',         initials: 'PB', role: 'Polyclinic',    dex: 'SGHealthdex' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '21 Jun 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-05101', cp: { name: 'KK Women’s & Children’s Hospital', initials: 'KK', role: 'Specialist hospital', dex: 'SGHealthdex' }, element: { name: 'Patient Referral Record', version: 'v3.0' }, type: 'Direct', status: { kind: 'pending', label: 'Pending attestation' }, until: 'Awaiting governance sign-off', actions: ['withdraw'] }
    ],

    /* MESSAGES — three HX data elements across sent/received/failed/pull rows. */
    messages: [
      // New arrival — Patient Referral Record just sent to SingHealth via SGHealthdex-Main.
      { id: 'MSG-HX-1418', dir: 'sent',     newArrival: true, cp: { name: 'SingHealth',          initials: 'SH' }, pitstop: { name: 'SGHealthdex-Main' }, element: { name: 'Patient Referral Record',      version: 'v3.0' }, agreement: 'AGR-2026-05418', status: { kind: 'active',  label: 'Delivered' },     time: 'just now',     actions: ['view'] },
      // Prescription Dispense Record — acknowledged by MOH-ESC.
      { id: 'MSG-HX-1402', dir: 'sent',                       cp: { name: 'MOH Eye Screening Centre', initials: 'ME' }, pitstop: { name: 'SGHealthdex-Main' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, agreement: 'AGR-2026-04806', status: { kind: 'active',  label: 'Acknowledged' }, time: '1h ago',       actions: ['view'] },
      // Diabetic Foot Screening — received from Polyclinic Bedok (PULL response).
      { id: 'MSG-HX-1408', dir: 'received',                   cp: { name: 'Polyclinic Bedok',    initials: 'PB' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, agreement: 'AGR-2026-04812', status: { kind: 'active', label: 'Acknowledged' }, time: '3h ago',       actions: ['export'] },
      // Failed · mine — Prescription Dispense Record payload validation issue.
      { id: 'MSG-HX-1410', dir: 'sent', failed: true, cp: { name: 'MOH Eye Screening Centre', initials: 'ME' }, pitstop: { name: 'SGHealthdex-Main' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, agreement: 'AGR-2026-04806', status: { kind: 'failed', label: 'Failed', owner: 'mine', errorLine: 'Residency check failed · payload contains non-Singapore patient identifier <code>SG-MOH-Patient-Id</code>', errorIcon: 'shield-x' }, time: '24 min ago', actions: ['retry'] },
      // PULL — SingHealth requested back-fill of historical referrals.
      { id: 'MSG-HX-1416', dir: 'received',                   cp: { name: 'SingHealth',          initials: 'SH' }, element: { name: 'Patient Referral Record · back-fill', version: 'v3.0 · request' }, agreement: 'AGR-2026-05418', status: { kind: 'pending', label: 'In flight' }, time: '8 min ago', actions: ['inspect-pull'] },
      // Received pack — Polyclinic Bedok screening batch.
      { id: 'MSG-HX-1404', dir: 'received',                   cp: { name: 'Polyclinic Bedok',    initials: 'PB' }, element: { name: 'Diabetic Foot Screening', version: 'v3.0 · batch · 32 records' }, agreement: 'AGR-2026-04812', status: { kind: 'active', label: 'Acknowledged' }, time: '5h ago',       actions: ['export'] },
      // STORE expired — KKH onboarding payload expired before attestation.
      { id: 'MSG-HX-1396', dir: 'sent', failed: true, cp: { name: 'KK Women’s & Children’s Hospital', initials: 'KK' }, element: { name: 'Patient Referral Record', version: 'v3.0 · stored' }, agreement: 'AGR-2026-05101', status: { kind: 'failed', label: 'Failed', owner: 'expired', errorLine: '14-day TTL elapsed without attestation · data purged per residency-strict policy', errorIcon: 'clock-x' }, time: '1 day ago', actions: ['restage'] }
    ]
  },

  /* ----------------------------------------------------------
     marcus-cosco-tx-C — the default tour scene
     Marcus / Cosco / SGTradex / scenario C
     (Multi-Pitstop Cosco creates an Agreement for Mass Flow Meter Receipt
     to PSA — established scope; SG-Logistics Pitstop auto-fills the chip.)
     ---------------------------------------------------------- */
  'marcus-cosco-tx-C': {
    /* DETAIL — every counterparty / element / actor reference the detail
       screen needs. Renderer applies these into the existing markup, so
       the static HTML stays in place; only text and onclick handlers change. */
    detail: {
      agrId:           'AGR-2026-04829',
      dex:             'tx',
      dexLabel:        'SGTradex',
      title:           'Share Mass Flow Meter Receipt with PSA International',
      composerTooltip: 'Compose and send a new Mass Flow Meter Receipt to PSA under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Shipping (SG) Pte Ltd',
        uen:      'UEN 199001234A',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'PSA International',
        short:        'PSA',
        orgId:        'psa',
        uen:          'UEN 197905XXXX',
        roleLabel:    'Port operator',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Hayabusa (PSA)',                // (legacy fallback) — superseded by primaryUserId per Issue 0005
        primaryUserId:'wenchen'                        // Issue 0005 / ADR 0031 — user-record-backed primary contact
      },
      element: {
        name:        'Mass Flow Meter Receipt',
        version:     'v2.4',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 21 Mar · 1 element · not in a group'
      },
      pack: {
        visible: true,
        name:    'Vessel arrival distribution',
        count:   4
      },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '14 Mar · invited by you',   done: true },
        { stateKey: 'active',  label: 'Active',  time: '21 Mar · PSA accepted',     current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '30 Sep · expires',          muted: true }
      ],
      terms: {
        effectiveFrom: '21 Mar 2026',
        extendedUntil: '30 Sep 2026 <span style="color:var(--g-50)">(1 extension)</span>',
        residency:     'Standard · cross-DEX OK with warning',
        autoRenew:     'Off — requires explicit extension'
      },
      nudge: {
        icon:    'clock',
        text:    'Expires in 9 days. Extend before 30 Sep to avoid the 7-day grace window.',
        ctaLabel:'Extend now'
      },
      // Activity rows. `dot` maps to .ev-dot.{tx|bx|hx|green|muted}; actor + action
      // are joined into the row's <strong>actor</strong> action sentence.
      //
      // Per ADR 0031 (Event identity vs contractual identity): cross-org actors
      // (counterparty users) declare `actorUserId` so the renderer resolves
      // "Hayabusa (PSA)" from USERS[uid] + ORGS[primaryOrgId].short — backed by
      // a real user record, not a hardcoded literal. Same-org operator actors
      // (Marcus on Cosco's view) keep the literal `actor` string for byte-
      // identical display (no "(Cosco)" annotation on the operator's own rows).
      // Automated org-only events also keep the literal `actor`.
      activity: [
        { actor: 'Marcus Ong',         action: 'extended the Agreement by 6 months',          time: '2 days ago · 14:23 SGT',         timeISO: '2026-05-12T14:23+08:00', dot: 'tx' },
        { actor: 'PSA International',  action: 'began consuming the data feed',               time: '21 Mar · 09:15 SGT · automated', timeISO: '2026-03-21T09:15+08:00', dot: 'bx' },
        { actorUserId: 'wenchen',      action: 'accepted the Agreement',                      time: '21 Mar · 09:12 SGT',             timeISO: '2026-03-21T09:12+08:00', dot: 'green' },   // Issue 0005 — user-record-backed
        { actor: 'Marcus Ong',         action: 'created the Agreement and sent the invitation', time: '14 Mar · 11:08 SGT',           timeISO: '2026-03-14T11:08+08:00', dot: 'muted' }
      ]
    },

    /* INBOX / MESSAGE-DETAIL / DASHBOARD remain deferred to Phase 5d. */
    inbox:           null,           // Marcus uses INBOX_BY_DEX fallback
    'message-detail':null,           // Phase 5d (multi-state flow toggle)
    dashboard:       null,           // Phase 5d (retired screen, lower priority)
    /* PACK-DETAIL — alias to the agreements array so the pack-detail renderer
       (Phase 5e) can find Marcus's Vessel arrival distribution pack + members. */
    'pack-detail':   { alias: 'marcus-cosco-tx-C/agreements' },

    /* DRAFTS — small flat list, easy win. Drafts are operator-private so each
       scene's draft list is conceptually its own; aliases would make less sense
       here than for shared records. */
    drafts: [
      { id: 'D-2026-0517-A', title: 'Mass Flow Meter Receipt — PSA renewal exploration', icon: 'file-text',   type: 'Direct',           meta: 'last edited 2h ago · counterparty + terms set · 1 step remaining', resumeKey: 'Mass Flow Meter Receipt — PSA renewal' },
      { id: 'D-2026-0515-B', title: 'Bunker measurement cluster — Cosco subsidiaries',   icon: 'stack',       type: 'Direct',           meta: 'last edited yesterday · data element only · counterparty unset',   resumeKey: 'Bunker measurement cluster' },
      { id: 'D-2026-0512-C', title: 'CrimsonLogic as SP for Mass Flow Meter Receipt',    icon: 'users-group', type: 'Service-Provider', meta: 'last edited 3d ago · migrated from old portal',                    resumeKey: 'CrimsonLogic as SP for MFMR' }
    ],

    /* PARTICIPANTS — directory cards. Each card declares the org's identity,
       relationship summary, use-case enrolments, status, and joined date. The
       last card is the cross-DEX Acme Construction variant (primary DEX is
       SGBuildex) which the renderer special-cases via `crossDex: true`. */
    participants: [
      { initials: 'PS', name: 'PSA International',         meta: 'Port operator · UEN 199702345K · 12 team members · 1 active Agreement with you',           useCases: ['Vessel arrival','Bunker delivery'],                       status: { kind: 'active',  label: 'Active' },     joined: 'Joined 22 Aug 2023', primaryUserId: 'wenchen' },   // Issue 0005 / ADR 0031
      { initials: 'Mk', name: 'Maersk Logistics Pte Ltd',  meta: 'Carrier · UEN 200512345R · 6 team members · 3 active Agreements with you',                  useCases: ['B/L sharing','Vessel arrival','Cargo manifest'],          status: { kind: 'active',  label: 'Active' },     joined: 'Joined 14 Mar 2024', primaryUserId: 'lars' },   // Issue 0006 / ADR 0031
      { initials: 'CL', name: 'CrimsonLogic Pte Ltd',      meta: 'Service provider · UEN 198812345J · 4 team members · acts on behalf of 7 orgs',             useCases: ['Service provider','Customs'],                             status: { kind: 'active',  label: 'Active' },     joined: 'Joined 11 Nov 2024' },
      { initials: 'CS', name: 'Cosco Shipping Lines',      meta: 'Carrier · UEN 200012345B · 8 team members · also known as COSCON · 1 active Agreement',     useCases: ['B/L sharing'],                                            status: { kind: 'active',  label: 'Active' },     joined: 'Joined 03 Apr 2024' },
      { initials: 'PC', name: 'Pacific Container Lines',   meta: 'Carrier · UEN 202118822F · 3 team members · KYC review pending',                            useCases: ['B/L sharing (pending)'],                                  status: { kind: 'pending', label: 'Pending KYC' }, joined: 'Invited 6 days ago' },
      { initials: 'AC', name: 'Acme Construction Pte Ltd', orgId: 'acme', meta: 'Contractor · UEN 201111223J · cross-DEX participant', useCases: ['Cross-DEX agreements'], status: { kind: 'cross-dex' }, primaryUserId: 'boonkeng' }   // Issue 0007 — primaryDexId + joinedDate + status.label now derived from ORGS.acme + ORG_DEX_MEMBERSHIPS
    ],

    /* AGREEMENTS — flat rows + pack parent/members. Each entry's `kind` drives
       the renderer; pack members follow their parent in array order so the
       renderer can group them visually. Status `kind` maps to .status-cell
       classes (active / pending / ended). The first flat row anchors scenario
       C's headline Agreement (PSA · Mass Flow Meter Receipt). */
    agreements: [
      // Scenario C headline Agreement — the same record as detail seed above.
      { kind: 'flat', id: 'AGR-2026-04829', cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'SGTradex' }, element: { name: 'Mass Flow Meter Receipt', version: 'v2.4' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },          until: '30 Sep 2026', untilNote: '9 days',   actions: ['extend', 'revoke'] },
      // Pack — Vessel arrival distribution + 4 members (ADR 0027 split-pack).
      { kind: 'pack-parent', id: 'PACK-2026-0214', name: 'Vessel arrival distribution', packTag: 'PACK', childCount: 4, cpCount: 4, element: { name: 'Vessel arrival pack', summary: '4 elements split' }, type: 'Direct ×4', status: { kind: 'active', label: 'Active (4 of 4)' }, until: '14 Feb 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                       cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'SGTradex' }, element: { name: 'ETA',                  version: 'v2.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'Maersk Logistics',      initials: 'Mk', role: 'Carrier',             dex: 'SGTradex' }, element: { name: 'Cargo manifest',       version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'ICA Singapore',         initials: 'IC', role: 'Immigration',         dex: 'SGTradex' }, element: { name: 'Crew list',            version: 'v1.2' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'Hin Leong Insurance',   initials: 'HL', role: 'Insurance broker',    dex: 'SGTradex' }, element: { name: 'Vessel particulars',   version: 'v1.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-04955', cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'SGTradex' }, element: { name: 'Bunker delivery confirmation', version: '' }, type: { label: 'Service-Provider', tooltip: 'Appointed via CrimsonLogic' }, status: { kind: 'pending', label: 'Pending' }, until: 'Awaiting acceptance', actions: ['withdraw'] },
      { kind: 'flat', id: 'AGR-2025-08712', cp: { name: 'CrimsonLogic',          initials: 'CL', role: 'Service provider',    dex: 'SGTradex' }, element: { name: 'Cargo manifest', version: 'v3.0' }, type: 'Service-Provider', status: { kind: 'active', label: 'Active' }, until: '22 Aug 2027', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2025-04412', cp: { name: 'Pacific Lines',         initials: 'PL', role: 'Carrier',             dex: 'SGTradex' }, element: { name: 'Bill of Lading', version: 'v2.0' }, type: 'Direct', status: { kind: 'ended',   label: 'Ended · revoked' }, until: 'Ended 28 Mar 2026', actions: ['view-audit'] },
      { kind: 'flat', id: 'AGR-2026-04501', cp: { name: 'ABC Logistics',         initials: 'AB', role: 'Shipper',             dex: 'SGTradex' }, element: { name: 'Certificate of origin', version: 'v1.4' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '15 Dec 2026', actions: ['extend', 'revoke'] }
    ],

    /* MESSAGES — direction-aware row list. The pitstop chip is optional and may
       carry retired: true (annotated). status.owner = 'mine' | 'theirs' | 'expired'
       drives the owner-badge for failed rows. errorLine is rendered only when
       status.kind === 'failed'. */
    messages: [
      // New arrival — Mass Flow Meter Receipt just sent to PSA via SG-Logistics.
      { id: 'MSG-1247', dir: 'sent',     newArrival: true, cp: { name: 'PSA International', initials: 'PS' }, pitstop: { name: 'SG-Logistics' },           element: { name: 'Mass Flow Meter Receipt', version: 'v2.4' },         agreement: 'AGR-2026-04829', status: { kind: 'active',  label: 'Delivered' },     time: 'just now',     actions: ['view'] },
      // Historical — retired Pitstop annotation (Scenario E demo).
      { id: 'MSG-1198', dir: 'sent',                       cp: { name: 'Maersk Logistics',  initials: 'Mk' }, pitstop: { name: 'SG-Logistics-Old', retired: true, retiredDate: '2026-03-04' }, element: { name: 'Vessel Voyage Schedule', version: 'v2.1' }, agreement: 'AGR-2025-09844', status: { kind: 'active', label: 'Acknowledged' }, time: '2 months ago', actions: ['view'] },
      // Failed · mine — PSA dispatch with payload validation issue.
      { id: 'MSG-1240', dir: 'sent', failed: true, cp: { name: 'PSA International', initials: 'PS' }, pitstop: { name: 'SG-Finance' }, element: { name: 'Bunker delivery', version: 'v0.9' }, agreement: 'AGR-2026-04822', status: { kind: 'failed', label: 'Failed', owner: 'mine', errorLine: 'Payload validation failed · field <code>quantityMt</code> out of range', errorIcon: 'x-circle' }, time: '3 min ago', actions: ['retry'] },
      // PULL — Maersk requested container tracking from us.
      { id: 'MSG-1241', dir: 'received',                   cp: { name: 'Maersk Logistics',  initials: 'Mk' }, element: { name: 'Container tracking pull', version: 'v1.2 · request' }, agreement: 'AGR-2026-04829', status: { kind: 'pending', label: 'In flight' }, time: '2 min ago', actions: ['inspect-pull'] },
      // STORE expired — ABC Logistics customs digest.
      { id: 'MSG-1230', dir: 'sent', failed: true, cp: { name: 'ABC Logistics', initials: 'AB' }, element: { name: 'Daily customs digest', version: 'v2.0 · stored' }, agreement: 'AGR-2026-04501', status: { kind: 'failed', label: 'Failed', owner: 'expired', errorLine: '7-day TTL elapsed without retrieval · data purged', errorIcon: 'clock-x' }, time: '2h ago', actions: ['restage'] },
      // Received pack — Cosco vessel arrival pack acknowledged.
      { id: 'MSG-1232', dir: 'received', cp: { name: 'Cosco Shipping',   initials: 'CS' }, element: { name: 'Vessel arrival pack', version: 'pack · 4 elements' }, agreement: 'AGR-2026-03917', status: { kind: 'active', label: 'Acknowledged' }, time: '8 min ago', actions: ['export'] },
      // Queued — ABC Logistics cert of origin in flight.
      { id: 'MSG-1239', dir: 'sent', queued: true, cp: { name: 'ABC Logistics', initials: 'AB' }, element: { name: 'Certificate of origin', version: 'v1.4' }, agreement: 'AGR-2026-04501', status: { kind: 'pending', label: 'In flight' }, time: '12 min ago', actions: ['view'] }
    ]
  },

  /* ----------------------------------------------------------
     marcus-cosco-tx-A — single-Pitstop op on SGSGBuildex
     Cosco's construction subsidiary submits Manpower utilization to BCA.
     Source: MP_SCENARIOS['A'].display + extrapolation for parties / timeline.
     ---------------------------------------------------------- */
  'marcus-cosco-tx-A': {
    detail: {
      agrId:           'AGR-2026-05103',
      dex:             'bx',
      dexLabel:        'SGBuildex',
      title:           'Submit Manpower utilization to BCA',
      composerTooltip: 'Compose and send a new Manpower utilization submission to BCA under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Construction (SG) Pte Ltd',
        uen:      'UEN 200807456C',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'BCA · Building & Construction Authority',
        short:        'BCA',
        orgId:        'bca',
        uen:          'Singapore regulator',
        roleLabel:    'Regulator · Statutory Board',
        partyLabel:   'Receiver · Regulator',
        acceptorName: 'Compliance Desk (BCA)'
      },
      element: {
        name:        'Manpower utilization',
        version:     'v3.2',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 18 Mar · 11 required fields per BCA submission schema · single Pitstop'
      },
      pack:  { visible: false },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '18 Mar · invited by you',  done: true },
        { stateKey: 'active',  label: 'Active',  time: '19 Mar · BCA accepted',    current: true },
        { stateKey: 'ends',    label: 'Ends',    time: 'Renews annually',          muted: true }
      ],
      terms: {
        effectiveFrom: '19 Mar 2026',
        extendedUntil: 'Renews annually <span style="color:var(--g-50)">(BCA regulatory)</span>',
        residency:     'Strict · BCA Singapore-only',
        autoRenew:     'On — managed by BCA compliance lifecycle'
      },
      nudge: {
        icon:    'shield-check',
        text:    'BCA submissions are time-sensitive. Watch this Agreement to receive instant Failed/Acknowledged alerts.',
        ctaLabel:'Configure watch'
      },
      activity: [
        { actor: 'BCA Compliance Desk', action: 'acknowledged 142 submissions this week', time: 'Today · 09:00 SGT · automated', timeISO: '2026-05-17T09:00+08:00', dot: 'bx' },
        { actor: 'Marcus Ong',          action: 'updated routing to single-Pitstop cosco-bx-main', time: '2 weeks ago',                timeISO: '2026-05-03T10:00+08:00', dot: 'bx' },
        { actor: 'BCA Compliance Desk', action: 'accepted the Agreement',                time: '19 Mar · 08:42 SGT',           timeISO: '2026-03-19T08:42+08:00', dot: 'green' },
        { actor: 'Marcus Ong',          action: 'created the Agreement and sent the invitation', time: '18 Mar · 16:20 SGT',  timeISO: '2026-03-18T16:20+08:00', dot: 'muted' }
      ]
    }
  },

  /* ----------------------------------------------------------
     marcus-cosco-tx-B — first-use scope capture
     Cosco creates its first Bunker Requisition Form Agreement with TFG Marine.
     The scope-set step is captured inline (handled separately by pitstop.js).
     ---------------------------------------------------------- */
  'marcus-cosco-tx-B': {
    detail: {
      agrId:           'AGR-2026-05210',
      dex:             'tx',
      dexLabel:        'SGTradex',
      title:           'Request Bunker Requisition Forms from TFG Marine',
      composerTooltip: 'Compose and send a new Bunker Requisition Form to TFG Marine under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Shipping (SG) Pte Ltd',
        uen:      'UEN 199001234A',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'TFG Marine Pte Ltd',
        short:        'TFG Marine',
        orgId:        'tfg-marine',
        uen:          'UEN 201503377M',
        roleLabel:    'Bunker supplier',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Vessel Operations (TFG Marine)'
      },
      element: {
        name:        'Bunker Requisition Form',
        version:     'v1.0',
        complexity:  'simple',
        snapshotText:'Snapshot taken today · 9 fields including vessel name, ETA at oil terminal, fuel grade, requested quantity'
      },
      pack:  { visible: false },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: 'Today · scope-set captured',     current: true },
        { stateKey: 'active',  label: 'Active',  time: 'awaiting TFG Marine acceptance', muted: true },
        { stateKey: 'ends',    label: 'Ends',    time: '12-month default term',          muted: true }
      ],
      terms: {
        effectiveFrom: 'Pending acceptance',
        extendedUntil: '12 months from acceptance',
        residency:     'Standard · cross-DEX OK with warning',
        autoRenew:     'Off — first-time use'
      },
      nudge: {
        icon:    'sparkles',
        text:    'First Bunker Requisition Form Agreement for Cosco. Pitstop scope was captured inline at creation — review on Settings → Pitstops.',
        ctaLabel:'Review scope'
      },
      activity: [
        { actor: 'Marcus Ong', action: 'captured Pitstop scope: SG-Logistics produces Bunker Requisition Form', time: 'Today · just now', timeISO: '2026-05-17T11:30+08:00', dot: 'tx' },
        { actor: 'Marcus Ong', action: 'created the Agreement and sent the invitation to TFG Marine',          time: 'Today · 11:25 SGT', timeISO: '2026-05-17T11:25+08:00', dot: 'muted' }
      ]
    }
  },

  /* ----------------------------------------------------------
     pat-crimsonlogic-tx-D — SP delegation · multi-Pitstop
     CrimsonLogic transmits Container Booking on Maersk's behalf to Cosco.
     Operator is Pat / CrimsonLogic; Acting-as-Maersk framing is set via
     activity log + nudge copy (the chip itself surfaces on the composer).
     ---------------------------------------------------------- */
  'pat-crimsonlogic-tx-D': {
    detail: {
      agrId:           'AGR-2026-04711',
      dex:             'tx',
      dexLabel:        'SGTradex',
      title:           'Transmit Container Booking to Cosco (acting as Maersk)',
      composerTooltip: 'Compose and send a new Container Booking to Cosco on behalf of Maersk',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'CrimsonLogic Pte Ltd',
        uen:      'UEN 198803003E',
        orgId:    'crimsonlogic',
        roleLabel:'Sender · You (acting as Maersk Logistics)'
      },
      counterparty: {
        name:         'Cosco Shipping Lines (SG)',
        short:        'Cosco',
        orgId:        'cosco',
        uen:          'UEN 199001234A',
        roleLabel:    'Carrier-counterparty',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Marcus Ong (Cosco)'
      },
      element: {
        name:        'Container Booking',
        version:     'v1.8',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 14 Feb · SP-relationship · Maersk is data owner, CrimsonLogic transmits'
      },
      pack:  { visible: false },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '14 Feb · invited by Maersk',     done: true },
        { stateKey: 'active',  label: 'Active',  time: '16 Feb · Cosco accepted',        current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '14 Feb 2027 · annual renewal',   muted: true }
      ],
      terms: {
        effectiveFrom: '16 Feb 2026',
        extendedUntil: '14 Feb 2027 <span style="color:var(--g-50)">(annual)</span>',
        residency:     'Standard · SP-delegated transmission',
        autoRenew:     'On — managed by Maersk-CrimsonLogic SP contract'
      },
      nudge: {
        icon:    'user-share',
        text:    'You are transmitting on behalf of Maersk Logistics. Pick a CrimsonLogic Pitstop (CL-Shipping or CL-Customs) per dispatch — Acting-as chip surfaces on every Message.',
        ctaLabel:'Compose Message'
      },
      activity: [
        { actor: 'Chou (CrimsonLogic)',    action: 'transmitted 48 bookings via CL-Shipping this week', time: 'Today · 10:15 SGT · automated', timeISO: '2026-05-17T10:15+08:00', dot: 'tx' },
        { actor: 'Marcus Ong (Cosco)',    action: 'accepted the Agreement',                            time: '16 Feb · 14:30 SGT',           timeISO: '2026-02-16T14:30+08:00', dot: 'green' },
        { actor: 'Maersk Logistics',      action: 'authorised CrimsonLogic as SP and invited Cosco',   time: '14 Feb · 09:00 SGT',           timeISO: '2026-02-14T09:00+08:00', dot: 'muted' }
      ]
    },

    /* INBOX — CrimsonLogic SP-side work. Mine is operator-actionable Pat work
       (transmissions awaiting confirmation, new SP authorisations); team is
       broader CrimsonLogic queue any SP-operator there can claim. Same `chip`
       as SGTradex since CrimsonLogic operates exclusively on TX in this prototype. */
    inbox: {
      name: 'SGTradex · CrimsonLogic SP',
      count: 6, mineCount: 3, teamCount: 3,
      chip: 'tx',
      role: 'Admin User',
      orgName: 'CrimsonLogic',
      mine: [
        { title: 'Confirm 12 Container Booking transmissions to Cosco — manifest mismatch flagged', meta: 'Acting as Maersk · CL-Shipping · 2 of 14 manifests flagged · awaiting your review', btn: 'Review', cta: 'review-transmission', intent: 'decide', sourceType: 'message', dir: 'out' },
        { title: 'Maersk requested SP appointment for Statement of Facts', meta: 'New SP delegation · authorisation drafted by Maersk · expires in 5 days', btn: 'Accept', cta: 'accept-sp-appt', intent: 'decide', sourceType: 'agreement', dueAt: '2026-05-24T00:00:00+08:00' },
        { title: 'CL-Customs scope-set update for Container Booking', meta: 'Routing change · 3 carriers affected · regulatory window closes in 48h', btn: 'Open', cta: 'open-scope-update', intent: 'confirm', sourceType: 'agreement', dueAt: '2026-05-21T00:00:00+08:00' }
      ],
      team: [
        { title: 'Hapag-Lloyd onboarding for Container Booking transmission', meta: 'New carrier · awaiting CL-Shipping setup · 4 SP-operators eligible', btn: 'Claim', intent: 'decide', sourceType: 'governance' },
        { title: 'Aldous accepted ONE Line SP appointment', meta: 'Completed 8 min ago · disappears from inbox in 3 min', completion: true },
        { title: 'Quarterly SP audit — pending CL-Customs sign-off', meta: 'Audit · oldest 1d ago · 2 SP-operators eligible', btn: 'Claim', intent: 'confirm', sourceType: 'governance' }
      ]
    }
  },

  /* ----------------------------------------------------------
     marcus-cosco-tx-E — Pitstop retired
     Cosco's SG-Logistics-Old (retired 4 Mar 2026) handled vessel scheduling.
     New compositions route via active SG-Logistics; historical Messages
     surface the retired Pitstop name with an annotation.
     ---------------------------------------------------------- */
  'marcus-cosco-tx-E': {
    detail: {
      agrId:           'AGR-2025-09844',
      dex:             'tx',
      dexLabel:        'SGTradex',
      title:           'Share Vessel Voyage Schedule with Maersk Logistics',
      composerTooltip: 'Compose and send a new Vessel Voyage Schedule to Maersk under this Agreement',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Shipping (SG) Pte Ltd',
        uen:      'UEN 199001234A',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'Maersk Logistics Pte Ltd',
        short:        'Maersk',
        orgId:        'maersk',
        uen:          'UEN 200512345R',
        roleLabel:    'Carrier',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Granger (Maersk)',         // (legacy fallback) — superseded by primaryUserId
        primaryUserId:'lars'                            // Issue 0006 / ADR 0031 — user-record-backed primary contact
      },
      element: {
        name:        'Vessel Voyage Schedule',
        version:     'v2.1',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 11 Sep 2025 · 7 voyage-leg fields per MPA schedule schema'
      },
      pack:  { visible: true, name: 'Voyage planning bundle', count: 3 },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '11 Sep 2025 · invited by you',   done: true },
        { stateKey: 'active',  label: 'Active',  time: '14 Sep 2025 · Maersk accepted',  current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '14 Sep 2026 · annual renewal',   muted: true }
      ],
      terms: {
        effectiveFrom: '14 Sep 2025',
        extendedUntil: '14 Sep 2026 <span style="color:var(--g-50)">(annual)</span>',
        residency:     'Standard · cross-DEX OK with warning',
        autoRenew:     'On — auto-renews unless cancelled'
      },
      nudge: {
        icon:    'history',
        text:    'Routing fell back from retired SG-Logistics-Old (4 Mar 2026) to active SG-Logistics. Historical Messages still annotate the prior Pitstop.',
        ctaLabel:'View routing trace'
      },
      activity: [
        { actor: 'Marcus Ong',         action: 'migrated routing from SG-Logistics-Old → SG-Logistics', time: '4 Mar 2026 · 09:00 SGT', timeISO: '2026-03-04T09:00+08:00', dot: 'tx' },
        { actor: 'Maersk Logistics',   action: 'began consuming the data feed',                          time: '14 Sep 2025 · 11:00 SGT', timeISO: '2025-09-14T11:00+08:00', dot: 'bx' },
        { actorUserId: 'lars',         action: 'accepted the Agreement',                                time: '14 Sep 2025 · 10:45 SGT', timeISO: '2025-09-14T10:45+08:00', dot: 'green' },   // Issue 0006 — user-record-backed
        { actor: 'Marcus Ong',         action: 'created the Agreement and sent the invitation',         time: '11 Sep 2025 · 16:00 SGT', timeISO: '2025-09-11T16:00+08:00', dot: 'muted' }
      ]
    }
  },

  /* ----------------------------------------------------------
     marcus-cosco-tx-F — Joint-state warning
     Cosco sends Statement of Facts to Maersk. Maersk lost consume-scope
     on their side (joint-state warning fires at Composer form-open).
     ---------------------------------------------------------- */
  'marcus-cosco-tx-F': {
    detail: {
      agrId:           'AGR-2026-05011',
      dex:             'tx',
      dexLabel:        'SGTradex',
      title:           'Share Statement of Facts with Maersk Logistics',
      composerTooltip: 'Compose and send a new Statement of Facts to Maersk — receiver scope currently empty',
      sendMessageLabel:'Send Message',
      operator: {
        name:     'Cosco Shipping (SG) Pte Ltd',
        uen:      'UEN 199001234A',
        orgId:    'cosco',
        roleLabel:'Sender · You'
      },
      counterparty: {
        name:         'Maersk Logistics Pte Ltd',
        short:        'Maersk',
        orgId:        'maersk',
        uen:          'UEN 200512345R',
        roleLabel:    'Carrier',
        partyLabel:   'Receiver · Counterparty',
        acceptorName: 'Granger (Maersk)',         // (legacy fallback)
        primaryUserId:'lars'                            // Issue 0006 / ADR 0031
      },
      element: {
        name:        'Statement of Facts',
        version:     'v1.5',
        complexity:  'high-stakes',
        snapshotText:'Snapshot taken 02 Feb · joint port-call event log signed by master & terminal'
      },
      pack:  { visible: false },
      timeline: [
        { stateKey: 'pending', label: 'Pending', time: '02 Feb · invited by you',         done: true },
        { stateKey: 'active',  label: 'Active',  time: '06 Feb · Maersk accepted',        current: true },
        { stateKey: 'ends',    label: 'Ends',    time: '02 Feb 2027 · annual renewal',    muted: true }
      ],
      terms: {
        effectiveFrom: '06 Feb 2026',
        extendedUntil: '02 Feb 2027 <span style="color:var(--g-50)">(annual)</span>',
        residency:     'Standard · cross-DEX OK with warning',
        autoRenew:     'On — auto-renews unless cancelled'
      },
      nudge: {
        icon:    'alert-triangle',
        text:    'Maersk currently has no Pitstop scoped to consume this element. Composer will surface a joint-state warning before payload-fill.',
        ctaLabel:'View receiver scope'
      },
      activity: [
        { actor: 'Maersk Logistics',  action: 'reduced consume-scope on Singapore Pitstop',  time: 'Yesterday · 14:00 SGT',  timeISO: '2026-05-16T14:00+08:00', dot: 'tx' },
        { actor: 'Maersk Logistics',  action: 'began consuming the data feed',               time: '06 Feb · 09:30 SGT',     timeISO: '2026-02-06T09:30+08:00', dot: 'bx' },
        { actorUserId: 'lars',        action: 'accepted the Agreement',                      time: '06 Feb · 09:15 SGT',     timeISO: '2026-02-06T09:15+08:00', dot: 'green' },   // Issue 0006 — user-record-backed
        { actor: 'Marcus Ong',        action: 'created the Agreement and sent the invitation', time: '02 Feb · 11:00 SGT',  timeISO: '2026-02-02T11:00+08:00', dot: 'muted' }
      ]
    }
  }

  /* Phase 5b/6 will add: 'sarah-platform' for Sarah's SGTradex Admin scenes,
     and screen-level entries (agreements / messages / participants / inbox /
     drafts / dashboard) for every scenario above. */
};


/* Expose the fixture blocks on `window` so workspace-bootstrap.js can read
   them across script boundaries. The runtime touches these names exactly
   four times: buildWorkspaceFromFixtures iterates UNIFIED_SEED_SCENES, then
   mergeSceneIntoWorkspace calls seedFor(scene, ...) which dereferences
   SCENE_SEEDS, and inbox seeding falls back to INBOX_BY_DEX[dex] when a
   scene has no inbox block of its own. PLATFORM_INBOX powers the platform
   admin's cross-org inbox surface (themeInboxContent in theme.js). */
window.PLATFORM_INBOX = PLATFORM_INBOX;
window.INBOX_BY_DEX = INBOX_BY_DEX;
window.MP_SCENARIOS = MP_SCENARIOS;
window.activeMpScenario = activeMpScenario;
window.SCENE_SEEDS = SCENE_SEEDS;
window.pitstopMru = (typeof pitstopMru !== 'undefined') ? pitstopMru : {};
