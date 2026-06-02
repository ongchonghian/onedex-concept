/* ============================================================
   DEMOS — flow #5: Compose Message (schema-driven)
   Per ADR 0034 + 0043 sub-decision 6/8.

   Story: Dr Joshua at Polyclinic Bedok treated a construction worker
   who was injured on the job. Polyclinic Bedok has an Active Agreement
   with Income Insurance — the worker's WIC insurer — to share the
   GATIOD-aligned Medical Report for Work Injury Compensation over
   SGHealthdex. The Agreement was created against a workspace-published
   Element version, so the Composer renders from elementSchema (not a
   static fixture), and Submit runs both AJV (schema-level) and
   govaluate (cross-field rule) gates per CONTEXT.md three-layer
   governance.

   The Element bundle is the canonical MEDICAL REPORT FOR WORK INJURY
   COMPENSATION published by SGHealthdex — elementSchema, uiSchema
   and metadata are copied verbatim from the published v1.0 bundle.
   A govaluate cross-field rule (sum of component %-incapacities
   equals the recommended total) is added on top of the published
   bundle so this flow demonstrates the govaluate L2 gate as well
   as the AJV L1 gate.

   Per ADR 0037, this flow targets stable demo anchors.

   ADRs demonstrated: 0024 (agreement-anchored composer),
   0021 (message lifecycle), 0043 (schema-driven composer),
   0047 (AJV L1 schema validation)
   ============================================================ */

