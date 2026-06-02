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
  cpDetail: 'Carrier · UEN 200512345R · SGTradex · Ready for B/L sharing',
  sp: null,
  spDetail: null,
  direction: 'send',
  crossDex: false,
  duration: 12,
  residency: 'standard'
};

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
  cosco:        { name: 'Cosco Shipping',     short: 'Cosco',        initials: 'Cs', tier: 'participant', primaryDexId: 'tx', legalName: 'Cosco Shipping (SG) Pte Ltd', uen: '199001234A' },
  crimsonlogic: { name: 'CrimsonLogic',       short: 'CrimsonLogic', initials: 'CL', tier: 'participant', primaryDexId: 'tx' },
  // 'SGTradex' (capital D) is a literal carryover from the prior PERSONAS literal to
  // keep profile-row + "View as…" display strings byte-identical through Phase 1.
  // The workspace pill says 'SGTradex Platform' independently (set in applyPersonaChrome).
  // Platform tier has no primaryDexId — SGTradex governs all DEXes.
  sgtradex:     { name: 'SGTradex',            short: 'SGTradex',     initials: 'SG', tier: 'platform' },
  // Counterparty orgs (referenced by seeds; never directly logged-in in this prototype
  // until Issues 0005-0007 land counterparty users).
  maersk:       { name: 'Maersk Logistics',   short: 'Maersk',       initials: 'Mk', tier: 'participant', primaryDexId: 'tx' },
  psa:          { name: 'PSA International',  short: 'PSA',          initials: 'PS', tier: 'participant', primaryDexId: 'tx' },
  bca:          { name: 'BCA',                short: 'BCA',          initials: 'BC', tier: 'regulator',   primaryDexId: 'tx' },
  'tfg-marine': { name: 'TFG Marine',         short: 'TFG Marine',   initials: 'TF', tier: 'participant', primaryDexId: 'tx' },
  acme:         { name: 'Acme Construction Pte Ltd', short: 'Acme', initials: 'AC', tier: 'participant', primaryDexId: 'bx' },  // Issue 0007 — BX-primary; cross-DEX on TX

  /* ---------- BX/HX counterparty orgs (added for Bea + David scenes) ----------
     Anchored in the dex-monorepo:
       · JTC          — statutory board for industrial land; consumes manpower + safety on SGBuildex
       · SingHealth   — Singapore healthcare cluster; data consumer on SGHealthdex
       · MOH-ESC      — MOH Eye Screening Centre (real participant per healthdex-ui-proposals/src/data/sharedDataFields.js)
       · Polyclinic-Bedok — Polyclinic A (Bedok) (real participant per healthdex-ui-proposals/src/data/sharedDataFields.js) */
  jtc:                { name: 'JTC Corporation',           short: 'JTC',           initials: 'JT', tier: 'regulator',   primaryDexId: 'bx' },
  singhealth:         { name: 'SingHealth',                short: 'SingHealth',    initials: 'SH', tier: 'participant', primaryDexId: 'hx' },
  'moh-esc':          { name: 'MOH Eye Screening Centre',  short: 'MOH-ESC',       initials: 'ME', tier: 'regulator',   primaryDexId: 'hx' },
  'polyclinic-bedok': { name: 'Polyclinic Bedok',          short: 'Polyclinic-Bedok', initials: 'PB', tier: 'participant', primaryDexId: 'hx' },
  // Work-injury compensation insurer participating on SGHealthdex — receives
  // GATIOD-aligned medical reports from clinics under standing Agreements.
  'income-insurance': { name: 'Income Insurance Limited',  short: 'Income Insurance', initials: 'II', tier: 'participant', primaryDexId: 'hx' },

  /* ---------- Cameo counterparty orgs ----------
     Referenced by seeds in SCENE_SEEDS (inbox blurbs, agreements, messages) but
     never logged-in. Promoted to first-class ORGS entries so the workspace's
     name → orgId resolver (workspace-bootstrap.resolveCounterpartyOrgId) can
     bind every Agreement and Message to a real org record. */
  'abc-logistics':       { name: 'ABC Logistics',                       short: 'ABC Logistics',       initials: 'AB', tier: 'participant', primaryDexId: 'tx' },
  'hin-leong':           { name: 'Hin Leong Insurance',                 short: 'Hin Leong',           initials: 'HL', tier: 'participant', primaryDexId: 'tx' },
  'ica':                 { name: 'ICA Singapore',                       short: 'ICA',                 initials: 'IC', tier: 'regulator',   primaryDexId: 'tx' },
  'kkh':                 { name: 'KK Women’s & Children’s Hospital',    short: 'KKH',                 initials: 'KK', tier: 'participant', primaryDexId: 'hx' },
  'pacific-contracting': { name: 'Pacific Contracting Pte Ltd',         short: 'Pacific Contracting', initials: 'PC', tier: 'participant', primaryDexId: 'bx' },
  'pacific-lines':       { name: 'Pacific Lines',                       short: 'Pacific Lines',       initials: 'PL', tier: 'participant', primaryDexId: 'tx' }
};

