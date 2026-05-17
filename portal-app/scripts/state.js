/* ============================================================
   STATE — single source of truth for app-wide runtime state.
   All other scripts read/write through these globals. Loaded
   first; no other script may declare these names.
   ============================================================ */

/* ---------- Wizard step tracks ---------- */
const WIZARD_STEPS_DIRECT = [
  { screen: 'data-picker', label: 'Data element' },
  { screen: 'cp-picker',   label: 'Counterparty' },
  { screen: 'wiz-terms',   label: 'Terms' },
  { screen: 'wiz-review',  label: 'Review' },
  { screen: 'wiz-success', label: 'Done' }
];

const WIZARD_STEPS_SP = [
  { screen: 'wiz-sp-config', label: 'Direction & SP' },
  { screen: 'data-picker',   label: 'Data element' },
  { screen: 'cp-picker',     label: 'Counterparty' },
  { screen: 'wiz-terms',     label: 'Terms' },
  { screen: 'wiz-review',    label: 'Review' },
  { screen: 'wiz-success',   label: 'Done' }
];

let wizardSteps = WIZARD_STEPS_DIRECT;

/* ---------- Wizard state object ---------- */
let wiz = {
  active: false,
  idx: 0,
  type: 'DIRECT',
  de: 'Vessel arrival pack',
  deDetail: 'Data element pack · 4 elements: ETA, Vessel particulars, Crew list, Cargo manifest',
  isPack: true,
  // viaPackSplit — true once the operator picks the Split path on pack-fork. Persists
  // through wiz-terms / wiz-review so the Back button can return to pack-split-mapping
  // instead of plain decrement-to-cp-picker. Reset on Cancel or going back to data-picker.
  viaPackSplit: false,
  cp: 'Maersk Logistics Pte Ltd',
  cpDetail: 'Carrier · UEN 200512345R · TradeX · Ready for B/L sharing',
  sp: null,
  spDetail: null,
  direction: 'send',
  crossDex: false,
  duration: 12,
  residency: 'standard'
};

/* ---------- Flow runner state ---------- */
let flowActive = null;

/* ---------- Impersonation session ---------- */
let impSeconds = 0;
let impInterval = null;

/* ---------- Extend modal state ---------- */
let extendMonths = 12;

/* ---------- CP picker cross-dex toggle ---------- */
let cpCrossDex = false;

/* ---------- Persona (which side of the platform am I on?) ----------
   Mirrors the userType axis in dex-repo (admin-corev2/services/authService.ts:314-329).
   A user is logged in as either a participant-org operator or as a platform operator
   (SGTradex itself). In the prototype the default is Marcus / Cosco on the participant
   side; the profile menu offers a demo-only switch to a platform-admin persona.

   Platform admins do NOT have a single DEX workspace — they operate cross-DEX.
   So in platform-admin mode the DEX switcher hides and the workspace pill flips
   to "SGTradex Platform" with no DEX dot. */
let currentPersona = 'participant'; // 'participant' | 'platform-admin' | 'sp-operator'

/* ---------- Pinned active user (Issue 0008 / ADR 0030) ----------
   The colleague switcher (workspace-pill chevron + profile menu) sets this
   to override the (persona, DEX) resolver. Mostly relevant for platform-tier
   colleagues (Sarah ↔ Wei Lin) where the resolver early-returns to Sarah
   regardless of DEX — without a pin, switching to Wei Lin would have nowhere
   to live. Participant-tier colleagues don't need pinning because navigating
   to their home DEX makes the resolver pick them up naturally.

   Cleared whenever currentPersona changes (switchPersona resets it) so a
   pinned Wei Lin choice doesn't leak into a Marcus/Pat session. */
let pinnedActiveUserId = null;

/* ============================================================
   CANONICAL ENTITIES — rail-as-scene foundations (Issue 0001)
   ============================================================
   Per docs/issues/0001-resolver-foundation.md + ADR 0029
   (./docs/adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md).
   These tables are the single source of truth for identity on the prototype:

     ORGS                    → every org the prototype references. Each row carries
                               `tier: 'participant' | 'platform'` and (participant tier)
                               `primaryDexId` — the org's home DEX (load-bearing for
                               ADR 0012 cross-DEX warning machinery).
     USERS                   → every logical user. Carries `primaryOrgId` (the rendering
                               anchor when multiple affiliations exist; sparse today).
                               Field `orgId` is RETIRED — derive via active affiliation.
     USER_ORG_AFFILIATIONS   → N:M join keyed `<userId>-<orgId>`. The contract by which
                               a human operates an org's seat. Tier-dispatched role
                               fields: `dexRoles: { dexId → role }` for participant-tier
                               affiliations; `platformRole: string` for platform-tier.
                               Mutually exclusive. Status enum: 'active' | 'alumni' | 'pending'.
     ORG_DEX_MEMBERSHIPS     → Explicit `(orgId, dexId) → { joinedDate, status }` rows
                               recording an org's enrolment in a DEX. Status enum:
                               'active' | 'pending' | 'on-hold' | 'lapsed'. `on-hold` is
                               deliberately renamed from `suspended` to avoid glossary
                               collision with the Suspended flag on Agreements.
     PERSONA_TO_USER         → maps the legacy persona keys to user ids so existing
                               call sites still resolve via PERSONAS[id].
     PERSONA_LABELS          → human-readable tier label.

   Existing consumers (applyPersonaChrome, refreshRoleChips, switchPersona,
   syncProfilePersonaSwitchRow) read PERSONAS[currentPersona]. PERSONAS now derives
   from USERS + USER_ORG_AFFILIATIONS + ORGS so any identity change flows from one
   place. Field names on PERSONAS are unchanged — no breaking changes in Issue 0001.

   Canonical read path for "what role does this user hold on this DEX?":
       resolveSeat(userId, dexId)  →  { tier, orgId, role }  or  null
   Defined in access.js. The new way; replaces USER_ROLES[u][d] + '*' wildcard.
   ============================================================ */

const ORGS = {
  // Operator orgs (an active persona can work for one of these). Each carries
  // `primaryDexId` — the org's home DEX (used by ADR 0012 cross-DEX machinery
  // + the chrome's workspace-pill DEX dot fallback at /portal/all).
  cosco:        { name: 'Cosco Shipping',     short: 'Cosco',        initials: 'Cs', tier: 'participant', primaryDexId: 'tx' },
  crimsonlogic: { name: 'CrimsonLogic',       short: 'CrimsonLogic', initials: 'CL', tier: 'participant', primaryDexId: 'tx' },
  // 'SGTraDex' (capital D) is a literal carryover from the prior PERSONAS literal to
  // keep profile-row + "View as…" display strings byte-identical through Phase 1.
  // The workspace pill says 'SGTradex Platform' independently (set in applyPersonaChrome).
  // Platform tier has no primaryDexId — SGTradex governs all DEXes.
  sgtradex:     { name: 'SGTraDex',            short: 'SGTradex',     initials: 'SG', tier: 'platform' },
  // Counterparty orgs (referenced by seeds; never directly logged-in in this prototype
  // until Issues 0005-0007 land counterparty users).
  maersk:       { name: 'Maersk Logistics',   short: 'Maersk',       initials: 'Mk', tier: 'participant', primaryDexId: 'tx' },
  psa:          { name: 'PSA International',  short: 'PSA',          initials: 'PS', tier: 'participant', primaryDexId: 'tx' },
  bca:          { name: 'BCA',                short: 'BCA',          initials: 'BC', tier: 'regulator',   primaryDexId: 'tx' },
  'tfg-marine': { name: 'TFG Marine',         short: 'TFG Marine',   initials: 'TF', tier: 'participant', primaryDexId: 'tx' },
  acme:         { name: 'Acme Construction Pte Ltd', short: 'Acme', initials: 'AC', tier: 'participant', primaryDexId: 'bx' },  // Issue 0007 — BX-primary; cross-DEX on TX

  /* ---------- BX/HX counterparty orgs (added for Alice + David scenes) ----------
     Anchored in the dex-monorepo:
       · JTC          — statutory board for industrial land; consumes manpower + safety on BuildEx
       · SingHealth   — Singapore healthcare cluster; data consumer on HealthDex
       · MOH-ESC      — MOH Eye Screening Centre (real participant per healthdex-ui-proposals/src/data/sharedDataFields.js)
       · Polyclinic-Bedok — Polyclinic A (Bedok) (real participant per healthdex-ui-proposals/src/data/sharedDataFields.js) */
  jtc:                { name: 'JTC Corporation',           short: 'JTC',           initials: 'JT', tier: 'regulator',   primaryDexId: 'bx' },
  singhealth:         { name: 'SingHealth',                short: 'SingHealth',    initials: 'SH', tier: 'participant', primaryDexId: 'hx' },
  'moh-esc':          { name: 'MOH Eye Screening Centre',  short: 'MOH-ESC',       initials: 'ME', tier: 'regulator',   primaryDexId: 'hx' },
  'polyclinic-bedok': { name: 'Polyclinic Bedok',          short: 'Polyclinic-Bedok', initials: 'PB', tier: 'participant', primaryDexId: 'hx' }
};

