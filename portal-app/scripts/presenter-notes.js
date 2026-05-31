// portal-app/scripts/presenter-notes.js
//
// Parses portal-rewrite-keynotes.md into a record keyed by short notesKey.
// Heading format expected: `## <notesKey>` or `## <notesKey> — <title…>`.
// The key is the text up to the first em-dash (—) or the first opening
// parenthesis, whichever comes earlier.

(function (global) {
  function parseKeynotes(markdown) {
    // new Object() (not {}) so the returned record's prototype chain
    // matches the outer realm's Object.prototype when this file is
    // loaded via vm.runInContext in tests (Node v22 bug — {} would
    // bind to the vm's separate realm and fail assert.deepEqual).
    // In browser context the two forms are identical.
    const result = new Object();
    if (!markdown) return result;

    const lines = markdown.split('\n');
    let currentKey = null;
    let currentBody = [];

    function flush() {
      if (currentKey) {
        result[currentKey] = currentBody.join('\n').trim();
      }
      currentBody = [];
    }

    for (const line of lines) {
      if (line.startsWith('## ')) {
        flush();
        const heading = line.slice(3).trim();
        const stop = Math.min(
          heading.indexOf(' —') >= 0 ? heading.indexOf(' —') : heading.length,
          heading.indexOf(' (') >= 0 ? heading.indexOf(' (') : heading.length
        );
        currentKey = heading.slice(0, stop).trim();
      } else if (currentKey) {
        // Skip `---` horizontal rules between sections
        if (line.trim() === '---') continue;
        currentBody.push(line);
      }
    }
    flush();

    return result;
  }

  global.parseKeynotes = parseKeynotes;
}(typeof window !== 'undefined' ? window : globalThis));