(function (window) {
  'use strict';

  const MR_ELEMENT_ID = 'medical-report-for-work-injury-compensation';
  const MR_ELEMENT_VERSION = 'v1.0';
  const MR_ELEMENT_REF = MR_ELEMENT_ID + '@' + MR_ELEMENT_VERSION;
  const DEMO_AGREEMENT_ID = 'AGR-DEMO-MEDREPORT-INCOME';

  /* elementSchema — verbatim from the published bundle's elementSchema.json.
     Required keys exercise AJV's `required` keyword; `format: date` exercises
     a registered format; the `enum` on incapacity_type exercises enum
     validation. */
  const MR_ELEMENT_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "MEDICAL REPORT FOR WORK INJURY COMPENSATION",
    "type": "object",
    "properties": {
      "mom_ref_no": { "type": "string", "title": "Mom Ref No", "description": "MOM Ref No" },
      "mr_ref_no": { "type": "string", "title": "Mr Ref No", "description": "MR Ref No" },
      "hospital_clinic_name": { "type": "string", "title": "Hospital Clinic Name", "description": "Hospital/Clinic Name" },
      "hospital_clinic_ref": { "type": "string", "title": "Hospital Clinic Ref", "description": "Hospital/Clinic Ref" },
      "name_address_injured_person": { "type": "string", "title": "Name Address Injured Person", "description": "Name & Address of Injured Person" },
      "nric_fin_passport_no": { "type": "string", "title": "Nric Fin Passport No", "description": "NRIC/FIN/Passport No" },
      "date_of_accident": { "type": "string", "format": "date", "title": "Date Of Accident", "description": "Date of Accident" },
      "employer_name_address": { "type": "string", "title": "Employer Name Address", "description": "Name & Address of Employer/Platform Operator" },
      "employer_contact_no": { "type": "string", "title": "Employer Contact No", "description": "Contact No. of Employer/Platform Operator" },
      "insurer_name_address": { "type": "string", "title": "Insurer Name Address", "description": "Name & Address of Insurer" },
      "insurer_contact_no": { "type": "string", "title": "Insurer Contact No", "description": "Contact No. of Insurer" },
      "injured_body_parts_reported_mom": { "type": "string", "title": "Injured Body Parts Reported Mom", "description": "Injured body part(s) as reported to MOM" },
      "injured_body_parts_treated": { "type": "string", "title": "Injured Body Parts Treated", "description": "Injured body parts related to the accident as treated by you" },
      "has_pre_existing_condition": { "type": "boolean", "title": "Has Pre Existing Condition", "description": "Does the person suffer from any pre-existing medical condition which may directly contribute to the injuries stated in 5b?" },
      "pre_existing_condition_details": { "type": "string", "title": "Pre Existing Condition Details", "description": "medical condition and the affected body part(s)" },
      "treated_in_another_department": { "type": "boolean", "title": "Treated In Another Department", "description": "Has the person been treated in another department or hospital for other injuries sustained in the same accident after the initial assessment?" },
      "treatment_location": { "type": "string", "title": "Treatment Location", "description": "where the person was treated [department/hospital]" },
      "treated_affected_body_parts": { "type": "string", "title": "Treated Affected Body Parts", "description": "and the affected body parts" },
      "amputation_affected_body_part": { "type": "string", "title": "Amputation Affected Body Part", "description": "Affected Body Part(s)", "examples": ["Loss of one phalanx of left thumb"] },
      "amputation_percentage_incapacity": { "type": "number", "title": "Amputation Percentage Incapacity", "description": "% incapacity", "examples": ["1.5"] },
      "joint_involved": { "type": "string", "title": "Joint Involved", "description": "Joint(s) involved", "examples": ["Left elbow"] },
      "range_of_movement": { "type": "string", "title": "Range Of Movement", "description": "Range of Movement or Ankylosis in degree", "examples": ["active flexion 0o"] },
      "restricted_movement_percentage_incapacity": { "type": "number", "title": "Restricted Movement Percentage Incapacity", "description": "% incapacity", "examples": ["1.5"] },
      "site_or_organ": { "type": "string", "title": "Site Or Organ", "description": "Site or Organ", "examples": ["Left eye"] },
      "findings": { "type": "string", "title": "Findings", "description": "Findings", "examples": ["6/24"] },
      "other_injuries_percentage_incapacity": { "type": "number", "title": "Other Injuries Percentage Incapacity", "description": "% incapacity", "examples": ["1.5"] },
      "recommended_total_percentage": { "type": "number", "title": "Recommended Total Percentage", "description": "I recommend a total of % to be awarded" },
      "incapacity_type": { "type": "string", "enum": ["permanent incapacity", "current incapacity"], "title": "Incapacity Type", "description": "Current Incapacity (i.e. as at date of assessment) or Permanent Incapacity" },
      "reason_for_not_recommending": { "type": "string", "title": "Reason For Not Recommending", "description": "Reason for not recommending award" },
      "reassessment_in_months": { "type": "integer", "title": "Reassessment In Months", "description": "in" },
      "reassessment_department": { "type": "string", "title": "Reassessment Department", "description": "Department (e.g. Orthopaedics Department)" },
      "based_on_latest_gatiod": { "type": "boolean", "title": "Based On Latest Gatiod", "description": "Is the award based on the latest edition of the “Guide to the Assessment of Traumatic Injuries and Occupational Diseases for Work Injury Compensation”?" },
      "gatiod_section_page": { "type": "string", "title": "Gatiod Section Page", "description": "which section and page of the GATIOD is the award based on" },
      "alternative_reference_source": { "type": "string", "title": "Alternative Reference Source", "description": "which section and page of the American Medical Association's “Guides to the Evaluation of Permanent Impairment”" },
      "is_person_sound_mind": { "type": "boolean", "title": "Is Person Sound Mind", "description": "Is the person of sound mind and capable of managing himself or his affairs especially if he has suffered neurological injuries?" },
      "other_remarks": { "type": "string", "title": "Other Remarks", "description": "Any other remarks" },
      "health_professional_name": { "type": "string", "title": "Health Professional Name", "description": "Name of Health Professional" },
      "hospital_clinic_name_address": { "type": "string", "title": "Hospital Clinic Name Address", "description": "Name & Address of Hospital/Clinic" },
      "signature_date": { "type": "string", "title": "Signature Date", "description": "Signature & Date" }
    },
    "required": [
      "mom_ref_no", "mr_ref_no", "hospital_clinic_name", "hospital_clinic_ref",
      "name_address_injured_person", "nric_fin_passport_no", "date_of_accident",
      "employer_name_address", "employer_contact_no", "insurer_name_address",
      "insurer_contact_no", "injured_body_parts_reported_mom", "injured_body_parts_treated",
      "has_pre_existing_condition", "pre_existing_condition_details",
      "treated_in_another_department", "treatment_location", "treated_affected_body_parts",
      "amputation_affected_body_part", "amputation_percentage_incapacity", "joint_involved",
      "range_of_movement", "restricted_movement_percentage_incapacity", "site_or_organ",
      "findings", "other_injuries_percentage_incapacity", "recommended_total_percentage",
      "incapacity_type", "reason_for_not_recommending", "reassessment_in_months",
      "reassessment_department", "based_on_latest_gatiod", "gatiod_section_page",
      "alternative_reference_source", "is_person_sound_mind", "other_remarks",
      "health_professional_name", "hospital_clinic_name_address", "signature_date"
    ]
  };

  /* uiSchema — published bundle's uiSchema.json with per-field `group`
     membership stamped onto each presentation entry. The published
     `groups` block only carries section metadata (rationale); the field-
     to-group mapping below is what lets the schema-walker emit section
     headers above each PART of the form. Group boundaries follow the
     paper form's PART I–V structure. */
  const MR_UI_SCHEMA = {
    "presentation": {
      "mom_ref_no":                                { "hint": "text",     "group": "Header Information" },
      "mr_ref_no":                                 { "hint": "text",     "group": "Header Information" },
      "hospital_clinic_name":                      { "hint": "text",     "group": "Header Information" },
      "hospital_clinic_ref":                       { "hint": "text",     "group": "Header Information" },
      "name_address_injured_person":               { "hint": "text",     "group": "Injured Person Information" },
      "nric_fin_passport_no":                      { "hint": "text",     "group": "Injured Person Information" },
      "date_of_accident":                          { "hint": "text",     "group": "Injured Person Information" },
      "employer_name_address":                     { "hint": "text",     "group": "Employer and Insurer Information" },
      "employer_contact_no":                       { "hint": "text",     "group": "Employer and Insurer Information" },
      "insurer_name_address":                      { "hint": "text",     "group": "Employer and Insurer Information" },
      "insurer_contact_no":                        { "hint": "text",     "group": "Employer and Insurer Information" },
      "injured_body_parts_reported_mom":           { "hint": "text",     "group": "Nature of Injuries" },
      "injured_body_parts_treated":                { "hint": "text",     "group": "Nature of Injuries" },
      "has_pre_existing_condition":                { "hint": "checkbox", "group": "Nature of Injuries" },
      "pre_existing_condition_details":            { "hint": "text",     "group": "Nature of Injuries" },
      "treated_in_another_department":             { "hint": "checkbox", "group": "Nature of Injuries" },
      "treatment_location":                        { "hint": "text",     "group": "Nature of Injuries" },
      "treated_affected_body_parts":               { "hint": "text",     "group": "Nature of Injuries" },
      "amputation_affected_body_part":             { "hint": "text",     "group": "Medical Assessment" },
      "amputation_percentage_incapacity":          { "hint": "numeric",  "group": "Medical Assessment" },
      "joint_involved":                            { "hint": "text",     "group": "Medical Assessment" },
      "range_of_movement":                         { "hint": "text",     "group": "Medical Assessment" },
      "restricted_movement_percentage_incapacity": { "hint": "numeric",  "group": "Medical Assessment" },
      "site_or_organ":                             { "hint": "text",     "group": "Medical Assessment" },
      "findings":                                  { "hint": "text",     "group": "Medical Assessment" },
      "other_injuries_percentage_incapacity":      { "hint": "numeric",  "group": "Medical Assessment" },
      "recommended_total_percentage":              { "hint": "numeric",  "group": "Award Recommendation" },
      "incapacity_type": {
        "hint": "radio",
        "group": "Award Recommendation",
        "labels": {
          "permanent incapacity": "Permanent Incapacity",
          "current incapacity": "Current Incapacity"
        }
      },
      "reason_for_not_recommending":               { "hint": "text",     "group": "Award Recommendation" },
      "reassessment_in_months":                    { "hint": "numeric",  "group": "Award Recommendation" },
      "reassessment_department":                   { "hint": "text",     "group": "Award Recommendation" },
      "based_on_latest_gatiod":                    { "hint": "checkbox", "group": "Award Recommendation" },
      "gatiod_section_page":                       { "hint": "text",     "group": "Award Recommendation" },
      "alternative_reference_source":              { "hint": "text",     "group": "Award Recommendation" },
      "is_person_sound_mind":                      { "hint": "checkbox", "group": "Award Recommendation" },
      "other_remarks":                             { "hint": "text",     "group": "Award Recommendation" },
      "health_professional_name":                  { "hint": "text",     "group": "Health Professional Endorsement" },
      "hospital_clinic_name_address":              { "hint": "text",     "group": "Health Professional Endorsement" },
      "signature_date":                            { "hint": "text",     "group": "Health Professional Endorsement" }
    },
    "order": [
      "mom_ref_no", "mr_ref_no", "hospital_clinic_name", "hospital_clinic_ref",
      "name_address_injured_person", "nric_fin_passport_no", "date_of_accident",
      "employer_name_address", "employer_contact_no", "insurer_name_address",
      "insurer_contact_no", "injured_body_parts_reported_mom", "injured_body_parts_treated",
      "has_pre_existing_condition", "pre_existing_condition_details",
      "treated_in_another_department", "treatment_location", "treated_affected_body_parts",
      "amputation_affected_body_part", "amputation_percentage_incapacity", "joint_involved",
      "range_of_movement", "restricted_movement_percentage_incapacity", "site_or_organ",
      "findings", "other_injuries_percentage_incapacity", "recommended_total_percentage",
      "incapacity_type", "reason_for_not_recommending", "reassessment_in_months",
      "reassessment_department", "based_on_latest_gatiod", "gatiod_section_page",
      "alternative_reference_source", "is_person_sound_mind", "other_remarks",
      "health_professional_name", "hospital_clinic_name_address", "signature_date"
    ],
    "groups": {
      "Header Information": { "rationale": "Top form identifiers and facility details appearing before PART I." },
      "Injured Person Information": { "rationale": "PART I details identifying and locating the injured person." },
      "Employer and Insurer Information": { "rationale": "PART I contact and address details for the employer/platform operator and insurer." },
      "Nature of Injuries": { "rationale": "PART II fields describing the reported and treated injuries, pre-existing conditions, and any additional treatments." },
      "Medical Assessment": { "rationale": "PART III structured assessment tables for amputation, restricted movement/ankylosis, and other injuries with basis for award." },
      "Award Recommendation": { "rationale": "PART IV fields for total recommended award, incapacity type, basis of assessment, and related remarks or reasons." },
      "Health Professional Endorsement": { "rationale": "PART V fields for the assessing professional's identification, affiliation, and signature." }
    }
  };

  /* Cross-field rule — exercises govaluate via regEvalExpression. The sum
     of component %-incapacities (amputation + restricted movement + other)
     must equal the assessor's recommended total. This is a real medical-
     assessment invariant: the recommended total can't drift from the parts
     it's claimed to aggregate. The published bundle ships with an empty
     uiRules.json; this rule is added at seed time to demonstrate the L2
     govaluate gate on top of the L1 AJV gate. */
  const MR_RULES = [
    {
      name: 'percentages-sum-to-total',
      expression: 'amputation_percentage_incapacity + restricted_movement_percentage_incapacity + other_injuries_percentage_incapacity == recommended_total_percentage',
      on_failure: 'Recommended total % must equal the sum of amputation, restricted-movement, and other-injuries %-incapacities.'
    }
  ];

  function seedSchemaDrivenMedicalReport(workspace) {
    if (!workspace) return;
    const userId = (workspace.meta && workspace.meta.activeUserId) || 'joshua';

    workspace.dataElements = workspace.dataElements || {};
    workspace.dataElements[MR_ELEMENT_REF] = {
      id: MR_ELEMENT_ID,
      version: MR_ELEMENT_VERSION,
      name: 'Medical Report for Work Injury Compensation',
      dexId: 'hx',
      publishedAt: '2026-06-01T09:48:10.864Z',
      publishedBy: 'sarah',
      elementSchema: MR_ELEMENT_SCHEMA,
      uiSchema: MR_UI_SCHEMA,
      uiRules: {},
      authoringMetadata: { sourceOnramp: 'plain-english' },
      composeComplexity: 'high-stakes',
      rules: MR_RULES,
      pack: null,
      meta: {
        type: 'DOCUMENT',
        changeType: 'INITIAL',
        changeDescription: ''
      },
      auditTrail: [
        { kind: 'element-version-published', at: '2026-06-01T09:48:10.864Z', by: 'sarah' }
      ]
    };

    /* Mint an Active Agreement that points at the published version via
       elementSnapshot.source='published' — this is the trigger that makes
       openComposerFromDetail route to the schema-driven path. Polyclinic
       Bedok (Joshua) treated a construction worker injured on the job and
       shares the medical report with Income Insurance — the worker's WIC
       insurer, which processes the compensation claim. */
    workspace.agreements = workspace.agreements || {};
    workspace.agreements[DEMO_AGREEMENT_ID] = {
      agreementId: DEMO_AGREEMENT_ID,
      sourceDraftId: null,
      dexId: 'hx',
      state: 'active',
      type: 'DIRECT',
      direction: 'send',
      operatorOrgId: 'polyclinic-bedok',
      counterpartyOrgId: 'income-insurance',
      counterpartyOrgName: 'Income Insurance Limited',
      title: 'Medical Report for Work Injury Compensation with Income Insurance Limited',
      dataElementSummary: { name: 'Medical Report for Work Injury Compensation', detail: MR_ELEMENT_VERSION },
      elementSnapshot: {
        source:  'published',
        id:      MR_ELEMENT_ID,
        version: MR_ELEMENT_VERSION
      },
      terms: {
        effectiveFrom: '15 May 2026',
        durationMonths: 12,
        residency: 'standard'
      },
      activity: [
        { kind: 'agreement-created', actorUserId: userId, ts: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    /* Land the operator on this Agreement so goto('detail') shows it and
       the compose button routes via the schema-driven path. */
    if (typeof window.setSelectedAgreementId === 'function') {
      window.setSelectedAgreementId(DEMO_AGREEMENT_ID);
    }
  }

  /* Field-fill values that satisfy both gates. The three component %s
     (1.5 + 1.5 + 1.5) sum to the recommended_total_percentage (4.5),
     so the percentages-sum-to-total rule passes. */
  const FILL_TEXT = [
    ['mom_ref_no',                       'MOM-2026-WIC-118504'],
    ['mr_ref_no',                        'MR-PB-2026-00821'],
    ['hospital_clinic_name',             'Polyclinic Bedok'],
    ['hospital_clinic_ref',              'PB-OPD-2026-00821'],
    ['name_address_injured_person',      'Tan Wei Ming, Blk 215 Bedok North St 1 #08-142'],
    ['nric_fin_passport_no',             'S8421567D'],
    ['date_of_accident',                 '2026-05-12'],
    ['employer_name_address',            'Sunrise Engineering Pte Ltd, 12 Bedok Industrial Park E #03-04'],
    ['employer_contact_no',              '+65 6243 5621'],
    ['insurer_name_address',             'Income Insurance Limited, 75 Bras Basah Road'],
    ['insurer_contact_no',               '+65 6788 1777'],
    ['injured_body_parts_reported_mom',  'Left thumb; left elbow; left eye'],
    ['injured_body_parts_treated',       'Left thumb (partial amputation); left elbow (restricted movement); left eye (vision reduction)'],
    ['pre_existing_condition_details',   'Nil — no pre-existing condition contributing to current injuries'],
    ['treatment_location',               'Orthopaedics Department, Changi General Hospital'],
    ['treated_affected_body_parts',      'Left elbow and left thumb'],
    ['amputation_affected_body_part',    'Loss of one phalanx of left thumb'],
    ['amputation_percentage_incapacity', '2'],
    ['joint_involved',                   'Left elbow'],
    ['range_of_movement',                'Active flexion 0–80°, extension limited 20°'],
    ['restricted_movement_percentage_incapacity', '3'],
    ['site_or_organ',                    'Left eye'],
    ['findings',                         '6/24 corrected'],
    ['other_injuries_percentage_incapacity', '1'],
    ['recommended_total_percentage',     '6'],
    ['reason_for_not_recommending',      'Award recommended — field not applicable'],
    ['reassessment_in_months',           '12'],
    ['reassessment_department',          'Orthopaedics Department'],
    ['gatiod_section_page',              'GATIOD 3rd Ed., Section 4.2, p.71'],
    ['alternative_reference_source',     'AMA Guides 6th Ed., Chapter 16, p.456 (cross-reference only)'],
    ['other_remarks',                    'Patient stable; recommend follow-up at 12 months for permanent assessment.'],
    ['health_professional_name',         'Dr Joshua Lim'],
    ['hospital_clinic_name_address',     'Polyclinic Bedok, 11 Bedok North St 1, Singapore 469662'],
    ['signature_date',                   '01 Jun 2026']
  ];

  /* Selectors for typed fills, plus discrete actions for checkboxes
     (4 booleans) and the enum select (incapacity_type). */
  const fieldSel = (key) => '#compose-form [data-field-path="' + key + '"]';
  /* input[type=date] in real browsers rejects intermediate invalid date
     strings as the runtime's `type` action concatenates one character at
     a time — `.value += '2'` on a date input keeps reading back as ''.
     So the demo sets date fields via the runtime's `select` action, which
     just stamps the whole value + fires `change`. JSDOM doesn't enforce
     this and would happily accept char-by-char date typing; this branch
     keeps the demo working in real Chrome too. */
  const DATE_FIELDS = new Set(['date_of_accident']);
  const fillSteps = FILL_TEXT.map(([k, v]) =>
    DATE_FIELDS.has(k)
      ? { action: 'select', target: fieldSel(k), value: v }
      : { action: 'type',   target: fieldSel(k), text: v }
  );

  const composeMessage = {
    id: 'compose-message',
    title: 'Compose Message',
    description: "Dr Joshua's Medical-Report Agreement with Income Insurance is Active. The Agreement points at a published Element version, so the Composer renders from elementSchema and Submit runs the AJV + govaluate gates.",
    adrs: ['0024', '0021', '0043', '0047'],
    durationSec: 120,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'joshua', dexId: 'hx' });
      }
      seedSchemaDrivenMedicalReport(workspace);
    },

    steps: [
      // ---- Agreement detail page ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-compose-btn' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Step 1 of 7 — An Active Agreement, ready to use',
        rationale: "Dr Joshua's clinic and Income Insurance have a standing Agreement to share GATIOD-aligned medical reports for the insurer's work-injury claimants treated at Polyclinic Bedok. It's Active, which means he can send today's report under it without re-asking permission.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-compose-btn',
        label: 'Step 2 of 7 — Send a Message under it',
        rationale: "One button opens the right form. Because this Agreement is tied to the official Medical Report for Work Injury Compensation, the portal already knows the shape — Dr Joshua doesn't have to pick a template or choose a version.",
        dwell: 4200 },

      { action: 'click', target: '#detail-compose-btn', dwell: 800, after: 600 },

      // ---- Schema-driven Composer ----
      { action: 'expect', target: '.screen[data-screen="compose"].active #compose-form.sw-root [data-field-path="mom_ref_no"]' },
      { action: 'expect', target: '.screen[data-screen="compose"].active #compose-rules-aside' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-form',
        label: 'Step 3 of 7 — The official form, exactly as published',
        rationale: "Every clinic on SGHealthdex sees this same form for work-injury compensation reports — the same sections, the same fields, the same required markers. When SGHealthdex updates the form, every clinic gets the update at the same time. Dr Joshua never has to wonder if he's using last year's version.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-rules-aside',
        label: 'Step 4 of 7 — A live checklist that mirrors the regulator',
        rationale: "On the right: every check the report has to pass before it can be sent. Required fields show up as red errors next to each input; the rule at the top — recommended total must equal the sum of the three percentage components — reads FAILS until the numbers line up. Submit stays locked. This is the same checklist SGHealthdex used when they tested the form before publishing it — Dr Joshua sees what they saw.",
        dwell: 5400 },

      // Fill the form by data-field-path. These selectors are stable across
      // schema-walker output because each input carries data-field-path="<key>".
      // Each keystroke re-runs L1 (AJV) + L2 (govaluate); the operator sees
      // inline errors clear and the rule card flip from FAILS to PASSES live.
      ...fillSteps,

      // Booleans (checkboxes) — click to toggle on.
      { action: 'click', target: fieldSel('has_pre_existing_condition'),    dwell: 400, after: 150 },
      { action: 'click', target: fieldSel('has_pre_existing_condition'),    dwell: 200, after: 150 },  // toggle back off — no pre-existing
      { action: 'click', target: fieldSel('treated_in_another_department'), dwell: 400, after: 150 },
      { action: 'click', target: fieldSel('based_on_latest_gatiod'),        dwell: 400, after: 150 },
      { action: 'click', target: fieldSel('is_person_sound_mind'),          dwell: 400, after: 150 },

      // Enum (incapacity_type) — uiSchema hint = 'radio' so the walker emits
      // a radio group; click the specific option's input.
      { action: 'click', target: '#compose-form [data-field-radio-group="incapacity_type"] input[data-field-radio-value="permanent incapacity"]', dwell: 400, after: 200 },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-rules-aside',
        label: 'Step 5 of 7 — Checklist green, Submit unlocked',
        rationale: "Every red has cleared and the totals add up — 2 + 3 + 1 = 6, just like the assessment recommends. Submit lights up the moment the checklist goes green, so Dr Joshua never sends something Income Insurance or MOM would have to send back. No popup alerts; if anything's still wrong, the message stays right next to the field that needs fixing.",
        dwell: 5200 },

      { action: 'click', target: '.screen[data-screen="compose"].active #compose-submit', dwell: 1200, after: 1400 },

      // ---- Success ----
      { action: 'expect', target: '.screen[data-screen="compose-success"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose-success"].active [data-demo="compose-success.subline"]',
        label: 'Step 6 of 7 — The report is on the wire',
        rationale: "Polyclinic Bedok's record-keeping is satisfied, SGHealthdex's rules are satisfied, and the report is filed under this Agreement so the next person at the clinic — or an auditor a year from now — can find it without asking Dr Joshua where he put it.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose-success"].active [data-demo="compose-success.subline"]',
        label: 'Step 7 of 7 — On its way to Income Insurance',
        rationale: "Within seconds, Income Insurance's claims team has the report and can advance the worker's WIC claim. If anything goes wrong on the way, Dr Joshua gets a clear notification — he doesn't have to chase a delivery confirmation or rebuild a report someone misplaced.",
        dwell: 4400 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(composeMessage);
  } else {
    console.warn('demos/compose-message.js loaded before runtime.js — flow not registered');
  }

})(window);