/* USERS — primaryOrgId is the rendering anchor for chrome when multiple
   affiliations exist. Sparse today (every user has exactly one active affiliation);
   the field is the future-proof. The retired `orgId` field is no longer present —
   call sites must derive org via the active affiliation (or read PERSONAS[].orgId
   from the adapter, which does the derivation centrally). */
const USERS = {
  // Marcus is the canonical demo operator — keep as-is.
  marcus: { name: 'Marcus Ong', email: 'marcus.ong@cosco.com.sg',  initials: 'MO', primaryOrgId: 'cosco',        personaType: 'participant' },

  // All other users are renamed to Mobile Legends: Bang Bang heroes — userId
  // tokens (`alice`, `david`, …) preserved so SCENE_SEEDS keys + affiliation
  // keys remain valid; only display fields (`name` / `email` / `initials`) change.
  alice:  { name: 'Layla',      email: 'layla@cosco.com.sg',            initials: 'LA', primaryOrgId: 'cosco',        personaType: 'participant' },  // Issue 0002 — Cosco BX operator (Malefic Gunner)
  david:  { name: 'Lancelot',   email: 'lancelot@cosco.com.sg',         initials: 'LC', primaryOrgId: 'cosco',        personaType: 'participant' },  // Issue 0003 — Cosco HX Super Admin (Perfumed Knight)
  wenchen:{ name: 'Hayabusa',   email: 'hayabusa@globalpsa.com',        initials: 'HB', primaryOrgId: 'psa',          personaType: 'participant' },  // Issue 0005 — PSA TX admin (Shadow of Iga)
  lars:   { name: 'Granger',    email: 'granger@maersk.com',            initials: 'GR', primaryOrgId: 'maersk',       personaType: 'participant' },  // Issue 0006 — Maersk TX admin (Death Chanter)
  boonkeng:{ name: 'Khufra',    email: 'khufra@acme-co.com',            initials: 'KH', primaryOrgId: 'acme',         personaType: 'participant' },  // Issue 0007 — Acme BX admin (Tyrant of the Desert Sands)
  pat:    { name: 'Chou',       email: 'chou@crimsonlogic.com',         initials: 'CH', primaryOrgId: 'crimsonlogic', personaType: 'participant' },  // CrimsonLogic SP-operator (Kung Fu Boy)
  sarah:  { name: 'Kagura',     email: 'kagura@sgtradex.com',           initials: 'KG', primaryOrgId: 'sgtradex',     personaType: 'platform-admin' }, // SGTradex Admin (Onmyoji)
  weilin: { name: 'Lesley',     email: 'lesley@sgtradex.com',           initials: 'LE', primaryOrgId: 'sgtradex',     personaType: 'platform-admin' }, // Issue 0004 — platform teammate (Twilight Sniper)

  /* BX/HX primary contacts on the counterparty side — surface in participants
     directory + activity log via ADR 0031's actorUserId dispatch rule.
     The three HealthDex counterparts use healer-archetype MLBB heroes (Estes /
     Rafaela / Angela) to keep the clinical tone, prefixed with "Dr". */
  kelvin:  { name: 'Hilda',       email: 'hilda@jtc.gov.sg',            initials: 'HD', primaryOrgId: 'jtc',              personaType: 'participant' },  // JTC inspector — BX counterparty primary contact (Frostiron Hunter)
  priya:   { name: 'Dr Estes',    email: 'estes@singhealth.com.sg',     initials: 'ES', primaryOrgId: 'singhealth',       personaType: 'participant' },  // SingHealth admin — HX counterparty primary contact (Holy Priest)
  ruby:    { name: 'Dr Rafaela',  email: 'rafaela@moh.gov.sg',          initials: 'RF', primaryOrgId: 'moh-esc',          personaType: 'participant' },  // MOH-ESC compliance lead — HX (Wings of Holiness)
  joshua:  { name: 'Dr Angela',   email: 'angela@polyclinic-bedok.sg',  initials: 'AG', primaryOrgId: 'polyclinic-bedok', personaType: 'participant' }   // Polyclinic Bedok lead — HX (Heart of Mech)
};

/* ---------- USER_ORG_AFFILIATIONS ----------
   Keyed `<userId>-<orgId>`. Each row carries:
     status:       'active' | 'alumni' | 'pending'
     startDate:    ISO date the affiliation began (or null for pending applicants)
     endDate:      ISO date when status flipped from active (alumni only); optional
     dexRoles:     { dexId → roleName }  — ONLY on participant-tier orgs
     platformRole: string                 — ONLY on platform-tier orgs
   `dexRoles` and `platformRole` are mutually exclusive — dispatched on ORGS[orgId].tier.

   Sarah's previous wildcard `{ '*': 'SGTradex Admin' }` is retired. The wildcard
   modeled "this user has the same role on every DEX" via string-equality of '*';
   the new model expresses the same fact via `tier === 'platform'`, a real schema
   property. The resolver branches on tier — no '*' fallback required.

   Issues 0002 + 0003 strip Marcus's BX and HX seats — Alice picks up BX, David picks up HX.
   Marcus is now Cosco's TX-only operator. */
const USER_ORG_AFFILIATIONS = {
  'marcus-cosco': {
    status:    'active',
    startDate: '2023-08-22',
    dexRoles:  { tx: 'Admin User' }                      // BX (Issue 0002) + HX (Issue 0003) stripped
  },
  'alice-cosco': {                                       // Issue 0002 — Cosco BX operator
    status:    'active',
    startDate: '2024-09-14',
    dexRoles:  { bx: 'Operation User' }
  },
  'david-cosco': {                                       // Issue 0003 — Cosco HX operator
    status:    'active',
    startDate: '2025-01-10',
    dexRoles:  { hx: 'Super Admin' }
  },
  'wenchen-psa': {                                       // Issue 0005 — PSA TX admin (counterparty-side user)
    status:    'active',
    startDate: '2023-08-22',
    dexRoles:  { tx: 'Admin User' }
  },
  'lars-maersk': {                                       // Issue 0006 — Maersk TX admin (counterparty-side user, scenario D receiving end)
    status:    'active',
    startDate: '2024-03-14',
    dexRoles:  { tx: 'Admin User' }
  },
  'boonkeng-acme': {                                     // Issue 0007 — Acme BX-primary admin (Cosco's cross-DEX counterparty)
    status:    'active',
    startDate: '2024-11-04',
    dexRoles:  { bx: 'Admin User' }
  },
  'pat-crimsonlogic': {
    status:    'active',
    startDate: '2024-11-11',
    dexRoles:  { tx: 'Admin User' }            // SP-side; only TradeX in this prototype
  },
  'sarah-sgtradex': {
    status:       'active',
    startDate:    '2022-04-01',
    platformRole: 'SGTradex Admin'             // promotable to 'Super SGTradex Admin'
  },
  'weilin-sgtradex': {                         // Issue 0004 — Sarah's platform-tier teammate
    status:       'active',
    startDate:    '2023-01-15',
    platformRole: 'SGTradex Admin'             // peer to Sarah; same governance scope
  },

  /* BX/HX counterparty primary-contact affiliations (added for Alice + David scenes). */
  'kelvin-jtc': {                              // JTC inspector — BX counterparty primary contact
    status:    'active',
    startDate: '2023-05-18',
    dexRoles:  { bx: 'Admin User' }
  },
  'priya-singhealth': {                        // SingHealth admin — HX counterparty primary contact
    status:    'active',
    startDate: '2024-02-12',
    dexRoles:  { hx: 'Admin User' }
  },
  'ruby-moh-esc': {                            // MOH-ESC compliance lead — HX counterparty primary contact
    status:    'active',
    startDate: '2024-04-03',
    dexRoles:  { hx: 'Admin User' }
  },
  'joshua-polyclinic-bedok': {                 // Polyclinic Bedok lead — HX counterparty primary contact
    status:    'active',
    startDate: '2024-06-21',
    dexRoles:  { hx: 'Operation User' }
  }
};

