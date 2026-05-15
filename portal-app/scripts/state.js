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
      { title: 'Alice approved CrimsonLogic appointment for ABC Logistics', meta: 'Completed 2 min ago · disappears from inbox in 3 min', completion: true },
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
      { title: 'Wei Lin approved subcontractor onboarding', meta: 'Completed 4 min ago', completion: true }
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
