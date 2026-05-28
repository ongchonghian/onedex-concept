/* Element bundle export — ZIP generation and download for data-element versions.
 * Per ADR 0046, at Publish-time the registration flow exports a 4-file ZIP bundle
 * containing elementSchema, uiSchema, uiRules, and metadata.json. This module
 * handles ZIP creation, auto-download, and catalogue re-download affordance.
 *
 * Bundle structure:
 *   ├── elementSchema.json     (JSON Schema, validation contract for data exchange)
 *   ├── uiSchema.json          (RJSF rendering hints — separate sidecar)
 *   ├── uiRules.json           (govaluate expressions — separate sidecar)
 *   └── metadata.json           (governance: type, version, changeType, changeDescription, status)
 *
 * Exported functions:
 *   · regCreateElementBundle(artifacts, publishMetadata) → bundle object
 *   · regDownloadElementBundle(bundle) → triggers download, no return
 *   · regCanRedownloadBundle(versionRef) → boolean (affordance check)
 */

/* Create the 4-file bundle object ready for ZIP compression. Does not require JSZip.
 * Args:
 *   artifacts: { elementSchema, uiSchema, uiRules, authoringMetadata }
 *   publishMetadata: { id, version, name, type, changeType, changeDescription, publishedAt, publishedBy }
 * Returns: bundle object with file entries.
 */
function regCreateElementBundle(artifacts, publishMetadata) {
  const elementSchema = artifacts.elementSchema || {};
  const uiSchema = artifacts.uiSchema || {};
  const uiRules = artifacts.uiRules || [];

  // Governance metadata written to metadata.json (not inline in other files).
  // Per ADR 0046 Q7.2, Review-tab metadata lives here: type, version, changeType, changeDescription, status.
  const metadata = {
    elementId: publishMetadata.id,
    version: publishMetadata.version,
    name: publishMetadata.name,
    type: publishMetadata.type || 'DOCUMENT',
    changeType: publishMetadata.changeType || 'INITIAL',
    changeDescription: publishMetadata.changeDescription || '',
    status: 'DRAFT',
    publishedAt: publishMetadata.publishedAt,
    publishedBy: publishMetadata.publishedBy,
    _schema: 'admin-corev2/DataElementVersion@v1'
  };

  return {
    elementSchema: elementSchema,
    uiSchema: uiSchema,
    uiRules: uiRules,
    metadata: metadata,
    elementId: publishMetadata.id,
    version: publishMetadata.version,
    filename: publishMetadata.id + '-' + publishMetadata.version + '.zip'
  };
}

/* Download the bundle as a ZIP file. Triggers browser download (auto-download behavior).
 * Args:
 *   bundle: object from regCreateElementBundle
 * Side effects: downloads a ZIP file to the user's Downloads folder.
 */
function regDownloadElementBundle(bundle) {
  if (typeof JSZip === 'undefined') {
    console.error('JSZip library not loaded; cannot export bundle');
    return;
  }

  try {
    const zip = new JSZip();

    // Add the 4 files to the ZIP. Each file is a JSON blob.
    zip.file('elementSchema.json', JSON.stringify(bundle.elementSchema, null, 2));
    zip.file('uiSchema.json', JSON.stringify(bundle.uiSchema, null, 2));
    zip.file('uiRules.json', JSON.stringify(bundle.uiRules, null, 2));
    zip.file('metadata.json', JSON.stringify(bundle.metadata, null, 2));

    // Generate the ZIP blob and trigger download.
    zip.generateAsync({ type: 'blob' }).then(function(zipBlob) {
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = bundle.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(function(err) {
      console.error('Error generating ZIP:', err);
      if (typeof toast === 'function') {
        toast('Failed to export element bundle. Check console for details.');
      }
    });
  } catch (e) {
    console.error('Error creating ZIP bundle:', e);
    if (typeof toast === 'function') {
      toast('Failed to export element bundle.');
    }
  }
}

/* Check if a published element can be re-downloaded (affordance visibility).
 * Currently returns true for any published element in the workspace.
 * Future: could check if the bundle file is still in localStorage or cache.
 *
 * Args:
 *   versionRef: elementId@version string
 * Returns: boolean
 */
function regCanRedownloadBundle(versionRef) {
  if (!versionRef) return false;

  const ws = (typeof getWorkspace === 'function') ? getWorkspace() : null;
  if (!ws || !ws.dataElements) return false;

  const versionRecord = ws.dataElements[versionRef];
  return !!(versionRecord && versionRecord.elementSchema);
}

/* Re-download an existing published element's bundle from the catalogue.
 * Reconstructs the bundle object from the stored versionRecord and triggers download.
 *
 * Args:
 *   versionRef: elementId@version string
 * Side effects: downloads a ZIP file.
 */
function regRedownloadElementBundle(versionRef) {
  if (!versionRef) return;

  const ws = (typeof getWorkspace === 'function') ? getWorkspace() : null;
  if (!ws || !ws.dataElements) return;

  const versionRecord = ws.dataElements[versionRef];
  if (!versionRecord) {
    if (typeof toast === 'function') {
      toast('Element not found in workspace.');
    }
    return;
  }

  // Reconstruct bundle from versionRecord fields.
  const bundle = {
    elementSchema: versionRecord.elementSchema || {},
    uiSchema: versionRecord.uiSchema || {},
    uiRules: versionRecord.uiRules || [],
    metadata: {
      elementId: versionRecord.id,
      version: versionRecord.version,
      name: versionRecord.name,
      type: versionRecord.meta ? versionRecord.meta.type : 'DOCUMENT',
      changeType: versionRecord.meta ? versionRecord.meta.changeType : 'INITIAL',
      changeDescription: versionRecord.meta ? versionRecord.meta.changeDescription : '',
      status: 'DRAFT',
      publishedAt: versionRecord.publishedAt,
      publishedBy: versionRecord.publishedBy,
      _schema: 'admin-corev2/DataElementVersion@v1'
    },
    elementId: versionRecord.id,
    version: versionRecord.version,
    filename: versionRecord.id + '-' + versionRecord.version + '.zip'
  };

  regDownloadElementBundle(bundle);
}
