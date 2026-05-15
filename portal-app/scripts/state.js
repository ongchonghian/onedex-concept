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

/* ---------- Per-DEX inbox data ---------- */
const INBOX_BY_DEX = {
  tx: {
    name: 'TradeX',
    count: 13, mineCount: 5, teamCount: 8,
    chip: 'tx',
    role: 'Admin',
    mine: [
      { title: 'Maersk wants to receive Bills of Lading from you', meta: 'Invited 2h ago · waiting on you to accept or decline', btn: 'Review', action: 'review', dir: 'in' },
      { title: 'Your ETA request to PSA — awaiting their decision', meta: 'Sent 4h ago · 30-day window · pending PSA accept · auto-reminder at day 21', btn: 'Open', action: 'open', dir: 'out' },
      { title: 'Extend Agreement with Cosco before 30 Sep', meta: 'Renewal · expires in 9 days · auto-extend disabled', btn: 'Extend 12mo', action: 'extend' },
      { title: 'Promote Bill of Lading v2.1 → Active', meta: 'Data element · drafted by Sarah · review window closing today', btn: 'Open', action: 'open' }
    ],
    team: [
      { title: 'PSA bunker delivery — 3 contributor enrolments pending', meta: 'Approval · oldest 4h ago · 3 admins eligible', btn: 'Claim' },
      { title: 'Alice approved CrimsonLogic appointment for ABC Logistics', meta: 'Completed 2 min ago · disappears from inbox in 3 min', completion: true },
      { title: 'Review onboarding KYC for Pacific Container Lines', meta: 'Approval · 1d ago · 3 admins eligible', btn: 'Claim' }
    ]
  },
  bx: {
    name: 'BuildEx',
    count: 7, mineCount: 3, teamCount: 4,
    chip: 'bx',
    role: 'Participant',
    mine: [
      { title: 'Acme Construction wants daily site progress reports', meta: 'Invited 1h ago · waiting on you to accept or decline', btn: 'Review', action: 'review', dir: 'in' },
      { title: 'Your subcontractor roster request to JTC — awaiting decision', meta: 'Sent yesterday · 30-day window · 1 of 3 BuildEx providers replied', btn: 'Open', action: 'open', dir: 'out' },
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
    role: 'Super-admin',
    mine: [
      { title: 'Annual compliance certificate expires in 14 days', meta: 'Renewal · residency-strict · no grace period', btn: 'Renew', action: 'renew-strict' }
    ],
    team: [
      { title: 'Patient registry data classification review', meta: 'Governance · residency-strict · 2 super-admins eligible', btn: 'Claim' },
      { title: 'Lab partnership Agreement awaiting compliance sign-off', meta: 'Compliance review · with legal · 24h SLA', btn: 'Open' }
    ]
  }
};
