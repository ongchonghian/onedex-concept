/* ============================================================
   SCENE SCAFFOLD — empty seed template builder
   ============================================================
   Exposes scaffoldScene(userId, dexId, scenarioId) for authors to quickly
   produce the full empty shape of a SCENE_SEEDS entry. Returns an object
   with the canonical key + a fully-populated seed template (every screen
   slot present; field-level comments via __comment_ keys).

   The returned object also carries a toJSCode() method that emits a string
   pasteable directly into state.js's SCENE_SEEDS literal.

   Usage in the browser console:
     > const s = scaffoldScene('bea', 'bx', 'A');
     > console.log(s.key);              // "bea-cosco-bx-A"
     > console.log(s.toJSCode());       // pasteable JS literal
     > copy(s.toJSCode());              // copies to clipboard (DevTools helper)

   Three contracts:
     1. The function NEVER mutates SCENE_SEEDS. It only produces a template.
     2. The orgId is derived from USERS[userId].primaryOrgId so authors don't
        have to remember it. Pass `{ orgId: '...' }` as the optional 4th arg
        when scaffolding for a non-primary affiliation.
     3. The template uses null for fields the renderer will fall back from
        (inbox, message-detail, dashboard — all rely on per-DEX fixtures by
        default) and {} / [] with explanatory comments for fields the author
        is expected to fill in.
   ============================================================ */