/* ---------- ORG_DEX_MEMBERSHIPS ----------
   Explicit `(orgId, dexId) → { joinedDate, status }` join. Previously implicit
   (derived from "does any user under this org have a USER_ROLES entry on this DEX");
   now first-class so the cross-DEX warning machinery, KYC-pending states, and
   Acme's primary-DEX fact all read from structured data.

   Status: 'active' | 'pending' | 'on-hold' | 'lapsed'.

   Issue 0001 seeds the memberships that match the current roster's actual reach.
   Counterparty memberships (PSA-TX, Maersk-TX, Acme-BX, Acme-TX, PCL-TX pending)
   are filled in by Issues 0005-0007. Cosco-BX and Cosco-HX exist today because
   Marcus has BX/HX seats; they will outlast Marcus's strip (Alice and David
   inherit them). */
const ORG_DEX_MEMBERSHIPS = {
  'cosco-tx':           { joinedDate: '2023-08-22', status: 'active' },
  'cosco-bx':           { joinedDate: '2024-09-14', status: 'active' },
  'cosco-hx':           { joinedDate: '2025-01-10', status: 'active' },
  'crimsonlogic-tx':    { joinedDate: '2024-11-11', status: 'active' },
  'psa-tx':             { joinedDate: '2022-06-15', status: 'active' },  // Issue 0005 — PSA counterparty
  'maersk-tx':          { joinedDate: '2024-03-14', status: 'active' },  // Issue 0006 — Maersk counterparty
  'acme-bx':            { joinedDate: '2024-11-04', status: 'active' },  // Issue 0007 — Acme's primary DEX
  'acme-tx':            { joinedDate: '2026-04-12', status: 'active' },  // Issue 0007 — Acme cross-DEX onto TradeX

  /* BX/HX counterparty memberships (added for Alice + David scenes). */
  'jtc-bx':                  { joinedDate: '2023-05-18', status: 'active' },  // JTC — BX statutory consumer of manpower + safety data
  'singhealth-hx':           { joinedDate: '2024-02-12', status: 'active' },  // SingHealth — HX referral consumer
  'moh-esc-hx':              { joinedDate: '2024-04-03', status: 'active' },  // MOH-ESC — HX clinical-imaging regulator
  'polyclinic-bedok-hx':     { joinedDate: '2024-06-21', status: 'active' }   // Polyclinic Bedok — HX screening submitter
  // PCL pending membership lands when the platform-admin onboarding demo is wired.
  // SGTradex is platform tier — has no DEX memberships (it governs every DEX).
};

const PERSONA_TO_USER = {
  'participant':    'marcus',
  'platform-admin': 'sarah',
  'sp-operator':    'pat'
};

const PERSONA_LABELS = {
  'participant':    'Participant operator',
  'platform-admin': 'Platform operator',
  'sp-operator':    'Service-Provider operator'
};

/* ---------- PERSONAS (derived adapter shim) ----------
   Same shape as the prior literal so every existing consumer reads identical
   fields (name, email, initials, label, orgName, personaType, userId, orgId).

   Issue 0001 changes the derivation chain: USERS no longer carries `orgId`, so
   the adapter reads `USERS[u].primaryOrgId` and joins through USER_ORG_AFFILIATIONS.
   External shape unchanged — call sites in app.js / pitstop.js continue to work
   without modification.

   SP-operator note (preserved from the prior literal): Pat works at CrimsonLogic,
   which holds the SP role for Maersk on Container Booking (scenario D — Maersk
   is the data owner, CrimsonLogic transmits). personaType is 'participant' so
   the sidebar/inbox shape stays in the participant lane; only the identity
   chrome (name, org, avatar) differs. */
const PERSONAS = (function buildPersonas() {
  const out = {};
  Object.entries(PERSONA_TO_USER).forEach(([personaId, userId]) => {
    const user = USERS[userId];
    if (!user) return;
    const orgId = user.primaryOrgId;
    const org = ORGS[orgId];
    if (!org) return;
    out[personaId] = {
      userId,
      name: user.name,
      email: user.email,
      initials: user.initials,
      label: PERSONA_LABELS[personaId],
      orgId,
      orgName: org.name,
      personaType: user.personaType
    };
  });
  return out;
})();

/* Cross-DEX platform-admin inbox — the work that lives at the platform tier:
   org onboarding KYC, Data Element promotions (Super SGTradex Admin only),
   network setup, cross-org user provisioning. Mirrors the items the admin-ui
   admin branch surfaces (Navigation/index.js:135-140 + maker-checker matrix). */
const PLATFORM_INBOX = {
  count: 9, mineCount: 4, teamCount: 5,
  role: 'SGTradex Admin', // promote to 'Super SGTradex Admin' to unlock DE.Create work
  mine: [
    { title: 'Pacific Container Lines — onboarding KYC review', meta: 'Org onboarding · KYC submitted 3d ago · awaiting your decision', btn: 'Review', action: 'review-org' },
    { title: 'Acme Construction → BuildEx · network admission', meta: 'Cross-DEX admission request · 2 of 3 platform admins approved', btn: 'Approve', action: 'approve-network' },
    { title: 'Promote Bill of Lading v2.1 → Active (TradeX)', meta: 'Data element governance · drafted by Kagura · review window closes today', btn: 'Open', action: 'open-de-promotion', requires: 'Super SGTradex Admin' },
    { title: 'Issue HealthDex network certificate renewal', meta: 'Network · current cert expires in 21d · renewal SOP applies', btn: 'Renew', action: 'renew-network' }
  ],
  team: [
    { title: 'Onboard 4 BuildEx contractor orgs — batch KYC', meta: 'Org onboarding · queued by automation · 2 admins eligible', btn: 'Claim' },
    { title: 'Lesley approved Greater Bay Logistics org admin role', meta: 'Completed 12 min ago · disappears from inbox in 3 min', completion: true },
    { title: 'Maersk requested SP appointment authority on TradeX', meta: 'Service-Provider authorisation · pending platform sign-off', btn: 'Claim' }
  ]
};

/* ---------- Role model (mirrors dex-repo) ----------
   Two orthogonal axes per the legacy admin-corev2 implementation:
   - userType: 'admin' (platform operator, SGTradex itself) | 'participant' (works for an approved participating org) | 'nonParticipant'
   - role:     concrete role enum, scoped either platform-wide (organizationId NULL) or to one org

   Source: admin-corev2/src/constants.ts:11-237 + admin-corev2/src/models/Role.ts:6-8

   The 7 real roles split across 2 tiers:
   - Platform tier (userType='admin', no org scope):
       'Super SGTradex Admin' — creates orgs, publishes Data Elements, bootstraps networks/DEXes
       'SGTradex Admin'       — onboarding approvals, KYC review, cross-org user provisioning
   - Org tier (userType='participant', scoped to one organizationId):
       'Super Admin'      — user mgmt + use cases + relationships (within own org)
       'Admin User'       — use cases + relationships, NO user mgmt
       'Operation User'   — Pitstop runtime/data ops only — blocked from non-ops routes
       'Tech User'        — Activity Log + Pitstops + enterprise system config
       'Etr User'         — ETR / agreement creation surface only
   A user can hold different roles on different DEXes (e.g. Admin User on TradeX, Operation User on BuildEx).
*/
const ROLE_CAPABILITIES = {
  'Super SGTradex Admin': { tier: 'platform', canCreateAgreement: true,  canManageUsers: true,  canPromoteDataElement: true,  canManageNetworks: true,  opsOnly: false, label: 'Super SGTradex Admin' },
  'SGTradex Admin':       { tier: 'platform', canCreateAgreement: false, canManageUsers: true,  canPromoteDataElement: false, canManageNetworks: true,  opsOnly: false, label: 'SGTradex Admin' },
  'Super Admin':          { tier: 'org',      canCreateAgreement: true,  canManageUsers: true,  canPromoteDataElement: false, canManageNetworks: false, opsOnly: false, label: 'Super Admin' },
  'Admin User':           { tier: 'org',      canCreateAgreement: true,  canManageUsers: false, canPromoteDataElement: false, canManageNetworks: false, opsOnly: false, label: 'Admin User' },
  'Operation User':       { tier: 'org',      canCreateAgreement: false, canManageUsers: false, canPromoteDataElement: false, canManageNetworks: false, opsOnly: true,  label: 'Operation User' },
  'Tech User':            { tier: 'org',      canCreateAgreement: false, canManageUsers: false, canPromoteDataElement: false, canManageNetworks: false, opsOnly: false, label: 'Tech User' },
  'Etr User':             { tier: 'org',      canCreateAgreement: true,  canManageUsers: false, canPromoteDataElement: false, canManageNetworks: false, opsOnly: false, label: 'Etr User' }
};

