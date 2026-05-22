/* Smart Start assist canned-response fixtures — ADR 0040 Slice 1.
 *
 * Each entry pairs a seed signature (the field names assist expects to find
 * in the Smart Start seed) with a list of pre-authored suggestions matching
 * the envelope shape from ADR 0040 §4.
 *
 * In Slice 1 we author ONE canonical demo element — Environmental Site
 * Observations (CTD-10435 on SGBuildex). HX and TX skeleton fixtures land
 * in Slice 4.
 *
 * Content is intentionally authentic where traceable: source excerpts are
 * drawn from real BCA / Confluence patterns rather than invented prose.
 *
 * Loaded after smart-start-assist.js and before the demos so the demo runner
 * can drive end-to-end.
 */

const SMART_START_CANNED_RESPONSES = {
  bx: [
    {
      /* Match this fixture if the seed's field names overlap ≥50% with the
       * signature below. The signature mirrors the 4 base fields that the
       * Form on-ramp's tier-2 canned seed produces for an env-site-obs PDF
       * (added to REG_NL_EXAMPLES + regFormSeedFromFilename in Slice 1's
       * wiring step). */
      id: 'env-site-obs',
      seedSignature: ['observation_id', 'observation_date', 'project_id', 'site_location'],
      meta: {
        elementName: 'Environmental Site Observations',
        sourceTicket: 'CTD-10435',
        sourceConfluencePageId: 'env-site-obs-requirements'
      },
      suggestions: [
        {
          id: 'sug-env-1',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'observation_id',
            type: 'string',
            format: 'identifier',
            required: true,
            description: 'Unique identifier for this observation record.',
            exampleValues: ['ENV-2026-04-12-001', 'ENV-2026-04-12-002']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,80,360,104]',
              excerpt: 'Observation Reference: ENV-2026-04-12-001',
              engine: 'vlm-canned'
            },
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'Each observation must carry a unique reference combining the ENV prefix, ISO date, and a sequence number.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=bca,doc=env-site-observation-spec,section=2.1',
              excerpt: 'Observations shall be uniquely identified by an observation reference assigned at the time of recording.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-2',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'observation_date',
            type: 'date',
            required: true,
            description: 'Date the observation was recorded on site.',
            exampleValues: ['2026-04-12']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,108,360,132]',
              excerpt: 'Date of Observation: 12 April 2026',
              engine: 'vlm-canned'
            },
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'Observation date is captured in ISO-8601 form (YYYY-MM-DD).'
            },
            {
              type: 'reference-doc',
              ref: 'registry=bca,doc=env-site-observation-spec,section=2.2',
              excerpt: 'All temporal data shall be recorded in ISO-8601 calendar date format.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-3',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'project_id',
            type: 'string',
            required: true,
            description: 'BCA project identifier the observation relates to.',
            exampleValues: ['BCA-PRJ-2026-1184']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,136,360,160]',
              excerpt: 'Project: BCA-PRJ-2026-1184',
              engine: 'vlm-canned'
            },
            {
              type: 'sibling-element',
              ref: 'elementId=bca_manpower_utilization,version=1.2',
              excerpt: 'Existing sibling element uses the same project_id format across SGBuildex submissions.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-4',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'site_location',
            type: 'string',
            required: true,
            description: 'Free-text description of the site area observed.',
            exampleValues: ['Block A, Level 12, North wing']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,164,500,192]',
              excerpt: 'Site Location: Block A, Level 12, North wing',
              engine: 'vlm-canned'
            },
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'Site location is normally a free-text description identifying the area within the project.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-5',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'observation_type',
            type: 'enum',
            required: true,
            description: 'Classification of the observation per BCA categories.',
            validation: { enumValues: ['positive', 'negative', 'neutral'] },
            exampleValues: ['negative']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'Each observation must be classified as one of: positive, negative, or neutral, in line with the BCA classification taxonomy.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=bca,doc=env-site-observation-spec,section=3.1',
              excerpt: 'Observation classification shall use the standard taxonomy: positive (compliance exceeds requirements), negative (non-compliance), neutral (information only).'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-6',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'observation_description',
            type: 'string',
            format: 'long-text',
            required: true,
            description: 'Detailed description of what was observed on site.',
            exampleValues: ['Improper storage of construction debris near drainage outlet, blocking water flow.']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,220,500,320]',
              excerpt: 'Description: Improper storage of construction debris near drainage outlet…',
              engine: 'vlm-canned'
            },
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'A free-text description must accompany every observation, sufficient for an independent reviewer to understand the situation.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-7',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'observed_by',
            type: 'string',
            required: true,
            description: 'Name or staff ID of the person recording the observation.',
            exampleValues: ['S1234567A']
          },
          sources: [
            {
              type: 'pdf-region',
              ref: 'page=1,bbox=[120,340,360,364]',
              excerpt: 'Observed by: [signature block — OCR confidence low]',
              engine: 'vlm-canned'
            }
          ],
          confidence: 'low',
          caveats: [
            'PDF region overlaps a signature block — OCR confidence was low on this field. Review the captured value.'
          ],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-8',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'severity',
            type: 'enum',
            required: false,
            description: 'Severity rating, applicable for negative observations.',
            validation: { enumValues: ['minor', 'moderate', 'major'] },
            exampleValues: ['moderate']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=validation-expectations',
              excerpt: 'Negative observations should normally include a severity rating to inform remediation prioritisation.'
            },
            {
              type: 'sibling-element',
              ref: 'elementId=bca_safety_incident,version=2.0',
              excerpt: 'Sibling element uses the same minor/moderate/major taxonomy for severity classification.'
            }
          ],
          confidence: 'low',
          caveats: [
            'Confluence uses hedged language ("should normally include") — confirm whether severity should be mandatory for negative observations or remain optional.'
          ],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },

        /* ---------- Compose complexity (1) ---------- */
        {
          id: 'sug-env-complexity',
          tab: 'complexity',
          kind: 'complexity-pick',
          payload: {
            choice: 'high-stakes',
            reason: 'Element carries regulatory classification (observation_type) and is residency-strict per BCA compliance regime.'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=compliance-regime',
              excerpt: 'Submissions are governed by BCA Environmental Site Observation Specification v1.4. Cross-DEX use is not in scope — this element is residency-strict to SGBuildex.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=bca,doc=env-site-observation-spec,section=3.1',
              excerpt: 'Observation classification shall use the standard taxonomy: positive (compliance exceeds requirements), negative (non-compliance), neutral (information only).'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'not-applicable' },
          alternatives: []
        },

        /* ---------- Pack membership (1) ---------- */
        {
          id: 'sug-env-pack',
          tab: 'pack',
          kind: 'pack-membership',
          payload: {
            action: 'join-existing',
            packId: 'subcontractor-enablement',
            packName: 'Subcontractor enablement pack',
            siblingElementIds: ['bca_safety_incident', 'bca_manpower_utilization']
          },
          sources: [
            {
              type: 'sibling-element',
              ref: 'elementId=bca_safety_incident,version=2.0',
              excerpt: 'Existing pack member — also BCA-regulated, site-anchored, classified by severity.'
            },
            {
              type: 'sibling-element',
              ref: 'elementId=bca_manpower_utilization,version=1.2',
              excerpt: 'Existing pack member — shares the project_id field and BCA compliance context.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'not-applicable' },
          alternatives: []
        },

        /* ---------- Validation rules (3) ---------- */
        {
          id: 'sug-env-rule-1',
          tab: 'rules',
          kind: 'validation-rule',
          payload: {
            name: 'Observation date not in future',
            expression: 'observation_date <= today()',
            on_failure: 'Observation date must not be in the future.',
            appliesAt: 'validation'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=validation-expectations',
              excerpt: 'The observation date must not be in the future. The observation date must be on or after the project commencement date.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-rule-2',
          tab: 'rules',
          kind: 'validation-rule',
          payload: {
            name: 'Observation ID format',
            expression: 'matches(observation_id, "^ENV-\\\\d{4}-\\\\d{2}-\\\\d{2}-\\\\d{3}$")',
            on_failure: 'Observation ID must follow the ENV-YYYY-MM-DD-NNN format.',
            appliesAt: 'validation'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=fields-of-interest',
              excerpt: 'Each observation must carry a unique reference combining the ENV prefix, ISO date, and a sequence number.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=bca,doc=env-site-observation-spec,section=2.1',
              excerpt: 'Observations shall be uniquely identified by an observation reference assigned at the time of recording.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-env-rule-3',
          tab: 'rules',
          kind: 'validation-rule',
          payload: {
            name: 'Severity required for negative observations',
            expression: 'observation_type !== "negative" || (severity && severity.length > 0)',
            on_failure: 'When observation_type is "negative", severity must be set.',
            appliesAt: 'validation'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=env-site-obs-requirements,anchor=validation-expectations',
              excerpt: 'Negative observations should normally include a severity rating to inform remediation prioritisation.'
            }
          ],
          confidence: 'low',
          caveats: [
            'Confluence language is hedged ("should normally include") — review whether to enforce as a hard rule or downgrade to advisory.'
          ],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        }
      ],

      /* refitSuggestions[] — ADR 0040 §17 Layer 2 self-audit output. Empty
       * for this fixture because the env-site-obs canned extraction was clean
       * (no flat per-cell tables, no radio-cluster mis-extractions). Populated
       * fixtures land in Phase 2 when realistic class-3 examples are wired in;
       * for now the prototype demos refit via the autosave-debounced name-
       * pattern scan in [`register-element.js`](../../register-element.js)
       * (regRefit_scanNamePatterns), which catches `<noun>_<n>_<attr>` keys
       * Sarah adds by hand. Shape of an entry, when populated, mirrors
       * ADR 0040 §32's universal envelope:
       *
       *   {
       *     id, tab: 'schema',
       *     kind: 'structural-restatement.merge-to-array-object',
       *     payload: {
       *       operation: 'merge-to-array-object',
       *       mergedFromFieldIds: [...],  // resolved at runtime
       *       proposedField: { name, type: 'array', items: {...} }
       *     },
       *     sources: [{ type: 'name-pattern' | 'bbox-cluster' | ..., ... }],
       *     confidence: 'high' | 'medium' | 'low',
       *     caveats: []
       *   }
       */
      refitSuggestions: []
    }
  ],

  /* HX skeleton — lab-result. Slice 4 per ADR 0040 §16: minimal fixture, just
   * enough to demonstrate per-DEX behaviour. ~4 schema fields, 1 complexity
   * pick, no rules / no pack. */
  hx: [
    {
      id: 'lab-result',
      seedSignature: ['result_id', 'patient_id', 'test_date', 'test_result'],
      meta: {
        elementName: 'Lab result',
        sourceConfluencePageId: 'hsa-lab-result-requirements'
      },
      suggestions: [
        {
          id: 'sug-hx-1',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'result_id',
            type: 'string',
            format: 'identifier',
            required: true,
            description: 'Unique lab result reference assigned by the issuing laboratory.',
            exampleValues: ['HSA-LR-2026-00012']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=hsa-lab-result-requirements,anchor=fields-of-interest',
              excerpt: 'Each lab result must carry a unique reference assigned by the issuing laboratory at the time of release.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=hsa,doc=clinical-data-exchange-spec,section=2.1',
              excerpt: 'Result identifiers shall be unique within the issuing accredited laboratory.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-hx-2',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'patient_id',
            type: 'string',
            format: 'identifier',
            required: true,
            description: 'Patient identifier (NRIC, FIN, or pseudonymised token per HSA Clinical Data Exchange).',
            exampleValues: ['S1234567A']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=hsa-lab-result-requirements,anchor=compliance-regime',
              excerpt: 'Patient identifiers are PII under PDPA; cross-DEX use is blocked and access is gated by the HSA accreditation list.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=hsa,doc=clinical-data-exchange-spec,section=3.2',
              excerpt: 'Patient identifiers shall be NRIC, FIN, or a pseudonymised token registered with HSA.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-hx-3',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'test_date',
            type: 'date',
            required: true,
            description: 'Date the specimen was tested.',
            exampleValues: ['2026-04-12']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=hsa-lab-result-requirements,anchor=fields-of-interest',
              excerpt: 'Temporal data is recorded in ISO-8601 calendar date form.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-hx-4',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'test_result',
            type: 'string',
            format: 'long-text',
            required: true,
            description: 'Result value or summary as released by the laboratory.'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=hsa-lab-result-requirements,anchor=fields-of-interest',
              excerpt: 'Result content is free-text in this baseline schema; structured per-assay results land in a future version.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-hx-complexity',
          tab: 'complexity',
          kind: 'complexity-pick',
          payload: {
            choice: 'high-stakes',
            reason: 'Element carries patient identifiers (PDPA-regulated PII) and is residency-strict to SGHealthdex.'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=hsa-lab-result-requirements,anchor=compliance-regime',
              excerpt: 'Patient identifiers are PII under PDPA; cross-DEX use is blocked and access is gated by the HSA accreditation list.'
            },
            {
              type: 'reference-doc',
              ref: 'registry=hsa,doc=clinical-data-exchange-spec,section=3.2',
              excerpt: 'Patient identifiers shall be NRIC, FIN, or a pseudonymised token registered with HSA.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'not-applicable' },
          alternatives: []
        }
      ]
    }
  ],

  /* TX skeleton — vessel-arrival. Slice 4 per ADR 0040 §16. ~4 schema fields,
   * 1 complexity-pick (simple — routine ops, low blast radius — to demonstrate
   * the engine varying its recommendation per element profile). */
  tx: [
    {
      id: 'vessel-arrival',
      seedSignature: ['vessel_imo', 'eta', 'port_of_arrival', 'voyage_number'],
      meta: {
        elementName: 'Vessel arrival notification',
        sourceConfluencePageId: 'mpa-vessel-arrival-requirements'
      },
      suggestions: [
        {
          id: 'sug-tx-1',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'vessel_imo',
            type: 'string',
            format: 'identifier',
            required: true,
            description: 'IMO vessel identifier (7-digit number assigned by the International Maritime Organization).',
            exampleValues: ['9123456'],
            validation: { pattern: '^\\d{7}$' }
          },
          sources: [
            {
              type: 'reference-doc',
              ref: 'registry=mpa,doc=vessel-arrival-notification-spec,section=1.1',
              excerpt: 'Vessel identification shall use the IMO Number as the primary key.'
            },
            {
              type: 'confluence-section',
              ref: 'pageId=mpa-vessel-arrival-requirements,anchor=fields-of-interest',
              excerpt: 'The IMO number uniquely identifies the vessel across its lifetime and ownership changes.'
            }
          ],
          confidence: 'high',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-tx-2',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'eta',
            type: 'datetime',
            required: true,
            description: 'Estimated time of arrival (ISO-8601 datetime with timezone).',
            exampleValues: ['2026-05-22T14:30:00+08:00']
          },
          sources: [
            {
              type: 'reference-doc',
              ref: 'registry=mpa,doc=vessel-arrival-notification-spec,section=1.2',
              excerpt: 'ETA shall be recorded in ISO-8601 form including timezone offset.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-tx-3',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'port_of_arrival',
            type: 'string',
            format: 'identifier',
            required: true,
            description: 'UN/LOCODE port of arrival.',
            exampleValues: ['SGSIN']
          },
          sources: [
            {
              type: 'reference-doc',
              ref: 'registry=mpa,doc=vessel-arrival-notification-spec,section=1.3',
              excerpt: 'Ports of arrival are encoded using the UN/LOCODE standard.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-tx-4',
          tab: 'schema',
          kind: 'field',
          payload: {
            name: 'voyage_number',
            type: 'string',
            required: true,
            description: 'Operator-assigned voyage reference.',
            exampleValues: ['CSL-1184E']
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=mpa-vessel-arrival-requirements,anchor=fields-of-interest',
              excerpt: 'Voyage number is operator-assigned; not standardised across operators.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'pass' },
          alternatives: []
        },
        {
          id: 'sug-tx-complexity',
          tab: 'complexity',
          kind: 'complexity-pick',
          payload: {
            choice: 'simple',
            reason: 'Routine vessel arrival notification — operational data, no signatures, no PII, no regulatory blast-radius. High volume favours fast submission.'
          },
          sources: [
            {
              type: 'confluence-section',
              ref: 'pageId=mpa-vessel-arrival-requirements,anchor=compliance-regime',
              excerpt: 'Vessel arrival notifications are operational data exchanged at high volume; no signature or attestation is required.'
            }
          ],
          confidence: 'medium',
          caveats: [],
          liveEval: { ranAgainst: 'smart-start-sample', result: 'not-applicable' },
          alternatives: []
        }
      ]
    }
  ]
};

if (typeof window !== 'undefined') {
  window.SMART_START_CANNED_RESPONSES = SMART_START_CANNED_RESPONSES;
}
