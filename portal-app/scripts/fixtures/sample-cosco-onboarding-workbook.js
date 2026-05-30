/* ============================================================
   SAMPLE — Cosco Shipping Org-onboarding workbook (ADR 0048).

   Pre-parsed JSON the workbook surface can ingest via the "Load
   sample" button without a real .xlsx upload. The shape mirrors
   the post-parse contract that adminWorkbookParseFromRows expects:

     { org, pitstops, users, directAgreements, spAgreements }

   Cosco's narrative: Sarah (SGTradex Platform Admin) just finished
   offline KYC for Cosco Shipping. She uses this workbook to bulk-
   stage Cosco's onboarding before clicking Materialise — the same
   end-state Phase 1's seed helper produces, but reached via the
   real upload pipeline.
   ============================================================ */

(function (window) {
  'use strict';

  window.SAMPLE_COSCO_ONBOARDING_WORKBOOK = {
    fileName: 'sample-cosco-onboarding.xlsx',
    fileHash: 'sample-cosco-001',

    org: {
      shortName: 'Cosco Demo',
      legalName: 'Cosco Shipping Demo (SG) Pte Ltd',
      uen: '199901234C',
      jurisdiction: 'Singapore',
      primaryDexId: 'tx',
      businessAddress: '1 Maritime Square, Singapore 099253',
      contactName: 'Priya Subramaniam',
      contactEmail: 'priya@cosco-demo.example'
    },

    pitstops: [
      { name: 'Cosco HQ Pitstop',        topology: 'single-pitstop', endpoint: 'pitstop-hq.cosco-demo.example' },
      { name: 'Cosco Regional Pitstop',  topology: 'failover',        endpoint: 'pitstop-rg.cosco-demo.example' }
    ],

    users: [
      // First row = org admin invitee
      { fullName: 'Priya Subramaniam', email: 'priya@cosco-demo.example',   role: 'Super Admin' },
      { fullName: 'Wei Liang',         email: 'weiliang@cosco-demo.example', role: 'Admin User' },
      { fullName: 'Faisal Tan',        email: 'faisal@cosco-demo.example',   role: 'Operation User' }
    ],

    directAgreements: [
      // 3 with PSA (counterpartyUen matches workspace.orgs['psa'] if seeded;
      // otherwise falls through to name resolution)
      { counterpartyName: 'PSA International',  elementName: 'Vessel arrival declaration', direction: 'send',    durationMonths: 12, notes: '' },
      { counterpartyName: 'PSA International',  elementName: 'Container handoff event',     direction: 'receive', durationMonths: 12, notes: '' },
      { counterpartyName: 'PSA International',  elementName: 'Bunker delivery note',        direction: 'send',    durationMonths: 12, notes: '' },

      // 2 with Maersk
      { counterpartyName: 'Maersk Logistics',   elementName: 'Bill of Lading',              direction: 'send',    durationMonths: 12, notes: '' },
      { counterpartyName: 'Maersk Logistics',   elementName: 'Container ETA event',         direction: 'receive', durationMonths: 12, notes: '' },

      // 2 with TFG Marine
      { counterpartyName: 'TFG Marine',         elementName: 'Bunker invoice',              direction: 'receive', durationMonths: 12, notes: '' },
      { counterpartyName: 'TFG Marine',         elementName: 'Bunker delivery confirmation',direction: 'send',    durationMonths: 12, notes: '' },

      // 1 with ABC Logistics
      { counterpartyName: 'ABC Logistics',      elementName: 'Crew list',                   direction: 'send',    durationMonths: 12, notes: '' },

      // 1 with a not-yet-enrolled counterparty (forward-reference per §15)
      { counterpartyName: 'Eastern Maritime',   elementName: 'Vessel particulars',          direction: 'send',    durationMonths: 12, notes: 'Counterpart onboarding in progress' }
    ],

    spAgreements: []
  };

})(window);