/* ---------- Per-DEX data-element registry ----------
   Feeds the New-Agreement wizard's data-picker step (renderDataPickerFromDex
   in app.js). Each DEX entry declares a flat list of element groups, the
   picker's search hint, and the headline element shown on the right pane
   when the picker first opens.

   Elements use kind:'leaf' (single element with a version) or kind:'pack'
   (a curated multi-element pack rendered with a "pack" pill, per ADR 0013).
   Snapshot semantics protect existing Agreements when groups are mutated. */
const DATA_ELEMENTS_BY_DEX = {
  tx: {
    searchHint:  'Search data elements on TradeX',
    totalCount:  189,
    groupCount:  12,
    headline: {
      kind: 'pack',
      name: 'Vessel arrival pack',
      blurb: 'Curated Data element pack — flows together when a vessel arrives. Maintained by TradeX admins.',
      snapshotLabel: 'Snapshot · 4 elements (deselect any)',
      elements: [
        { name: 'ETA',                version: 'v2.0' },
        { name: 'Vessel particulars', version: 'v1.5' },
        { name: 'Crew list',          version: 'v1.2' },
        { name: 'Cargo manifest',     version: 'v3.0' }
      ]
    },
    groups: [
      { name: 'Trade documents', count: 14, open: true, elements: [
        { kind: 'leaf', name: 'Bill of Lading',        version: 'v2.1', icon: 'file-text' },
        { kind: 'pack', name: 'Vessel arrival pack',   active: true },
        { kind: 'leaf', name: 'Cargo manifest',        version: 'v3.0', icon: 'file-text' },
        { kind: 'leaf', name: 'Certificate of origin', version: 'v1.4', icon: 'file-text' },
        { kind: 'pack', name: 'Pre-shipment documents' }
      ] },
      { name: 'Logistics & tracking', count: 38, elements: [] },
      { name: 'Bunker & fuel',        count: 26, elements: [] },
      { name: 'Finance & invoicing',  count: 21, elements: [] },
      { name: 'Customs & regulatory', count: 19, elements: [] }
    ]
  },
  bx: {
    searchHint:  'Search data elements on BuildEx',
    totalCount:  52,
    groupCount:  6,
    headline: {
      kind: 'pack',
      name: 'Subcontractor enablement pack',
      blurb: 'Curated BuildEx pack — flows together when a contractor is onboarded across BCA, JTC, and the prime contractor. Maintained by BuildEx admins.',
      snapshotLabel: 'Snapshot · 3 elements (deselect any)',
      elements: [
        { name: 'Subcontractor Onboarding',     version: 'v1.0' },
        { name: 'Manpower utilization',         version: 'v3.2' },
        { name: 'Site safety incident report',  version: 'v1.1' }
      ]
    },
    groups: [
      { name: 'Subcontractor management', count: 6, open: true, elements: [
        { kind: 'leaf', name: 'Subcontractor Onboarding',      version: 'v1.0', icon: 'file-text' },
        { kind: 'pack', name: 'Subcontractor enablement pack', active: true },
        { kind: 'leaf', name: 'Site safety incident report',   version: 'v1.1', icon: 'file-text' }
      ] },
      { name: 'BCA compliance', count: 4, elements: [
        { kind: 'leaf', name: 'BCA Compliance Filing', version: 'v1.2', icon: 'file-text' },
        { kind: 'leaf', name: 'Manpower utilization',  version: 'v3.2', icon: 'file-text' }
      ] },
      { name: 'Site safety',           count: 9, elements: [] },
      { name: 'Materials & deliveries', count: 12, elements: [] },
      { name: 'JTC industrial land',    count: 5, elements: [] },
      { name: 'Audit & disputes',       count: 16, elements: [] }
    ]
  },
  hx: {
    searchHint:  'Search data elements on HealthDex',
    totalCount:  47,
    groupCount:  5,
    headline: {
      kind: 'pack',
      name: 'Clinical referral pack',
      blurb: 'Curated HealthDex pack — flows together when a patient is referred across SingHealth, the screening centre, and the polyclinic. Residency-strict; maintained by HealthDex admins.',
      snapshotLabel: 'Snapshot · 3 elements (deselect any)',
      elements: [
        { name: 'Patient Referral Record',     version: 'v3.0' },
        { name: 'Prescription Dispense Record', version: 'v2.1' },
        { name: 'Diabetic Foot Screening',      version: 'v3.0' }
      ]
    },
    groups: [
      { name: 'Patient records', count: 8, open: true, elements: [
        { kind: 'leaf', name: 'Patient Referral Record', version: 'v3.0', icon: 'file-text' },
        { kind: 'pack', name: 'Clinical referral pack',  active: true }
      ] },
      { name: 'Clinical screening', count: 5, elements: [
        { kind: 'leaf', name: 'Diabetic Foot Screening',         version: 'v3.0', icon: 'file-text' },
        { kind: 'leaf', name: 'Diabetic Retinal Photography',    version: 'v2.1', icon: 'file-text' }
      ] },
      { name: 'Pharmacy & dispensing', count: 3, elements: [
        { kind: 'leaf', name: 'Prescription Dispense Record',    version: 'v2.1', icon: 'file-text' }
      ] },
      { name: 'Lab & imaging',         count: 14, elements: [] },
      { name: 'Public-health surveys', count: 17, elements: [] }
    ]
  }
};

/* ---------- Per-DEX inbox data ----------
   Each DEX records the role the demo operator (Marcus, Cosco-org) holds there.
   Marcus is a participant across all three DEXes but at different per-org role tiers,
   demonstrating how the UI gates by capability. */
const INBOX_BY_DEX = {
  tx: {
    name: 'TradeX',
    count: 12, mineCount: 4, teamCount: 8,
    chip: 'tx',
    userType: 'participant',
    role: 'Admin User',            // can create + accept Agreements, no user mgmt
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Maersk wants to receive Bills of Lading from you', meta: 'Invited 2h ago · waiting on you to accept or decline', btn: 'Review', action: 'review', dir: 'in' },
      { title: 'Your ETA request to PSA — awaiting their decision', meta: 'Sent 4h ago · 30-day window · pending PSA accept · auto-reminder at day 21', btn: 'Open', action: 'open', dir: 'out' },
      { title: 'Extend Agreement with Cosco before 30 Sep', meta: 'Renewal · expires in 9 days · auto-extend disabled', btn: 'Extend 12mo', action: 'extend' }
    ],
    team: [
      { title: 'PSA bunker delivery — 3 contributor enrolments pending', meta: 'Approval · oldest 4h ago · 3 admins eligible', btn: 'Claim' },
      { title: 'Layla approved CrimsonLogic appointment for ABC Logistics', meta: 'Completed 2 min ago · disappears from inbox in 3 min', completion: true },
      { title: 'Review onboarding KYC for Pacific Container Lines', meta: 'Approval · 1d ago · 3 admins eligible', btn: 'Claim' }
    ]
  },
  bx: {
    name: 'BuildEx',
    count: 4, mineCount: 1, teamCount: 3,
    chip: 'bx',
    userType: 'participant',
    role: 'Operation User',        // Pitstop runtime/data ops only — cannot create Agreements
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Concrete pour QC sign-off from JTC due tomorrow', meta: 'Approval · contractor-side · expires in 18h', btn: 'Open', action: 'open' }
    ],
    team: [
      { title: 'Builder safety incident reports — 2 awaiting upload', meta: 'Compliance · oldest 6h ago', btn: 'Claim' },
      { title: 'Layla approved subcontractor onboarding', meta: 'Completed 4 min ago', completion: true }   // Issue 0002 — reattributed from Wei Lin (who is canonically platform-tier per Issue 0004)
    ]
  },
  hx: {
    name: 'HealthDex',
    count: 3, mineCount: 1, teamCount: 2,
    chip: 'hx',
    userType: 'participant',
    role: 'Super Admin',           // org-tier governance: user mgmt + use cases + relationships
    orgName: 'Cosco Shipping',
    mine: [
      { title: 'Annual compliance certificate expires in 14 days', meta: 'Renewal · residency-strict · no grace period', btn: 'Renew', action: 'renew-strict' }
    ],
    team: [
      { title: 'Patient registry data classification review', meta: 'Governance · residency-strict · 2 Super Admins eligible', btn: 'Claim' },
      { title: 'Lab partnership Agreement awaiting compliance sign-off', meta: 'Compliance review · with legal · 24h SLA', btn: 'Open' }
    ]
  }
};