(function () {
  'use strict';

  function _emptyDetail() {
    return {
      __comment_: 'Agreement detail page seed. All fields below feed into setDetailState in app.js.',
      agrId:           'AGR-XXXX-XXXXX',        // Agreement ID (display only — collision-free in seed scope)
      dex:             null,                    // 'tx' | 'bx' | 'hx' — match the scene's DEX
      dexLabel:        null,                    // 'SGTradex' | 'SGBuildex' | 'SGHealthdex'
      title:           null,                    // e.g. "Share Bills of Lading with Maersk"
      composerTooltip: null,                    // hovers on the Compose CTA
      sendMessageLabel:'Send Message',
      operator: {
        __comment_: 'The operator side — your user\'s org. orgId must exist in ORGS.',
        name:      null,
        uen:       null,
        orgId:     null,
        roleLabel: 'Sender · You'
      },
      counterparty: {
        __comment_: 'The other side. primaryUserId is the named contact per ADR 0031.',
        name:          null,
        short:         null,
        orgId:         null,                   // must exist in ORGS
        uen:           null,
        roleLabel:     null,
        partyLabel:    'Receiver · Counterparty',
        primaryUserId: null,                   // userId in USERS — surfaces in View-as panel + activity log
        acceptorName:  null                    // (legacy fallback display string — prefer primaryUserId)
      },
      element: {
        name:         null,                    // e.g. "Bill of Lading"
        version:      null,                    // e.g. "v2.1"
        complexity:   'high-stakes',           // or 'simple' — drives Composer wizard shape per ADR 0025
        snapshotText: null                     // e.g. "Snapshot taken 14 Mar · 1 element"
      },
      pack: {
        visible: false,
        name:    null,
        count:   0
      },
      timeline: [
        // Three steps: Pending → Active → Ends. Each: { stateKey, label, time, done|current|muted }
        { stateKey: 'pending', label: 'Pending', time: null,  done: true },
        { stateKey: 'active',  label: 'Active',  time: null,  current: true },
        { stateKey: 'ends',    label: 'Ends',    time: null,  muted: true }
      ],
      terms: {
        effectiveFrom: null,
        extendedUntil: null,
        residency:     'Standard · cross-DEX OK with warning',
        autoRenew:     'Off — requires explicit extension'
      },
      nudge: {
        icon:    'clock',                      // Tabler icon name
        text:    null,
        ctaLabel:'Extend now'
      },
      activity: [
        // Per ADR 0031, cross-org actors use actorUserId (resolved to "Name (OrgShort)");
        // same-org operator + automated org-level events use literal actor strings.
        // { actor | actorUserId, action, time, timeISO, dot }
        // dot: 'tx' | 'bx' | 'hx' | 'green' | 'muted'
      ]
    };
  }

  function _emptyDraft() {
    return {
      __comment_: 'One draft row. Repeat as needed.',
      id:        null,
      title:     null,
      icon:      'file-text',
      type:      'Direct',
      meta:      null,
      resumeKey: null
    };
  }

  function _emptyParticipant() {
    return {
      __comment_: 'One participant directory card. Repeat as needed. Per ADR 0031, directory identity is org-led; primaryUserId adds a thin "Primary contact" line.',
      initials:      null,
      name:          null,
      orgId:         null,                     // optional — when present, enables structured cross-DEX / primary contact resolution
      meta:          null,                     // "Carrier · UEN ... · N team members"
      useCases:      [],                       // ['Vessel arrival', 'Bunker delivery']
      status:        { kind: 'active', label: 'Active' },
      joined:        null,                     // optional — derived from ORG_DEX_MEMBERSHIPS when orgId present
      primaryUserId: null                      // userId in USERS — adds "Primary contact: …" line
    };
  }

  function _emptyAgreementFlat() {
    return {
      __comment_: 'One flat Agreement row. Use kind="pack-parent"/"pack-member" for ADR 0027 packs.',
      kind:    'flat',
      id:      null,
      cp:      { name: null, initials: null, role: null, dex: null },
      element: { name: null, version: null },
      type:    'Direct',
      status:  { kind: 'active', label: 'Active' },
      until:   null,
      actions: []                              // e.g. ['extend', 'revoke']
    };
  }

  function _emptyMessage() {
    return {
      __comment_: 'One Message row. Per ADR 0031, ack attribution can resolve via actorUserId (future); today renders from cp.name. Status enum: active | pending | failed.',
      id:        null,
      dir:       'sent',                       // 'sent' | 'received'
      cp:        { name: null, initials: null },
      pitstop:   null,                         // optional { name, retired?, retiredDate? }
      element:   { name: null, version: null },
      agreement: null,                         // Agreement ID this Message rides under
      status:    { kind: 'active', label: 'Delivered' },
      time:      null,
      actions:   []
    };
  }

  function scaffoldScene(userId, dexId, scenarioId, opts) {
    opts = opts || {};
    if (typeof USERS === 'undefined' || !USERS[userId]) {
      console.error('[scaffoldScene] Unknown userId:', userId, '— add to USERS first');
      return null;
    }
    const orgId = opts.orgId || USERS[userId].primaryOrgId;
    if (!orgId || (typeof ORGS !== 'undefined' && !ORGS[orgId])) {
      console.error('[scaffoldScene] Unknown orgId:', orgId);
      return null;
    }
    if (['tx', 'bx', 'hx'].indexOf(dexId) < 0) {
      console.error('[scaffoldScene] Invalid dexId:', dexId);
      return null;
    }
    if (['A', 'B', 'C', 'D', 'E', 'F'].indexOf(scenarioId) < 0) {
      console.error('[scaffoldScene] Invalid scenarioId:', scenarioId, '— must be A-F per ADR 0028');
      return null;
    }
    if (typeof USER_ORG_AFFILIATIONS !== 'undefined' && !USER_ORG_AFFILIATIONS[`${userId}-${orgId}`]) {
      console.warn('[scaffoldScene] No USER_ORG_AFFILIATIONS["' + userId + '-' + orgId + '"] exists yet — add it to state.js or this scene will be unreachable via the resolver');
    }

    const key = `${userId}-${orgId}-${dexId}-${scenarioId}`;
    const seed = {
      __comment_: `Seed for ${USERS[userId].name} operating ${ORGS && ORGS[orgId] ? ORGS[orgId].name : orgId} on ${{ tx:'SGTradex', bx:'SGBuildex', hx:'SGHealthdex' }[dexId]} (scenario ${scenarioId}).`,
      // Fill in what you need. Slots set to null fall back to per-DEX fixtures
      // (INBOX_BY_DEX[dex]) and the static HTML defaults — the renderer is null-safe.
      detail:           _emptyDetail(),
      inbox:            null,                  // null → INBOX_BY_DEX[dex] fallback (correct for most scenes)
      'message-detail': null,
      dashboard:        null,
      drafts:           [_emptyDraft()],
      participants:     [_emptyParticipant()],
      agreements:       [_emptyAgreementFlat()],
      messages:         [_emptyMessage()]
    };

    return {
      key,
      seed,
      toJSCode: function () {
        // Pretty-print as a JS-pasteable literal. Strips __comment_ keys into // comments
        // immediately preceding the surrounding object/array entry.
        return _toJSCode(this.seed, this.key);
      }
    };
  }

  function _toJSCode(seed, key) {
    // Use JSON.stringify with custom replacer to capture comments, then post-process.
    function ind(level) { return '  '.repeat(level); }
    function render(value, level) {
      if (value === null) return 'null';
      if (typeof value === 'string') return JSON.stringify(value);
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) {
        if (!value.length) return '[]';
        const items = value.map(v => ind(level + 1) + render(v, level + 1));
        return '[\n' + items.join(',\n') + '\n' + ind(level) + ']';
      }
      if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (!entries.length) return '{}';
        const lines = [];
        entries.forEach(([k, v]) => {
          if (k === '__comment_') {
            lines.push(ind(level + 1) + '// ' + v);
          } else {
            lines.push(ind(level + 1) + JSON.stringify(k) + ': ' + render(v, level + 1));
          }
        });
        return '{\n' + lines.join(',\n').replace(/,\n(\s*\/\/ )/g, '\n$1') + '\n' + ind(level) + '}';
      }
      return 'null';
    }
    return `  ${JSON.stringify(key)}: ${render(seed, 1)},`;
  }

  window.scaffoldScene = scaffoldScene;
  window.coworkSceneScaffold = { build: scaffoldScene };
})();