/* USERS — primaryOrgId is the rendering anchor for chrome when multiple
   affiliations exist. Sparse today (every user has exactly one active affiliation);
   the field is the future-proof. The retired `orgId` field is no longer present —
   call sites must derive org via the active affiliation (or read PERSONAS[].orgId
   from the adapter, which does the derivation centrally). */
const USERS = {
  // Marcus is the canonical demo operator — keep as-is.
  marcus: { name: 'Marcus Ong', email: 'marcus.ong@cosco.com.sg',  initials: 'MO', primaryOrgId: 'cosco',        personaType: 'participant' },

  // Other personas use realistic Singapore-context first names. userId tokens
  // (`bea`, `david`, …) match the display name so SCENE_SEEDS keys, affiliation
  // keys, and display fields (`name` / `email` / `initials`) all stay aligned.
  bea:  { name: 'Bea',      email: 'bea@cosco.com.sg',            initials: 'BE', primaryOrgId: 'cosco',        personaType: 'participant' },  // Issue 0002 — Cosco BX operator
  david:  { name: 'David',   email: 'david@cosco.com.sg',         initials: 'DV', primaryOrgId: 'cosco',        personaType: 'participant' },  // Issue 0003 — Cosco HX Super Admin
  wenchen:{ name: 'Wen Chen',   email: 'wenchen@globalpsa.com',        initials: 'WC', primaryOrgId: 'psa',          personaType: 'participant' },  // Issue 0005 — PSA TX admin
  lars:   { name: 'Lars',    email: 'lars@maersk.com',            initials: 'LR', primaryOrgId: 'maersk',       personaType: 'participant' },  // Issue 0006 — Maersk TX admin
  boonkeng:{ name: 'Boon Keng',    email: 'boonkeng@acme-co.com',            initials: 'BK', primaryOrgId: 'acme',         personaType: 'participant' },  // Issue 0007 — Acme BX admin
  pat:    { name: 'Pat',       email: 'pat@crimsonlogic.com',         initials: 'PT', primaryOrgId: 'crimsonlogic', personaType: 'participant' },  // CrimsonLogic SP-operator
  sarah:  { name: 'Sarah',     email: 'sarah@sgtradex.com',           initials: 'SA', primaryOrgId: 'sgtradex',     personaType: 'platform-admin' }, // SGTradex Admin
  weilin: { name: 'Wei Lin',     email: 'weilin@sgtradex.com',           initials: 'WL', primaryOrgId: 'sgtradex',     personaType: 'platform-admin' }, // Issue 0004 — platform teammate
  diane:  { name: 'Diane',    email: 'diane@sgtradex.com',          initials: 'DI', primaryOrgId: 'sgtradex',     personaType: 'platform-admin' }, // SGBuildex-focused platform admin  — the same Diane Lim named as the BD contact in env-site-obs Confluence fixtures (ADR 0040 Slice 1 canned-response)

  /* BX/HX primary contacts on the counterparty side — surface in participants
     directory + activity log via ADR 0031's actorUserId dispatch rule.
     The three SGHealthdex counterparts use healer-archetype MLBB heroes (Priya /
     Rosalind / Joshua) to keep the clinical tone, prefixed with "Dr". */
  kelvin:  { name: 'Kelvin',       email: 'kelvin@jtc.gov.sg',            initials: 'KW', primaryOrgId: 'jtc',              personaType: 'participant' },  // JTC inspector — BX counterparty primary contact
  priya:   { name: 'Dr Priya',    email: 'priya@singhealth.com.sg',     initials: 'PR', primaryOrgId: 'singhealth',       personaType: 'participant' },  // SingHealth admin — HX counterparty primary contact
  rosalind:    { name: 'Dr Rosalind',  email: 'rosalind@moh.gov.sg',          initials: 'RO', primaryOrgId: 'moh-esc',          personaType: 'participant' },  // MOH-ESC compliance lead — HX
  joshua:  { name: 'Dr Joshua',   email: 'joshua@polyclinic-bedok.sg',  initials: 'JO', primaryOrgId: 'polyclinic-bedok', personaType: 'participant' }   // Polyclinic Bedok lead — HX
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

   Issues 0002 + 0003 strip Marcus's BX and HX seats — Bea picks up BX, David picks up HX.
   Marcus is now Cosco's TX-only operator. */
const USER_ORG_AFFILIATIONS = {
  'marcus-cosco': {
    status:    'active',
    startDate: '2024-03-14',                             // Issue 0011 — surfaced via Settings → "User since"
    dexRoles:  { tx: 'Admin User' },                     // BX (Issue 0002) + HX (Issue 0003) stripped
    dexJoinDates: { tx: '2024-03-14' }                   // Per-DEX role start; surfaced in Settings → Roles by DEX
  },
  'bea-cosco': {                                       // Issue 0002 — Cosco BX operator
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
    dexRoles:  { tx: 'Admin User' }            // SP-side; only SGTradex in this prototype
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
  'diane-sgtradex': {                          // SGBuildex-focused platform admin — third peer to Sarah / Wei Lin.
    status:       'active',                    // Same governance scope (canManageDataElements on every DEX
    startDate:    '2023-06-12',                // per ADR 0001 + ADR 0040 §15); demos can present her as the
    platformRole: 'SGTradex Admin'             // BX face on /portal/bx/ when ADR 0030's rail resolver gains
  },                                           // DEX-aware platform-admin disambiguation.

  /* BX/HX counterparty primary-contact affiliations (added for Bea + David scenes). */
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
  'rosalind-moh-esc': {                            // MOH-ESC compliance lead — HX counterparty primary contact
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
   Marcus has BX/HX seats; they will outlast Marcus's strip (Bea and David
   inherit them). */
const ORG_DEX_MEMBERSHIPS = {
  'cosco-tx':           { joinedDate: '2023-08-22', status: 'active' },
  'cosco-bx':           { joinedDate: '2024-09-14', status: 'active' },
  'cosco-hx':           { joinedDate: '2025-01-10', status: 'active' },
  'crimsonlogic-tx':    { joinedDate: '2024-11-11', status: 'active' },
  'psa-tx':             { joinedDate: '2022-06-15', status: 'active' },  // Issue 0005 — PSA counterparty
  'maersk-tx':          { joinedDate: '2024-03-14', status: 'active' },  // Issue 0006 — Maersk counterparty
  'acme-bx':            { joinedDate: '2024-11-04', status: 'active' },  // Issue 0007 — Acme's primary DEX
  'acme-tx':            { joinedDate: '2026-04-12', status: 'active' },  // Issue 0007 — Acme cross-DEX onto SGTradex

  /* BX/HX counterparty memberships (added for Bea + David scenes). */
  'jtc-bx':                  { joinedDate: '2023-05-18', status: 'active' },  // JTC — BX statutory consumer of manpower + safety data
  'singhealth-hx':           { joinedDate: '2024-02-12', status: 'active' },  // SingHealth — HX referral consumer
  'moh-esc-hx':              { joinedDate: '2024-04-03', status: 'active' },  // MOH-ESC — HX clinical-imaging regulator
  'polyclinic-bedok-hx':     { joinedDate: '2024-06-21', status: 'active' }   // Polyclinic Bedok — HX screening submitter
  // PCL pending membership lands when the platform-admin onboarding demo is wired.
  // SGTradex is platform tier — has no DEX memberships (it governs every DEX).
};

/* ---------- Role scope descriptions ----------
   Per-role human-readable scope summary surfaced by the Settings → Roles by DEX
   hydrator (Issue 0011 stage 1c). Keyed by the role string from
   USER_ORG_AFFILIATIONS.dexRoles or platformRole. Adding a new role? Add a
   description here so the row reads "Role · scope · joined date". Missing
   keys gracefully drop the middle clause. */
const ROLE_SCOPE_DESCRIPTIONS = {
  'Admin User':       'can create Agreements + manage relationships',
  'Operation User':   'Pitstop runtime + data ops only',
  'Super Admin':      'governance + user management within Cosco',
  'Reader':           'read-only access to scoped Pitstops',
  'SGTradex Admin':   'platform-tier governance · cross-DEX scope'
};

const PERSONA_TO_USER = {
  'participant':    'marcus',
  'platform-admin': 'sarah',
  'sp-operator':    'pat'
};

/* DEX-aware platform-admin disambiguation (ADR 0030 amendment, 2026-05-21).
 *
 * Previously the rail resolved 'platform-admin' to Sarah on every URL DEX
 * (per ADR 0030 Table). That worked but produced jarring chrome — Sarah's
 * org reads "SGTradex" on /portal/bx/. With Diane (Diane) added as a
 * SGBuildex-focused platform admin, the rail can now present a DEX-coherent
 * face per URL DEX. Falls back to PERSONA_TO_USER['platform-admin'] when no
 * entry is configured for a DEX. */
const PLATFORM_ADMIN_BY_DEX = {
  tx: 'sarah',     // Sarah — historical default
  bx: 'diane',     // Diane — SGBuildex platform admin, closes loop with env-site-obs Confluence fixture
  hx: 'sarah'      // Sarah — no HX-specific platform admin yet; falls through to Sarah
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
   A user can hold different roles on different DEXes (e.g. Admin User on SGTradex, Operation User on SGBuildex).
*/
/* `canManageDataElements` (added 2026-05-20 per ADR 0039) supersedes the legacy
   admin-corev2 capability `canPromoteDataElement`. Two-line story:
     - Legacy model: only Super SGTradex Admin "publishes Data Elements"
       (canPromoteDataElement). The capability existed in this table but had
       zero usages in portal-app — it was a stub awaiting the registration UX.
     - New model (ADR 0039): element registration is unified Sarah-class
       governance, surfaced as +New element / +New version / +New pack CTAs on
       the Data elements catalogue page. Both platform-tier roles hold it.
   Capability gates the registration flow's CTAs (per ADR 0039 sub-decision 13)
   but does NOT gate catalogue viewing (sidebar "Data elements" item stays open
   to everyone per app.js:7995 "Read-only reference for everyone"). */
const ROLE_CAPABILITIES = {
  // ADR 0048 (2026-05-30 amendment) — canInviteParticipant gates the org-tier
  // "+ Invite participant" CTA on Participants header (the peer-invite affordance,
  // previously ungated — Etr/Operation/Tech Users could see it). canManageNetworks
  // gates the platform-tier "+ Onboard new org" CTA (the workbook upload flow).
  // The two are mutually exclusive at the persona level — no role carries both.
  'Super SGTradex Admin': { tier: 'platform', canCreateAgreement: true,  canManageUsers: true,  canManageDataElements: true,  canManageNetworks: true,  canInviteParticipant: false, opsOnly: false, label: 'Super SGTradex Admin' },
  'SGTradex Admin':       { tier: 'platform', canCreateAgreement: false, canManageUsers: true,  canManageDataElements: true,  canManageNetworks: true,  canInviteParticipant: false, opsOnly: false, label: 'SGTradex Admin' },
  'Super Admin':          { tier: 'org',      canCreateAgreement: true,  canManageUsers: true,  canManageDataElements: false, canManageNetworks: false, canInviteParticipant: true,  opsOnly: false, label: 'Super Admin' },
  'Admin User':           { tier: 'org',      canCreateAgreement: true,  canManageUsers: false, canManageDataElements: false, canManageNetworks: false, canInviteParticipant: true,  opsOnly: false, label: 'Admin User' },
  'Operation User':       { tier: 'org',      canCreateAgreement: false, canManageUsers: false, canManageDataElements: false, canManageNetworks: false, canInviteParticipant: false, opsOnly: true,  label: 'Operation User' },
  'Tech User':            { tier: 'org',      canCreateAgreement: false, canManageUsers: false, canManageDataElements: false, canManageNetworks: false, canInviteParticipant: false, opsOnly: false, label: 'Tech User' },
  'Etr User':             { tier: 'org',      canCreateAgreement: true,  canManageUsers: false, canManageDataElements: false, canManageNetworks: false, canInviteParticipant: false, opsOnly: false, label: 'Etr User' }
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
    searchHint:  'Search data elements on SGTradex',
    totalCount:  189,
    groupCount:  12,
    headline: {
      kind: 'pack',
      id: 'vessel-arrival',
      name: 'Vessel arrival pack',
      blurb: 'Curated Data element pack — flows together when a vessel arrives. Maintained by SGTradex admins.',
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
        { kind: 'leaf', id: 'bill-of-lading', name: 'Bill of Lading',        version: 'v2.1', icon: 'file-text' },
        { kind: 'pack', id: 'vessel-arrival', name: 'Vessel arrival pack',   active: true },
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
    searchHint:  'Search data elements on SGBuildex',
    totalCount:  52,
    groupCount:  6,
    headline: {
      kind: 'pack',
      name: 'Subcontractor enablement pack',
      blurb: 'Curated SGBuildex pack — flows together when a contractor is onboarded across BCA, JTC, and the prime contractor. Maintained by SGBuildex admins.',
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
    searchHint:  'Search data elements on SGHealthdex',
    totalCount:  47,
    groupCount:  5,
    headline: {
      kind: 'pack',
      name: 'Clinical referral pack',
      blurb: 'Curated SGHealthdex pack — flows together when a patient is referred across SingHealth, the screening centre, and the polyclinic. Residency-strict; maintained by SGHealthdex admins.',
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

/* ---------- Fork-source schemas for the registration "Start from existing" on-ramp ----------
   Per ADR 0039 sub-decision 3 + 10. The catalogue list at DATA_ELEMENTS_BY_DEX
   above carries names + versions but not the actual schemas — for the prototype
   we keep the canonical schemas for a handful of demoable elements here so the
   Start-from-existing on-ramp (and the +New version flow) has plausible content
   to fork from. Elements not listed here fork with a single placeholder field
   and a banner naming the limitation — honest framing per ADR 0039 §10.

   Shape: { elementId: { name, latestVersion, fields: [...] } }
   Field shape mirrors the field-builder's in-memory model (register-element.js):
     { name, type, required, description?, validation?, examples? }
   regBuildPublishArtifacts() in register-element.js serialises these to the
   publish bundle (elementSchema + uiSchema + uiRules + authoringMetadata);
   fieldsFromSchema(elementSchema, bundle) is the import path. */
const FORK_SOURCE_SCHEMAS = {
  'bill-of-lading': {
    name: 'Bill of Lading',
    latestVersion: 'v2.1',
    fields: [
      { name: 'bl_number',          type: 'string', required: true,  description: 'Bill of Lading reference number', validation: { pattern: '^[A-Z]{4}\\d{7}$' }, examples: ['MAEU1234567'] },
      { name: 'shipper',            type: 'string', required: true,  description: 'Shipper organisation name' },
      { name: 'consignee',          type: 'string', required: true,  description: 'Consignee organisation name' },
      { name: 'notify_party',       type: 'string', required: false, description: 'Notify party (optional)' },
      { name: 'vessel_name',        type: 'string', required: true,  description: 'Carrying vessel' },
      { name: 'voyage_number',      type: 'string', required: true,  description: 'Voyage reference' },
      { name: 'port_of_loading',    type: 'string', required: true,  description: 'UN/LOCODE port of loading' },
      { name: 'port_of_discharge',  type: 'string', required: true,  description: 'UN/LOCODE port of discharge' },
      { name: 'date_of_issue',      type: 'date',   required: true,  description: 'B/L issue date' },
      { name: 'goods_description',  type: 'string', required: true,  description: 'Cargo description' },
      { name: 'gross_weight_kg',    type: 'number', required: true,  description: 'Gross weight in kg',     validation: { minimum: 0 } },
      { name: 'measurement_cbm',    type: 'number', required: false, description: 'Volume in cubic metres', validation: { minimum: 0 } },
      { name: 'freight_terms',      type: 'enum',   required: true,  description: 'Freight payment terms',  validation: { enumValues: ['PREPAID', 'COLLECT'] } }
    ]
  },
  'cargo-manifest': {
    name: 'Cargo manifest',
    latestVersion: 'v3.0',
    fields: [
      { name: 'manifest_id',        type: 'string', required: true,  description: 'Manifest reference' },
      { name: 'vessel_name',        type: 'string', required: true,  description: 'Carrying vessel' },
      { name: 'voyage_number',      type: 'string', required: true,  description: 'Voyage reference' },
      { name: 'eta',                type: 'datetime', required: true, description: 'Estimated time of arrival (ISO 8601)' },
      { name: 'port_of_arrival',    type: 'string', required: true,  description: 'UN/LOCODE port of arrival' },
      { name: 'total_containers',   type: 'integer', required: true, description: 'Number of containers',   validation: { minimum: 0 } },
      { name: 'total_gross_weight', type: 'number', required: true,  description: 'Total gross weight (kg)' },
      { name: 'line_items_count',   type: 'integer', required: true, description: 'Number of cargo line items' }
    ]
  },
  'eta': {
    name: 'ETA',
    latestVersion: 'v2.0',
    fields: [
      { name: 'vessel_imo',         type: 'string', required: true,  description: 'IMO vessel identifier',  validation: { pattern: '^\\d{7}$' } },
      { name: 'voyage_number',      type: 'string', required: true,  description: 'Voyage reference' },
      { name: 'destination_port',   type: 'string', required: true,  description: 'UN/LOCODE destination port' },
      { name: 'estimated_arrival',  type: 'datetime', required: true, description: 'Estimated arrival (ISO 8601)' },
      { name: 'confidence',         type: 'enum',   required: false, description: 'Confidence level',       validation: { enumValues: ['HIGH', 'MEDIUM', 'LOW'] } }
    ]
  },
  'concrete-cube-test': {
    name: 'Concrete cube test',
    latestVersion: 'v1.0',
    fields: [
      { name: 'project_reference',  type: 'string', required: true,  description: 'BCA project reference number', validation: { pattern: '^[A-Z]{3}-\\d{6}$' }, examples: ['BCA-202601'] },
      { name: 'sample_date',        type: 'date',   required: true,  description: 'Date sample was cast' },
      { name: 'test_date',          type: 'date',   required: true,  description: 'Date sample was tested' },
      { name: 'location',           type: 'string', required: true,  description: 'Site location reference' },
      { name: 'cube_id',            type: 'string', required: true,  description: 'Cube specimen identifier' },
      { name: 'compressive_strength_mpa', type: 'number', required: true, description: 'Compressive strength (MPa)', validation: { minimum: 0, maximum: 200 } },
      { name: 'grade',              type: 'enum',   required: true,  description: 'Concrete design grade',  validation: { enumValues: ['C20', 'C25', 'C30', 'C40', 'C50', 'C60'] } },
      { name: 'tester_signature',   type: 'string', required: true,  description: 'Tester certifying signature' }
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
   own org) demonstrates multi-Pitstop by division on SGTradex: SG-Logistics,
   SG-Finance, SG-Trade — plus one retired (SG-Logistics-Old) so scenario E
   has historical Messages to reference. Single-Pitstop on SGBuildex/SGHealthdex
   confirms the "no complexity tax for single-Pitstop users" guarantee. */
/* userCount + elementsScopedCount are the values surfaced by the Settings →
   Other DEX memberships hydrator (Issue 0011 stage 1b). They live on the
   record so chrome can derive from data — the prototype keeps the demo-
   flavoured larger numbers (6 / 12, 4 / 8) here rather than counting users
   from the small test fixture (USER_PITSTOP_ROLES has only a handful of
   demo users; truth-counting would render "1 user" which misrepresents a
   production Pitstop). */
const PITSTOPS_BY_ORG = {
  'cosco': [
    { id: 'cosco-tx-ops',     name: 'SG-Logistics',     dexId: 'tx', orgId: 'cosco', retired: false, userCount: 14, elementsScopedCount: 18 },
    { id: 'cosco-tx-finance', name: 'SG-Finance',       dexId: 'tx', orgId: 'cosco', retired: false, userCount: 8,  elementsScopedCount: 7 },
    { id: 'cosco-tx-trade',   name: 'SG-Trade',         dexId: 'tx', orgId: 'cosco', retired: false, userCount: 5,  elementsScopedCount: 4 },
    { id: 'cosco-tx-old',     name: 'SG-Logistics-Old', dexId: 'tx', orgId: 'cosco', retired: true, retiredAt: '2026-03-04', userCount: 0, elementsScopedCount: 0 },
    { id: 'cosco-bx-main',    name: 'SGBuildex-Main',     dexId: 'bx', orgId: 'cosco', retired: false, userCount: 6, elementsScopedCount: 12 },
    { id: 'cosco-hx-main',    name: 'SGHealthdex-Main',   dexId: 'hx', orgId: 'cosco', retired: false, userCount: 4, elementsScopedCount: 8 }
  ],
  'psa': [
    { id: 'psa-tx-main', name: 'PSA-SGTradex', dexId: 'tx', orgId: 'psa', retired: false }
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
  // BCA (Building & Construction Authority) — Singapore regulator on SGSGBuildex,
  // per the orchestrator seed's `manpower_utilization` element receiving-org list.
  // Single-Pitstop regulator that receives manpower submissions from contractors.
  'bca': [
    { id: 'bca-bx-main', name: 'BCA-Main', dexId: 'bx', orgId: 'bca', retired: false }
  ],
  // TFG Marine — real SGTradex participant org (per `sgtradextech-organization-dev`
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
   first SGTradex bunker requisition to TFG Marine). */
const PITSTOP_ELEMENT_SCOPE = {
  'cosco': {
    'tx': {
      // Real SGTradex elements (sourced from sgtradextech-data-element-dev seed).
      'mass-flow-meter-receipt': { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'vessel-voyage-schedule':  { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'statement-of-facts':      { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] },
      'storing-order':           { produces: ['cosco-tx-finance'], consumes: ['cosco-tx-finance'] },
      'mother-vessel-info':      { produces: ['cosco-tx-ops'],     consumes: ['cosco-tx-ops'] }
      // 'bunker-requisition-form' deliberately unscoped — scenario B captures it inline
    },
    'bx': {
      // Single-Pitstop Org on SGBuildex — scope trivial (everything routes through cosco-bx-main).
      // Made explicit so scenario A's resolver returns 1 eligible Pitstop. Real SGSGBuildex
      // element per orchestrator seed: manpower_utilization (the only sending element
      // in the SGBuildex dev orchestrator rules).
      'manpower-utilization': { produces: ['cosco-bx-main'], consumes: ['cosco-bx-main'] }
    },
    'hx': { /* single-pitstop Org on SGHealthdex — kept for back-compat with existing inbox fixtures */ }
  },
  'psa': {
    // PSA International — Singapore port operator. Real SGTradex participant.
    'tx': {
      'mass-flow-meter-receipt': { consumes: ['psa-tx-main'] },
      'vessel-voyage-schedule':  { produces: ['psa-tx-main'], consumes: ['psa-tx-main'] },
      'storing-order':           { consumes: ['psa-tx-main'] }
    }
  },
  'maersk': {
    // Maersk Logistics — global carrier. Real SGTradex participant.
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
    // manpower utilization submissions from contractors on SGSGBuildex.
    'bx': {
      'manpower-utilization': { consumes: ['bca-bx-main'] }
    }
  },
  'tfg-marine': {
    // TFG Marine — real SGTradex bunker supplier. Consumes Bunker Requisition Forms
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

   Marcus (the demo operator) is Admin User cross-Pitstop on SGTradex so he
   exercises the multi-Pitstop chip in scenarios B–F. */
const USER_PITSTOP_ROLES = {
  'marcus': [
    { dexId: 'tx', pitstopId: null,             role: 'Admin User' },
    { dexId: 'bx', pitstopId: 'cosco-bx-main',  role: 'Operation User' },
    { dexId: 'hx', pitstopId: null,             role: 'Super Admin' }
  ],
  'bea': [
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
  // Pat works at CrimsonLogic — cross-Pitstop Admin User on SGTradex so he has access
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
    { actorUserId: 'bea',  action: 'was assigned as an Operations User on this Pitstop',                               time: '12 Mar 2026 · 16:05 SGT' },
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
    { actorUserId: 'bea', action: 'confirmed Manpower utilization scope for SGBuildex-Main', time: '28 Apr 2026 · 15:06 SGT' }
  ],
  'cosco-hx-main': [
    { actorUserId: 'david', action: 'reviewed residency-strict routing for Patient Referral Record', time: '12 Feb 2026 · 11:20 SGT' }
  ]
};


/* ---------- Per-operator most-recently-used memory ----------
   Per ADR 0028 + CONTEXT.md (Pitstop chip / "Send from"): the Composer chip's default
   pre-fills with the operator's most-recently-used Pitstop for this element +
   direction. Persisted via localStorage in production; mocked here as a plain
   object that the resolver helpers read/write. */
let pitstopMru = {}; // mru[operatorId][elementId][direction] = pitstopId

