const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

test('buildWorkspaceFromFixtures seeds default meta, drafts, agreements, and inbox items', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js'
    ]
  });

  const workspace = window.buildWorkspaceFromFixtures();

  assert.equal(workspace.schemaVersion, 4);
  // Unified workspace must include records across every DEX (TX + BX + HX)
  // because Phase 6 dropped the per-scene workspace model.
  const dexes = new Set(Object.values(workspace.agreements).map((a) => a.dexId));
  assert.ok(dexes.has('tx'), 'expected TX Agreements');
  assert.ok(dexes.has('bx'), 'expected BX Agreements');
  assert.ok(dexes.has('hx'), 'expected HX Agreements');
  // Reference collections must be seeded before any Agreement / Message rows
  // are converted so the counterparty-name resolver has an authoritative
  // org registry to look up against.
  assert.ok(Object.keys(workspace.orgs).length >= 1, 'expected seeded orgs');
  assert.ok(Object.keys(workspace.users).length >= 1, 'expected seeded users');
  // Every seeded Agreement / Message must carry a real counterpartyOrgId so
  // the organisation → agreement → message foreign-key chain holds. Pack-
  // parent aggregators (ADR 0027) are the one exception: a pack groups N
  // member Agreements, so the parent itself has no single counterparty.
  Object.values(workspace.agreements).forEach((agreement) => {
    if (agreement.counterpartyOrgId === null) return; // pack-parent aggregator
    assert.ok(workspace.orgs[agreement.counterpartyOrgId], `agreement ${agreement.agreementId} missing counterpartyOrgId`);
  });
  Object.values(workspace.messages).forEach((message) => {
    assert.ok(workspace.orgs[message.counterpartyOrgId], `message ${message.messageId} missing counterpartyOrgId`);
  });
  assert.equal(workspace.meta.activeUserId, 'marcus');
  assert.equal(workspace.meta.activeDexId, 'tx');
  assert.ok(Object.keys(workspace.agreementDrafts).length >= 1, 'expected seeded drafts');
  assert.ok(Object.keys(workspace.agreements).length >= 1, 'expected seeded agreements');
  assert.ok(Object.keys(workspace.inboxItems).length >= 1, 'expected seeded inbox items');
});

test('resolveCounterpartyOrgId normalises curly quotes and Pte Ltd suffixes', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js'
    ]
  });

  const workspace = window.buildWorkspaceFromFixtures();
  // Pte Ltd suffix stripped — the seed says 'Acme Construction' but the
  // canonical org name is 'Acme Construction Pte Ltd'.
  assert.equal(window.resolveCounterpartyOrgId('Acme Construction', workspace.orgs), 'acme');
  // Curly apostrophes collapsed — seed text uses '’' but the registry
  // entry could also be straight-quote.
  assert.equal(window.resolveCounterpartyOrgId('KK Women’s & Children’s Hospital', workspace.orgs), 'kkh');
  // Unknown counterparty MUST throw — silent fallback would re-introduce the
  // orphan-relationship bug this schema upgrade exists to prevent.
  assert.throws(() => window.resolveCounterpartyOrgId('Some Made-Up Co.', workspace.orgs), /COUNTERPARTY_ORG_UNRESOLVED/);
});

test('organisation → agreement → message chain resolves via counterpartyOrgId', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js'
    ]
  });
  window.resetWorkspace();

  // Pick any seeded Message — its counterpartyOrgId must match the bound
  // Agreement's counterpartyOrgId, and both must resolve to a real org row.
  const message = window.listMessagesForDex('tx').find((m) => m.agreementId);
  assert.ok(message, 'expected at least one TX Message bound to an Agreement');
  const agreement = window.getAgreementById(message.agreementId);
  assert.ok(agreement, 'Message must resolve to a real Agreement');
  assert.equal(message.counterpartyOrgId, agreement.counterpartyOrgId);
  const org = window.getOrg(message.counterpartyOrgId);
  assert.ok(org, 'counterpartyOrgId must resolve to a real org record');

  // Reverse walks: listAgreementsForCounterparty + listMessagesForAgreement
  // must include this Message / Agreement.
  const agreementsForCp = window.listAgreementsForCounterparty(org.tier ? message.counterpartyOrgId : null, 'tx');
  assert.ok(agreementsForCp.some((a) => a.agreementId === agreement.agreementId), 'reverse walk: counterparty → agreement');
  const messagesForAgreement = window.listMessagesForAgreement(agreement.agreementId);
  assert.ok(messagesForAgreement.some((m) => m.messageId === message.messageId), 'reverse walk: agreement → message');
});

test('buildWorkspaceFromScene seeds scene-specific workspace records for a demo scene', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js'
    ]
  });

  const workspace = window.buildWorkspaceFromScene({
    user: 'alice',
    org: 'cosco',
    dex: 'bx',
    scenario: 'C',
    screen: 'agreements'
  });

  assert.equal(workspace.meta.activeUserId, 'alice');
  assert.equal(workspace.meta.activeDexId, 'bx');
  assert.ok(
    Object.values(workspace.agreements).some((agreement) => agreement.dexId === 'bx'),
    'expected a SGBuildex agreement'
  );
});