/* ============================================================
   PITSTOPS — multi-Pitstop fixtures
   ============================================================
   Per ADR 0028 (./docs/adr/0028-routing-is-not-an-agreement-property.md):
   a Pitstop is a named operational seat owned by an Org within a DEX,
   backed 1:1 by a deployed pitstop-core instance. The Agreement record
   itself stays Pitstop-free; routing is captured in this parallel scope
   layer that each Org owns unilaterally. The counterparty's Pitstop
   topology is NEVER displayed in the wizard or Agreement detail —
   it surfaces only on per-Message Pitstop chips and the View Delivery
   Trace (post-facto diagnostics). See also docs/audits/2026-05-16-multi-pitstop-routing-audit.md.

   These fixtures power the state-switcher scenarios A–F per PRD
   docs/prds/2026-05-16-multi-pitstop-routing-prd.md §Testing Decisions.
   ============================================================ */

/* ---------- Pitstops per org × DEX ----------
   Each pitstop is one deployed pitstop-core instance. Cosco (the operator's
   own org) demonstrates multi-Pitstop by division on TradeX: SG-Logistics,
   SG-Finance, SG-Trade — plus one retired (SG-Logistics-Old) so scenario E
   has historical Messages to reference. Single-Pitstop on BuildEx/HealthDex
   confirms the "no complexity tax for single-Pitstop users" guarantee. */
const PITSTOPS_BY_ORG = {
  'cosco': [
    { id: 'cosco-tx-ops',     name: 'SG-Logistics',     dexId: 'tx', orgId: 'cosco', retired: false },
    { id: 'cosco-tx-finance', name: 'SG-Finance',       dexId: 'tx', orgId: 'cosco', retired: false },
    { id: 'cosco-tx-trade',   name: 'SG-Trade',         dexId: 'tx', orgId: 'cosco', retired: false },
    { id: 'cosco-tx-old',     name: 'SG-Logistics-Old', dexId: 'tx', orgId: 'cosco', retired: true, retiredAt: '2026-03-04' },
    { id: 'cosco-bx-main',    name: 'BuildEx-Main',     dexId: 'bx', orgId: 'cosco', retired: false },
    { id: 'cosco-hx-main',    name: 'HealthDex-Main',   dexId: 'hx', orgId: 'cosco', retired: false }
  ],
  'psa': [
    { id: 'psa-tx-main', name: 'PSA-TradeX', dexId: 'tx', orgId: 'psa', retired: false }
  ],
  'maersk': [
    { id: 'maersk-sg', name: 'Maersk-Singapore', dexId: 'tx', orgId: 'maersk', retired: false },
    { id: 'maersk-rt', name: 'Maersk-Rotterdam', dexId: 'tx', orgId: 'maersk', retired: false },
    { id: 'maersk-sh', name: 'Maersk-Shanghai',  dexId: 'tx', orgId: 'maersk', retired: false }
  ],
  'crimsonlogic': [
    { id: 'cl-shipping', name: 'CL-Shipping', dexId: 'tx', orgId: 'crimsonlogic', retired: false },
    { id: 'cl-customs',  name: 'CL-Customs',  dexId: 'tx', orgId: 'crimsonlogic', retired: false }
  ],
  // BCA (Building & Construction Authority) — Singapore regulator on SGBuildEx,
  // per the orchestrator seed's `manpower_utilization` element receiving-org list.
  // Single-Pitstop regulator that receives manpower submissions from contractors.
  'bca': [
    { id: 'bca-bx-main', name: 'BCA-Main', dexId: 'bx', orgId: 'bca', retired: false }
  ],
  // TFG Marine — real SGTradEx participant org (per `sgtradextech-organization-dev`
  // seed: "TFG Marine Pte. Ltd"). Bunker supplier; single-Pitstop counterparty for
  // scenario B's first-use capture of Bunker Requisition Form.
  'tfg-marine': [
    { id: 'tfg-tx-main', name: 'TFG-Marine-Main', dexId: 'tx', orgId: 'tfg-marine', retired: false }
  ]
};

/* ---------- Pitstop element scope ----------
   Multi-valued per (orgId, dexId, elementId, direction). Captured inline at
   Agreement creation (the wizard's micro-step); mutable via Settings page.
   M:N permissive — an element may be scoped to multiple Pitstops for failover,
   regional split, load-balancing, or migration windows.

   'bunker-requisition-form' is INTENTIONALLY unscoped on Cosco so scenario B
   demonstrates the inline scope-set capture firing for the first time (Cosco's
   first SGTradEx bunker requisition to TFG Marine). */
