/* Smart Start assist Confluence page fixtures — ADR 0040 Slice 1.
 *
 * In production, this content is fetched by the backend service via the
 * Atlassian REST API (service-account credentials per ADR 0040 §7). In the
 * design-concepts prototype, CORS prevents browser-side fetches; we ship
 * authentic excerpts as fixtures keyed by pageId / URL so the demo can
 * exercise the same code paths as production would.
 *
 * The popover renders these excerpts directly. The full page body is *not*
 * fully reproduced — only the sections an assist suggestion can cite (per
 * the source attribution discipline in ADR 0040 Q5/Q6).
 *
 * Loaded after canned-responses.js so both are available when the engine
 * runs.
 */

const SMART_START_CONFLUENCE_PAGES = {
  'hsa-lab-result-requirements': {
    pageId:    'hsa-lab-result-requirements',
    pageTitle: 'Lab result — Requirements',
    space:     'CDIT',
    url: 'https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/hsa-lab-result-requirements',
    sections: {
      'fields-of-interest': {
        title: 'Fields of interest',
        body: [
          'Each lab result must carry a unique reference assigned by the issuing laboratory at the time of release.',
          'Temporal data is recorded in ISO-8601 calendar date form.',
          'Result content is free-text in this baseline schema; structured per-assay results land in a future version.'
        ].join('\n\n')
      },
      'compliance-regime': {
        title: 'Compliance regime',
        body: [
          'Patient identifiers are PII under PDPA; cross-DEX use is blocked and access is gated by the HSA accreditation list.',
          'Submissions are governed by HSA Clinical Data Exchange Specification v0.9 (draft).'
        ].join('\n\n')
      },
      'stakeholders': {
        title: 'Background & stakeholders',
        body: [
          'Requested by HSA via the Clinical Informatics team.',
          'Initial submission cohort: 4 accredited laboratories, 12 GP clinics on the HSA pilot.'
        ].join('\n\n')
      }
    }
  },
  'mpa-vessel-arrival-requirements': {
    pageId:    'mpa-vessel-arrival-requirements',
    pageTitle: 'Vessel arrival notification — Requirements',
    space:     'CDIT',
    url: 'https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/mpa-vessel-arrival-requirements',
    sections: {
      'fields-of-interest': {
        title: 'Fields of interest',
        body: [
          'The IMO number uniquely identifies the vessel across its lifetime and ownership changes.',
          'Voyage number is operator-assigned; not standardised across operators.',
          'Port codes follow UN/LOCODE.'
        ].join('\n\n')
      },
      'compliance-regime': {
        title: 'Compliance regime',
        body: [
          'Vessel arrival notifications are operational data exchanged at high volume; no signature or attestation is required.',
          'Submissions are aligned with MPA Vessel Arrival Notification Specification v2.3.'
        ].join('\n\n')
      },
      'stakeholders': {
        title: 'Background & stakeholders',
        body: [
          'Requested by MPA Port Operations.',
          'Initial submission cohort: Cosco Shipping Lines, PIL, OOCL, plus 14 agency operators.'
        ].join('\n\n')
      }
    }
  },
  'env-site-obs-requirements': {
    pageId:    'env-site-obs-requirements',
    pageTitle: 'Environmental Site Observations — Requirements',
    space:     'CDIT',
    /* Full URL kept short for the popover's back-link. In production this is
     * the live Confluence URL the service-account fetched from. */
    url: 'https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/env-site-obs-requirements',
    /* Anchored sections — each anchor matches a `sources[].ref` value in
     * canned-responses.js so the engine can resolve excerpts deterministically. */
    sections: {
      'fields-of-interest': {
        title: 'Fields of interest',
        body: [
          'Each observation must carry a unique reference combining the ENV prefix, ISO date, and a sequence number.',
          'Observation date is captured in ISO-8601 form (YYYY-MM-DD).',
          'Site location is normally a free-text description identifying the area within the project.',
          'Each observation must be classified as one of: positive, negative, or neutral, in line with the BCA classification taxonomy.',
          'A free-text description must accompany every observation, sufficient for an independent reviewer to understand the situation.'
        ].join('\n\n')
      },
      'validation-expectations': {
        title: 'Validation expectations',
        body: [
          'Observations are validated at submission time against the published Data Element schema.',
          'Negative observations should normally include a severity rating to inform remediation prioritisation.',
          'The observation date must not be in the future. The observation date must be on or after the project commencement date.'
        ].join('\n\n')
      },
      'compliance-regime': {
        title: 'Compliance regime',
        body: [
          'Submissions are governed by BCA Environmental Site Observation Specification v1.4.',
          'Cross-DEX use is not in scope — this element is residency-strict to SGBuildex.'
        ].join('\n\n')
      },
      'stakeholders': {
        title: 'Background & stakeholders',
        body: [
          'Requested by BCA via the Environmental Compliance team.',
          'Primary requester: Diane Lim (BCA · Environmental Compliance).',
          'Initial submission cohort: ABC Logistics, Cosco Shipping, six tier-1 main contractors.'
        ].join('\n\n')
      }
    }
  }
};

/* Helper — resolve a source ref of the form `pageId=X,anchor=Y` to a {title,
 * body, url} record for the popover. Returns null when the ref doesn't match.
 */
function smartStartConfluence_resolveRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const parts = ref.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const pageId = parts.pageId;
  const anchor = parts.anchor;
  if (!pageId) return null;
  const page = SMART_START_CONFLUENCE_PAGES[pageId];
  if (!page) return null;
  const section = anchor ? page.sections[anchor] : null;
  return {
    pageTitle: page.pageTitle,
    sectionTitle: section ? section.title : null,
    body: section ? section.body : null,
    url: page.url
  };
}

if (typeof window !== 'undefined') {
  window.SMART_START_CONFLUENCE_PAGES   = SMART_START_CONFLUENCE_PAGES;
  window.smartStartConfluence_resolveRef = smartStartConfluence_resolveRef;
}
