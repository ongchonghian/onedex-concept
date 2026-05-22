/* DEX reference registry — ADR 0040 §12 (Slice 1).
 *
 * Authored as a JS module (rather than .json) so it can be loaded with a plain
 * <script> tag in the design-concepts prototype, with no fetch / no CORS / no
 * runtime parsing. The shape is identical to what a JSON-in-repo registry
 * would carry in production at config/reference-registry/<dex>.json.
 *
 * Per ADR 0040 §12, registry entries are immutable once published — editing
 * an existing section in-place would silently change the meaning of every
 * Element that already cited it. Bump `version` and mark previous as
 * superseded; new Elements cite the new version (mirrors ADR 0026's snapshot
 * pattern).
 *
 * Section IDs are stable strings; suggestion `sources[].ref` values point at
 * them as `registry=bca,doc=env-site-observation-spec,section=2.1`.
 *
 * HX (MOH) and TX (MPA / IMDA) registries land in Slice 4. Empty arrays
 * today so engine lookups return null cleanly.
 */

const SMART_START_DEX_REFERENCES = {
  registryVersion: '2026.05',
  dexes: {
    bx: {
      publishers: [
        {
          id: 'bca',
          name: 'Building and Construction Authority (BCA)',
          documents: [
            {
              id: 'env-site-observation-spec',
              title: 'BCA Environmental Site Observation Specification',
              version: 'v1.4',
              publishedAt: '2025-11-08',
              sourceUrl: 'https://www1.bca.gov.sg/standards/env-site-observation-spec',
              sections: [
                {
                  id: '2.1',
                  title: 'Observation identification',
                  excerpt: 'Observations shall be uniquely identified by an observation reference assigned at the time of recording.',
                  tags: ['identifier', 'mandatory']
                },
                {
                  id: '2.2',
                  title: 'Temporal data',
                  excerpt: 'All temporal data shall be recorded in ISO-8601 calendar date format.',
                  tags: ['date', 'format']
                },
                {
                  id: '3.1',
                  title: 'Observation classification',
                  excerpt: 'Observation classification shall use the standard taxonomy: positive (compliance exceeds requirements), negative (non-compliance), neutral (information only).',
                  tags: ['enum', 'observation_type', 'taxonomy']
                },
                {
                  id: '3.2',
                  title: 'Severity classification',
                  excerpt: 'Where a severity rating is supplied, it shall be one of minor, moderate, or major. The rating is not mandatory but is strongly recommended for negative observations.',
                  tags: ['enum', 'severity', 'recommended']
                }
              ]
            },
            {
              id: 'concrete-test-spec',
              title: 'BCA Concrete Test Specification',
              version: 'v3.2.1',
              publishedAt: '2024-08-15',
              sourceUrl: 'https://www1.bca.gov.sg/standards/concrete-test-spec',
              sections: [
                {
                  id: '3.2.1',
                  title: 'Concrete grade classifications',
                  excerpt: 'Compressive strength testing is conducted at 28 days after sampling. Grades are classified as C20, C25, C30, C35, C40, C45, or C50 based on characteristic strength.',
                  tags: ['enum', 'concrete_grade', 'validation']
                }
              ]
            }
          ]
        }
      ]
    },
    hx: {
      publishers: [
        {
          id: 'hsa',
          name: 'Health Sciences Authority (HSA)',
          documents: [
            {
              id: 'clinical-data-exchange-spec',
              title: 'HSA Clinical Data Exchange Specification',
              version: 'v0.9 (draft)',
              publishedAt: '2026-02-14',
              sourceUrl: 'https://www.hsa.gov.sg/standards/clinical-data-exchange-spec',
              sections: [
                {
                  id: '2.1',
                  title: 'Result identification',
                  excerpt: 'Result identifiers shall be unique within the issuing accredited laboratory.',
                  tags: ['identifier', 'mandatory']
                },
                {
                  id: '3.2',
                  title: 'Patient identification',
                  excerpt: 'Patient identifiers shall be NRIC, FIN, or a pseudonymised token registered with HSA.',
                  tags: ['identifier', 'PII', 'PDPA']
                }
              ]
            }
          ]
        }
      ]
    },
    tx: {
      publishers: [
        {
          id: 'mpa',
          name: 'Maritime and Port Authority (MPA)',
          documents: [
            {
              id: 'vessel-arrival-notification-spec',
              title: 'MPA Vessel Arrival Notification Specification',
              version: 'v2.3',
              publishedAt: '2025-09-03',
              sourceUrl: 'https://www.mpa.gov.sg/standards/vessel-arrival-notification',
              sections: [
                {
                  id: '1.1',
                  title: 'Vessel identification',
                  excerpt: 'Vessel identification shall use the IMO Number as the primary key.',
                  tags: ['identifier', 'imo']
                },
                {
                  id: '1.2',
                  title: 'Temporal data',
                  excerpt: 'ETA shall be recorded in ISO-8601 form including timezone offset.',
                  tags: ['date', 'format']
                },
                {
                  id: '1.3',
                  title: 'Port codes',
                  excerpt: 'Ports of arrival are encoded using the UN/LOCODE standard.',
                  tags: ['enum', 'unlocode']
                }
              ]
            }
          ]
        }
      ]
    }
  }
};

/* Helper — resolve a source ref of the form
 *   `registry=bca,doc=env-site-observation-spec,section=2.1`
 * to a {publisherName, docTitle, docVersion, sectionTitle, excerpt, sourceUrl}
 * record for the popover. Scoped to a specific DEX. Returns null on miss.
 */
function smartStartReference_resolveRef(ref, dexId) {
  if (!ref || typeof ref !== 'string' || !dexId) return null;
  const parts = ref.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const registry = parts.registry;
  const docId    = parts.doc;
  const sectionId = parts.section;
  if (!registry || !docId) return null;
  const dex = SMART_START_DEX_REFERENCES.dexes[dexId];
  if (!dex) return null;
  const publisher = (dex.publishers || []).find(p => p.id === registry);
  if (!publisher) return null;
  const doc = (publisher.documents || []).find(d => d.id === docId);
  if (!doc) return null;
  const section = sectionId ? (doc.sections || []).find(s => s.id === sectionId) : null;
  return {
    publisherName: publisher.name,
    docTitle:      doc.title,
    docVersion:    doc.version,
    sectionTitle:  section ? section.title : null,
    excerpt:       section ? section.excerpt : null,
    sourceUrl:     doc.sourceUrl
  };
}

if (typeof window !== 'undefined') {
  window.SMART_START_DEX_REFERENCES      = SMART_START_DEX_REFERENCES;
  window.smartStartReference_resolveRef  = smartStartReference_resolveRef;
}