const PITSTOP_ELEMENT_SCOPE = {
  'cosco': {
    'tx': {
      // Real SGTradEx elements (sourced from sgtradextech-data-element-dev seed).
      'mass-flow-meter-receipt': { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'vessel-voyage-schedule':  { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'statement-of-facts':      { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'storing-order':           { produces: ['cosco-tx-finance'], consumes: ['cosco-tx-finance'] },
      'mother-vessel-info':      { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] }
      // 'bunker-requisition-form' deliberately unscoped — scenario B captures it inline
    },
    'bx': {
      // Single-Pitstop Org on BuildEx — scope trivial (everything routes through cosco-bx-main).
      // Made explicit so scenario A's resolver returns 1 eligible Pitstop. Real SGBuildEx
      // element per orchestrator seed: manpower_utilization (the only sending element
      // in the BuildEx dev orchestrator rules).
      'manpower-utilization': { produces: ['cosco-bx-main'], consumes: ['cosco-bx-main'] }
    },
    'hx': { /* single-pitstop Org on HealthDex — kept for back-compat with existing inbox fixtures */ }
  },
  'psa': {
    // PSA International — Singapore port operator. Real SGTradEx participant.
    'tx': {
      'mass-flow-meter-receipt': { consumes: ['psa-tx-main'] },
      'vessel-voyage-schedule':  { produces: ['psa-tx-main'], consumes: ['psa-tx-main'] },
      'storing-order':           { consumes: ['psa-tx-main'] }
    }
  },
  'maersk': {
    // Maersk Logistics — global carrier. Real SGTradEx participant.
    'tx': {
      'container-booking':       { produces: ['maersk-sg'], consumes: ['maersk-sg', 'maersk-rt'] },
      'vessel-voyage-schedule':  { consumes: ['maersk-sg', 'maersk-rt', 'maersk-sh'] },
      'statement-of-facts':      { consumes: ['maersk-sg'] }
      // Scenario F mutates statement-of-facts.consumes at runtime to demonstrate degradation
    }
  },
  'crimsonlogic': {
    // CrimsonLogic — real Singapore trade-documents SP. Acts on behalf of carriers
    // (Maersk delegates Container Booking transmission).
    'tx': {
      'container-booking':       { produces: ['cl-shipping', 'cl-customs'] },
      'statement-of-facts':      { produces: ['cl-shipping'] }
    }
  },
  'bca': {
    // BCA (Building & Construction Authority) — Singapore regulator; consumes
    // manpower utilization submissions from contractors on SGBuildEx.
    'bx': {
      'manpower-utilization': { consumes: ['bca-bx-main'] }
    }
  },
  'tfg-marine': {
    // TFG Marine — real SGTradEx bunker supplier. Consumes Bunker Requisition Forms
    // from operators ordering bunker fuel.
    'tx': {
      'bunker-requisition-form': { consumes: ['tfg-tx-main'] }
    }
  }
};

/* ---------- User × Pitstop role assignments ----------
   Cross-Pitstop roles (Org Admin, Auditor, Admin User) carry pitstopId=null
   and inherit access to every Pitstop in the Org's DEX membership.
   Per-Pitstop roles (Pitstop Admin, Operator, Reader) are explicit per-Pitstop.

   Marcus (the demo operator) is Admin User cross-Pitstop on TradeX so he
   exercises the multi-Pitstop chip in scenarios B–F. */
const USER_PITSTOP_ROLES = {
  'marcus': [
    { dexId: 'tx', pitstopId: null,             role: 'Admin User' },
    { dexId: 'bx', pitstopId: 'cosco-bx-main',  role: 'Operation User' },
    { dexId: 'hx', pitstopId: null,             role: 'Super Admin' }
  ],
  'alice': [
    { dexId: 'tx', pitstopId: 'cosco-tx-ops',   role: 'Operation User' },
    { dexId: 'bx', pitstopId: 'cosco-bx-main',  role: 'Operation User' }
  ],
  'david': [
    { dexId: 'tx', pitstopId: 'cosco-tx-finance', role: 'Reader' },
    { dexId: 'hx', pitstopId: null,               role: 'Super Admin' }
  ],
  'sarah': [
    { dexId: 'tx', pitstopId: null,             role: 'SGTradex Admin' }
  ],
  // Pat works at CrimsonLogic — cross-Pitstop Admin User on TradeX so he has access
  // to both cl-shipping and cl-customs (scenario D exercises the "≥2 eligible
  // Pitstops" branch of the resolver).
  'pat': [
    { dexId: 'tx', pitstopId: null,             role: 'Admin User' }
  ]
};

/* ---------- Pitstop activity log ----------
   Powers Settings → Pitstops → Activity. Kept intentionally lightweight in the
   prototype: timeline entries are descriptive enough to explain what changed,
   and mutation helpers append new rows in-memory when scope or retirement state
   changes. */
const PITSTOP_ACTIVITY_LOGS = {
  'cosco-tx-ops': [
    { actorUserId: 'marcus', action: 'confirmed SG-Logistics as the primary dispatch seat for Mass Flow Meter Receipt', time: '21 Mar 2026 · 09:14 SGT' },
    { actorUserId: 'alice',  action: 'was assigned as an Operations User on this Pitstop',                               time: '12 Mar 2026 · 16:05 SGT' },
    { actor: 'System migration', action: 'seeded Vessel Voyage Schedule and Statement of Facts from historical tracking', time: '04 Mar 2026 · 02:10 SGT' }
  ],
  'cosco-tx-finance': [
    { actorUserId: 'marcus', action: 'added Storing Order to produce + consume scope during finance split rollout', time: '18 Mar 2026 · 10:42 SGT' },
    { actorUserId: 'david',  action: 'was granted reader access for month-end dispatch reconciliation',             time: '17 Mar 2026 · 14:18 SGT' }
  ],
  'cosco-tx-trade': [
    { actorUserId: 'marcus', action: 'provisioned SG-Trade for contingency routing', time: '05 Apr 2026 · 11:22 SGT' }
  ],
  'cosco-tx-old': [
    { actorUserId: 'marcus', action: 'soft-retired SG-Logistics-Old after consolidation into SG-Logistics', time: '04 Mar 2026 · 09:00 SGT' }
  ],
  'cosco-bx-main': [
    { actorUserId: 'alice', action: 'confirmed Manpower utilization scope for BuildEx-Main', time: '28 Apr 2026 · 15:06 SGT' }
  ],
  'cosco-hx-main': [
    { actorUserId: 'david', action: 'reviewed residency-strict routing for Patient Referral Record', time: '12 Feb 2026 · 11:20 SGT' }
  ]
};

/* ---------- State-switcher scenarios (PRD §Testing Decisions) ----------
   The Composer / wizard / Messages list expose a state-switcher that cycles
   through these six scenarios to demonstrate the multi-Pitstop design
   without firing real actions. */
let activeMpScenario = 'C'; // default — multi-Pitstop with established scope

const MP_SCENARIOS = {
  'A': {
    label: 'A · Single-Pitstop op',
    detail: 'Cosco\'s construction subsidiary on SGBuildEx, single Pitstop. Submits Manpower utilization to BCA per the orchestrator-seed flow (person_id_no, work_pass_type, trade, employer, attendance — 11 required fields). Chip never appears; wizard stays at 4 steps; UX identical to today.',
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
      dexLabel: 'BuildEx',
      agrId: 'AGR-2026-05103',
      idemKey: 'idem_b21f9a8c',
      complexity: 'high-stakes',
      title: 'Manpower utilization → BCA',
      submitLabel: 'Submit · send to BCA',
      snapshotLine: 'Snapshot v3.2 · captured 18 Mar 2026 at Agreement creation · 11 required fields per BCA submission schema · SGBuildEx · single Pitstop',
      actingAs: null
    }
  },
  'B': {
    label: 'B · First-use capture',
    detail: 'Multi-Pitstop Cosco creates its first Bunker Requisition Form Agreement (with TFG Marine, a real SGTradEx bunker supplier). Cosco hasn\'t routed bunker requisitions before; the wizard\'s inline scope-set step asks which of Cosco\'s 3 Pitstops should produce this element going forward. Multi-select checkboxes — Cosco could pick SG-Logistics for ops, or split across SG-Logistics + SG-Finance for failover.',
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
      dexLabel: 'TradeX',
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
      dexLabel: 'TradeX',
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
      dexLabel: 'TradeX',
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
    detail: 'Cosco sends Vessel Voyage Schedule (real SGTradEx element — vessel arrival window, port-call schedule) to Maersk. SG-Logistics-Old (retired 4 Mar 2026 after the SG-Logistics consolidation) handled vessel-scheduling traffic for ~18 months. Historical Messages still surface its name with a "retired" annotation; new compositions route via the active SG-Logistics Pitstop. Asymmetry rule preserved — Maersk only sees the active Pitstop\'s id on incoming Messages.',
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
      dexLabel: 'TradeX',
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
    detail: 'Cosco sends Statement of Facts (real SGTradEx element — port-call event log signed by master & terminal) to Maersk. Maersk lost consume-scope on their side (their Singapore Pitstop\'s scope-set was edited out, perhaps during a Maersk-internal reorg). Composer form-open shows symmetric-language banner BEFORE payload-fill — copy names only the joint fact, never which Maersk Pitstop changed or when. Asymmetry rule preserved.',
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
      dexLabel: 'TradeX',
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

/* ---------- Per-operator most-recently-used memory ----------
   Per ADR 0028 + CONTEXT.md (Pitstop chip / "Send from"): the Composer chip's default
   pre-fills with the operator's most-recently-used Pitstop for this element +
   direction. Persisted via localStorage in production; mocked here as a plain
   object that the resolver helpers read/write. */
let pitstopMru = {}; // mru[operatorId][elementId][direction] = pitstopId

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
     for BuildEx come from INBOX_BY_DEX.bx fallback today; this entry exists
     so the resolver returns a non-null scope when the active scene asks for
     Alice. Detail screen seed deferred — Alice's scenes get full seeds when
     BX-specific demo content is authored (separate workstream).
     ---------------------------------------------------------- */
  'alice-cosco-bx-C': {
    /* Full seed — replaces the Issue 0010 placeholder.
       Alice operates Cosco Construction's BuildEx Pitstop as an Operation User.
       The three data elements seeded here exercise BuildEx's regulatory + contractor
       surface:
         · Subcontractor Onboarding v1.0  — Cosco ↔ Acme (cross-DEX counterparty)
         · BCA Compliance Filing v1.2     — Cosco ↔ BCA (statutory submission)
         · Manpower utilization v3.2      — Cosco ↔ BCA (real SGBuildEx orchestrator element) */
    detail: {
      agrId:           'AGR-2026-05312',
      dex:             'bx',
      dexLabel:        'BuildEx',
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
        residency:     'Standard · cross-DEX OK with warning (Acme primary is BuildEx)',
        autoRenew:     'On — managed by BCA contractor lifecycle'
      },
      nudge: {
        icon:    'shield-check',
        text:    'Acme is a cross-DEX counterparty (primary BuildEx). Payload validation runs against BCA grade schema before dispatch — Operation Users cannot bypass.',
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

    /* INBOX — Operation User on BuildEx. Mine items are ops-actionable: payload
       validation, dispatch retries, scope sync. No Agreement-creation CTAs. */
    inbox: {
      name: 'BuildEx · Cosco Construction',
      count: 5, mineCount: 2, teamCount: 3,
      chip: 'bx',
      role: 'Operation User',
      orgName: 'Cosco Construction',
      mine: [
        { title: 'Subcontractor Onboarding — Acme payload pending field-level validation', meta: 'Operations · 24 fields × 11 subcontractors · expires in 6h',        btn: 'Open',  action: 'open' },
        { title: 'Concrete pour QC sign-off from JTC due tomorrow',                         meta: 'Approval · contractor-side · expires in 18h',                       btn: 'Open',  action: 'open' }
      ],
      team: [
        { title: 'Builder safety incident reports — 2 awaiting upload',                     meta: 'Compliance · oldest 6h ago',                                        btn: 'Claim' },
        { title: 'Layla approved subcontractor onboarding',                                  meta: 'Completed 4 min ago',                                              completion: true },
        { title: 'Manpower utilization · May submission failed (retry available)',           meta: 'Operations · BCA receiver · 1 of 1 retries remaining',             btn: 'Claim' }
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
      { kind: 'flat', id: 'AGR-2026-05312', cp: { name: 'Acme Construction',   initials: 'AC', role: 'Contractor',         dex: 'BuildEx' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, type: 'Direct',           status: { kind: 'active', label: 'Active' },                  until: '28 Apr 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      // Pack — Subcontractor enablement pack across 3 BX consumers.
      { kind: 'pack-parent', id: 'PACK-2026-0428-BX', name: 'Subcontractor enablement pack', packTag: 'PACK', childCount: 3, cpCount: 3, element: { name: 'Subcontractor enablement pack', summary: '3 elements split' }, type: 'Direct ×3', status: { kind: 'active', label: 'Active (3 of 3)' }, until: '28 Apr 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                          cp: { name: 'Acme Construction',  initials: 'AC', role: 'Contractor',          dex: 'BuildEx' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'BCA',                initials: 'BC', role: 'Regulator',           dex: 'BuildEx' }, element: { name: 'Manpower utilization',     version: 'v3.2' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'JTC Corporation',    initials: 'JT', role: 'Statutory board',     dex: 'BuildEx' }, element: { name: 'Site safety incident report', version: 'v1.1' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '28 Apr 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-05103', cp: { name: 'BCA',                 initials: 'BC', role: 'Regulator',          dex: 'BuildEx' }, element: { name: 'BCA Compliance Filing',     version: 'v1.2' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },               until: 'Renews annually', untilNote: 'BCA regulatory', actions: ['extend'] },
      { kind: 'flat', id: 'AGR-2026-04211', cp: { name: 'BCA',                 initials: 'BC', role: 'Regulator',          dex: 'BuildEx' }, element: { name: 'Manpower utilization',      version: 'v3.2' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },               until: 'Renews annually', untilNote: 'BCA regulatory', actions: ['extend'] },
      { kind: 'flat', id: 'AGR-2025-11008', cp: { name: 'JTC Corporation',     initials: 'JT', role: 'Statutory board',    dex: 'BuildEx' }, element: { name: 'Site safety incident report', version: 'v1.1' }, type: 'Direct',         status: { kind: 'active',  label: 'Active' },               until: '18 May 2027', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-04999', cp: { name: 'Pacific Contracting', initials: 'PC', role: 'Contractor',         dex: 'BuildEx' }, element: { name: 'Subcontractor Onboarding',  version: 'v1.0' }, type: 'Direct',           status: { kind: 'pending', label: 'Pending KYC' },           until: 'Awaiting KYC clearance', actions: ['withdraw'] }
    ],

    /* MESSAGES — three BX data elements across sent/received/failed rows. */
    messages: [
      // New arrival — Subcontractor Onboarding payload just dispatched to Acme.
      { id: 'MSG-BX-1247', dir: 'sent',     newArrival: true, cp: { name: 'Acme Construction', initials: 'AC' }, pitstop: { name: 'BuildEx-Main' }, element: { name: 'Subcontractor Onboarding', version: 'v1.0' }, agreement: 'AGR-2026-05312', status: { kind: 'active',  label: 'Delivered' },     time: 'just now',     actions: ['view'] },
      // BCA Compliance Filing — acknowledged this morning.
      { id: 'MSG-BX-1238', dir: 'sent',                       cp: { name: 'BCA',               initials: 'BC' }, pitstop: { name: 'BuildEx-Main' }, element: { name: 'BCA Compliance Filing',    version: 'v1.2' }, agreement: 'AGR-2026-05103', status: { kind: 'active',  label: 'Acknowledged' },  time: '2h ago',       actions: ['view'] },
      // Manpower utilization — failed · mine (schema validation error on May submission).
      { id: 'MSG-BX-1240', dir: 'sent', failed: true, cp: { name: 'BCA', initials: 'BC' }, pitstop: { name: 'BuildEx-Main' }, element: { name: 'Manpower utilization', version: 'v3.2' }, agreement: 'AGR-2026-04211', status: { kind: 'failed', label: 'Failed', owner: 'mine', errorLine: 'Schema validation failed · field <code>foreignWorkerCount</code> exceeds quota of 350', errorIcon: 'x-circle' }, time: '12 min ago', actions: ['retry'] },
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
       David is Cosco Health Services' HealthDex Super Admin. All three data
       elements are residency-strict (Singapore-only, no grace period):
         · Patient Referral Record v3.0       — Cosco ↔ SingHealth
         · Prescription Dispense Record v2.1  — Cosco ↔ MOH-ESC
         · Diabetic Foot Screening v3.0       — Cosco ↔ Polyclinic Bedok (real element
                                                  per healthdex-ui-proposals/src/data/sharedDataFields.js
                                                  DATA_ELEMENTS array — anchored in dex-monorepo) */
    detail: {
      agrId:           'AGR-2026-05418',
      dex:             'hx',
      dexLabel:        'HealthDex',
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

    /* INBOX — Super Admin on HealthDex. Mine items reflect governance work:
       attestations, residency-strict classification, user management. */
    inbox: {
      name: 'HealthDex · Cosco Health Services',
      count: 6, mineCount: 3, teamCount: 3,
      chip: 'hx',
      role: 'Super Admin',
      orgName: 'Cosco Health Services',
      mine: [
        { title: 'Annual compliance certificate expires in 14 days',                   meta: 'Renewal · residency-strict · no grace period',                                       btn: 'Renew',  action: 'renew-strict' },
        { title: 'Re-attest Patient Referral Record classification with SingHealth',   meta: 'Governance · residency-strict · attestation due 24 May',                            btn: 'Attest', action: 'attest' },
        { title: 'Promote Dr Angela to Operation User on HealthDex',                    meta: 'User management · 1 pending nomination from Polyclinic Bedok',                      btn: 'Open',   action: 'open' }
      ],
      team: [
        { title: 'Patient registry data classification review',                         meta: 'Governance · residency-strict · 2 Super Admins eligible',                            btn: 'Claim' },
        { title: 'Lab partnership Agreement awaiting compliance sign-off',              meta: 'Compliance review · with legal · 24h SLA',                                           btn: 'Claim' },
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
      { kind: 'flat', id: 'AGR-2026-05418', cp: { name: 'SingHealth',          initials: 'SH', role: 'Healthcare cluster',  dex: 'HealthDex' }, element: { name: 'Patient Referral Record', version: 'v3.0' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '12 Feb 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      // Pack — Clinical referral pack across 3 HX consumers.
      { kind: 'pack-parent', id: 'PACK-2026-0212-HX', name: 'Clinical referral pack', packTag: 'PACK', childCount: 3, cpCount: 3, element: { name: 'Clinical referral pack', summary: '3 elements split' }, type: 'Direct ×3', status: { kind: 'active', label: 'Active (3 of 3)' }, until: '12 Feb 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                          cp: { name: 'SingHealth',         initials: 'SH', role: 'Healthcare cluster', dex: 'HealthDex' }, element: { name: 'Patient Referral Record',      version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'MOH Eye Screening Centre', initials: 'ME', role: 'Regulator',     dex: 'HealthDex' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                          cp: { name: 'Polyclinic Bedok',   initials: 'PB', role: 'Polyclinic',         dex: 'HealthDex' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '12 Feb 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-04806', cp: { name: 'MOH Eye Screening Centre', initials: 'ME', role: 'Regulator',     dex: 'HealthDex' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '03 Apr 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-04812', cp: { name: 'Polyclinic Bedok',         initials: 'PB', role: 'Polyclinic',    dex: 'HealthDex' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },                  until: '21 Jun 2027', untilNote: 'annual', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2026-05101', cp: { name: 'KK Women’s & Children’s Hospital', initials: 'KK', role: 'Specialist hospital', dex: 'HealthDex' }, element: { name: 'Patient Referral Record', version: 'v3.0' }, type: 'Direct', status: { kind: 'pending', label: 'Pending attestation' }, until: 'Awaiting governance sign-off', actions: ['withdraw'] }
    ],

    /* MESSAGES — three HX data elements across sent/received/failed/pull rows. */
    messages: [
      // New arrival — Patient Referral Record just sent to SingHealth via HealthDex-Main.
      { id: 'MSG-HX-1418', dir: 'sent',     newArrival: true, cp: { name: 'SingHealth',          initials: 'SH' }, pitstop: { name: 'HealthDex-Main' }, element: { name: 'Patient Referral Record',      version: 'v3.0' }, agreement: 'AGR-2026-05418', status: { kind: 'active',  label: 'Delivered' },     time: 'just now',     actions: ['view'] },
      // Prescription Dispense Record — acknowledged by MOH-ESC.
      { id: 'MSG-HX-1402', dir: 'sent',                       cp: { name: 'MOH Eye Screening Centre', initials: 'ME' }, pitstop: { name: 'HealthDex-Main' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, agreement: 'AGR-2026-04806', status: { kind: 'active',  label: 'Acknowledged' }, time: '1h ago',       actions: ['view'] },
      // Diabetic Foot Screening — received from Polyclinic Bedok (PULL response).
      { id: 'MSG-HX-1408', dir: 'received',                   cp: { name: 'Polyclinic Bedok',    initials: 'PB' }, element: { name: 'Diabetic Foot Screening',      version: 'v3.0' }, agreement: 'AGR-2026-04812', status: { kind: 'active', label: 'Acknowledged' }, time: '3h ago',       actions: ['export'] },
      // Failed · mine — Prescription Dispense Record payload validation issue.
      { id: 'MSG-HX-1410', dir: 'sent', failed: true, cp: { name: 'MOH Eye Screening Centre', initials: 'ME' }, pitstop: { name: 'HealthDex-Main' }, element: { name: 'Prescription Dispense Record', version: 'v2.1' }, agreement: 'AGR-2026-04806', status: { kind: 'failed', label: 'Failed', owner: 'mine', errorLine: 'Residency check failed · payload contains non-Singapore patient identifier <code>SG-MOH-Patient-Id</code>', errorIcon: 'shield-x' }, time: '24 min ago', actions: ['retry'] },
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
     Marcus / Cosco / TradeX / scenario C
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
      dexLabel:        'TradeX',
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
       BuildEx) which the renderer special-cases via `crossDex: true`. */
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
      { kind: 'flat', id: 'AGR-2026-04829', cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'TradeX' }, element: { name: 'Mass Flow Meter Receipt', version: 'v2.4' }, type: 'Direct',           status: { kind: 'active',  label: 'Active' },          until: '30 Sep 2026', untilNote: '9 days',   actions: ['extend', 'revoke'] },
      // Pack — Vessel arrival distribution + 4 members (ADR 0027 split-pack).
      { kind: 'pack-parent', id: 'PACK-2026-0214', name: 'Vessel arrival distribution', packTag: 'PACK', childCount: 4, cpCount: 4, element: { name: 'Vessel arrival pack', summary: '4 elements split' }, type: 'Direct ×4', status: { kind: 'active', label: 'Active (4 of 4)' }, until: '14 Feb 2027', actions: ['send-pack', 'revoke-pack'] },
      { kind: 'pack-member',                       cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'TradeX' }, element: { name: 'ETA',                  version: 'v2.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'Maersk Logistics',      initials: 'Mk', role: 'Carrier',             dex: 'TradeX' }, element: { name: 'Cargo manifest',       version: 'v3.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'ICA Singapore',         initials: 'IC', role: 'Immigration',         dex: 'TradeX' }, element: { name: 'Crew list',            version: 'v1.2' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      { kind: 'pack-member',                       cp: { name: 'Hin Leong Insurance',   initials: 'HL', role: 'Insurance broker',    dex: 'TradeX' }, element: { name: 'Vessel particulars',   version: 'v1.0' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '14 Feb 2027', actions: ['extend'] },
      // Other flat rows
      { kind: 'flat', id: 'AGR-2026-04955', cp: { name: 'PSA International',     initials: 'PS', role: 'Port operator',       dex: 'TradeX' }, element: { name: 'Bunker delivery confirmation', version: '' }, type: { label: 'Service-Provider', tooltip: 'Appointed via CrimsonLogic' }, status: { kind: 'pending', label: 'Pending' }, until: 'Awaiting acceptance', actions: ['withdraw'] },
      { kind: 'flat', id: 'AGR-2025-08712', cp: { name: 'CrimsonLogic',          initials: 'CL', role: 'Service provider',    dex: 'TradeX' }, element: { name: 'Cargo manifest', version: 'v3.0' }, type: 'Service-Provider', status: { kind: 'active', label: 'Active' }, until: '22 Aug 2027', actions: ['extend', 'revoke'] },
      { kind: 'flat', id: 'AGR-2025-04412', cp: { name: 'Pacific Lines',         initials: 'PL', role: 'Carrier',             dex: 'TradeX' }, element: { name: 'Bill of Lading', version: 'v2.0' }, type: 'Direct', status: { kind: 'ended',   label: 'Ended · revoked' }, until: 'Ended 28 Mar 2026', actions: ['view-audit'] },
      { kind: 'flat', id: 'AGR-2026-04501', cp: { name: 'ABC Logistics',         initials: 'AB', role: 'Shipper',             dex: 'TradeX' }, element: { name: 'Certificate of origin', version: 'v1.4' }, type: 'Direct', status: { kind: 'active', label: 'Active' }, until: '15 Dec 2026', actions: ['extend', 'revoke'] }
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
     marcus-cosco-tx-A — single-Pitstop op on SGBuildEx
     Cosco's construction subsidiary submits Manpower utilization to BCA.
     Source: MP_SCENARIOS['A'].display + extrapolation for parties / timeline.
     ---------------------------------------------------------- */
  'marcus-cosco-tx-A': {
    detail: {
      agrId:           'AGR-2026-05103',
      dex:             'bx',
      dexLabel:        'BuildEx',
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
      dexLabel:        'TradeX',
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
      dexLabel:        'TradeX',
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
       as TradeX since CrimsonLogic operates exclusively on TX in this prototype. */
    inbox: {
      name: 'TradeX · CrimsonLogic SP',
      count: 6, mineCount: 3, teamCount: 3,
      chip: 'tx',
      role: 'Admin User',
      orgName: 'CrimsonLogic',
      mine: [
        { title: 'Confirm 12 Container Booking transmissions to Cosco — manifest mismatch flagged', meta: 'Acting as Maersk · CL-Shipping · 2 of 14 manifests flagged · awaiting your review', btn: 'Review', action: 'review-transmission', dir: 'out' },
        { title: 'Maersk requested SP appointment for Statement of Facts', meta: 'New SP delegation · authorisation drafted by Maersk · expires in 5 days', btn: 'Accept', action: 'accept-sp-appt' },
        { title: 'CL-Customs scope-set update for Container Booking', meta: 'Routing change · 3 carriers affected · regulatory window closes in 48h', btn: 'Open', action: 'open-scope-update' }
      ],
      team: [
        { title: 'Hapag-Lloyd onboarding for Container Booking transmission', meta: 'New carrier · awaiting CL-Shipping setup · 4 SP-operators eligible', btn: 'Claim' },
        { title: 'Aldous accepted ONE Line SP appointment', meta: 'Completed 8 min ago · disappears from inbox in 3 min', completion: true },
        { title: 'Quarterly SP audit — pending CL-Customs sign-off', meta: 'Audit · oldest 1d ago · 2 SP-operators eligible', btn: 'Claim' }
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
      dexLabel:        'TradeX',
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
      dexLabel:        'TradeX',
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
