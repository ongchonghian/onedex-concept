/* schema-walker.js — render + read for the schema-driven Composer (ADR 0043
   sub-decision 7). Tracer-bullet scope: a minimal walker that round-trips
   values between a published Element version's elementSchema and a form DOM.

   Two entry points:
     · schemaWalker_renderForm(rootEl, elementSchema, options)
         options.values    — pre-fill from a prior payload (Message detail
                              renders payload.values via this same path)
         options.uiSchema  — co-versioned UI presentation/layout artefact
         options.uiRules   — co-versioned UI runtime rules artefact
         options.disabled  — render skeleton (read-only); default false
     · schemaWalker_readValues(rootEl, elementSchema) → values
         Walks the form by data-field-path, builds JSON matching the schema.

   The walker handles the slice of JSON Schema that the registration flow
   produces today (per ADR 0043 sub-decision 5a, scoped down for the tracer):
   primitives (string, number, integer, boolean), enums (string with enum),
   array-of-objects, and nested object properties. Honours co-versioned UI
   artefacts (uiSchema/uiRules) for hints, layout order, and visibility.

   Post-RJSF-cutover (see CONTEXT.md `x-*` zero-residue cutover): the walker
   no longer reads schema `x-*` extensions. Callers must supply the bundle's
   co-versioned uiSchema / uiRules explicitly — published `elementSchema` is
   interop-clean and carries none of this information.

   Physical hoist of the regBuildSkeleton* family (sub-decision 7) deferred —
   the existing registration surfaces continue using that family. This module
   is the Composer's renderer; consolidation lands in a follow-up refactor. */

(function () {
  'use strict';

  function isObjectSchema(s)  { return s && (s.type === 'object' || (Array.isArray(s.type) && s.type.indexOf('object') >= 0) || s.properties); }
  function isArraySchema(s)   { return s && (s.type === 'array'  || (Array.isArray(s.type) && s.type.indexOf('array')  >= 0)); }
  function schemaPrimitiveType(s) {
    if (!s) return 'string';
    if (typeof s.type === 'string') return s.type;
    if (Array.isArray(s.type)) {
      for (const t of s.type) if (t !== 'null') return t;
    }
    return 'string';
  }

  /* uiSchema / uiRules resolution. Callers must pass co-versioned bundle
     artefacts explicitly — the legacy `x-*` fallback is retired per the
     RJSF hard cutover (CONTEXT.md `x-*` zero-residue cutover). When omitted,
     the walker renders without presentation hints or visibility rules. */
  function resolveUiSchema(uiSchema) {
    return (uiSchema && typeof uiSchema === 'object') ? uiSchema : {};
  }
  function resolveUiRules(uiRules) {
    return (uiRules && typeof uiRules === 'object') ? uiRules : {};
  }
  function normalizeRulePathFromFieldPath(fieldPath) {
    return String(fieldPath || '').replace(/\[\d+\]/g, '.items');
  }
  function visibilityExpressionForPath(uiRules, fieldPath) {
    const visibility = uiRules && uiRules.visibility;
    if (!visibility || !fieldPath) return null;
    const rulePath = normalizeRulePathFromFieldPath(fieldPath);
    return visibility[rulePath] || null;
  }
  function fieldPathSegments(fieldPath) {
    return normalizeRulePathFromFieldPath(fieldPath).split('.').filter(Boolean);
  }
  function presentationEntryForPath(uiSchema, fieldPath) {
    const presentation = uiSchema && uiSchema.presentation;
    if (!presentation || !fieldPath) return null;
    const segs = fieldPathSegments(fieldPath);
    if (!segs.length) return null;
    let entry = presentation[segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i];
      if (!entry || typeof entry !== 'object') return null;
      if (seg === 'items') {
        entry = entry.items;
      } else {
        entry = entry.properties && entry.properties[seg];
      }
    }
    return entry || null;
  }
  function presentationHint(uiSchema, fieldPath) {
    const entry = presentationEntryForPath(uiSchema, fieldPath);
    return (entry && entry.hint) || null;
  }
  function orderedPropertyKeys(schema, parentPath, uiSchema) {
    const props = (schema && schema.properties) || {};
    const keys = Object.keys(props);
    if (parentPath) return keys;
    const order = uiSchema && Array.isArray(uiSchema.order) ? uiSchema.order : null;
    if (!order || !order.length) return keys;
    const out = [];
    order.forEach(k => { if (props[k] && out.indexOf(k) === -1) out.push(k); });
    keys.forEach(k => { if (out.indexOf(k) === -1) out.push(k); });
    return out;
  }
  function parseFieldPath(path) {
    const tokens = [];
    String(path || '').replace(/([^[.\]]+)|\[(\d+)\]/g, (_, prop, idx) => {
      if (prop !== undefined) tokens.push(prop);
      else if (idx !== undefined) tokens.push(Number(idx));
      return '';
    });
    return tokens;
  }
  function valueAtPath(obj, path) {
    if (!path) return obj;
    const tokens = parseFieldPath(path);
    let cur = obj;
    for (const t of tokens) {
      if (cur == null) return undefined;
      cur = cur[t];
    }
    return cur;
  }
  function parentFieldPath(path) {
    const s = String(path || '');
    const dot = s.lastIndexOf('.');
    if (dot >= 0) return s.slice(0, dot);
    const bracket = s.lastIndexOf('[');
    if (bracket >= 0) return s.slice(0, bracket);
    return '';
  }
  function evaluateVisibilityExpression(expression, payload) {
    if (!expression) return true;
    try {
      if (typeof window.regEvalExpression === 'function') {
        const result = window.regEvalExpression(expression, payload || {});
        if (result && !result.error) {
          if (result.value !== undefined) return !!result.value;
          return !!result.ok;
        }
        // Fail open on eval errors to avoid accidental data-loss by hiding.
        return true;
      }
    } catch (_) {}
    try {
      const ctx = Object.assign({}, payload || {});
      const keys = Object.keys(ctx).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
      const fn = new Function(...keys, '"use strict"; return (' + expression + ');');
      return !!fn(...keys.map(k => ctx[k]));
    } catch (_) {
      return true;
    }
  }
  function clearVisibilityBinding(rootEl) {
    if (!rootEl || !rootEl._swVisibilityHandler) return;
    rootEl.removeEventListener('input', rootEl._swVisibilityHandler);
    rootEl.removeEventListener('change', rootEl._swVisibilityHandler);
    delete rootEl._swVisibilityHandler;
  }
  function applyVisibilityRules(rootEl, elementSchema, uiRules) {
    const visibility = uiRules && uiRules.visibility;
    if (!rootEl || !visibility || !Object.keys(visibility).length) return;
    const values = schemaWalker_readValues(rootEl, elementSchema, { includeHidden: true });
    rootEl.querySelectorAll('[data-field-row]').forEach(row => {
      const fieldPath = row.getAttribute('data-field-row');
      const expression = visibilityExpressionForPath(uiRules, fieldPath);
      if (!expression) return;
      const parentPath = parentFieldPath(fieldPath);
      const parentScope = valueAtPath(values, parentPath);
      const payload = Object.assign({}, values || {});
      if (parentScope && typeof parentScope === 'object' && !Array.isArray(parentScope)) {
        Object.keys(parentScope).forEach(k => { payload[k] = parentScope[k]; });
      }
      const visible = evaluateVisibilityExpression(expression, payload);
      row.hidden = !visible;
      row.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }
  function bindVisibilityRules(rootEl, elementSchema, uiRules) {
    clearVisibilityBinding(rootEl);
    const visibility = uiRules && uiRules.visibility;
    if (!rootEl || !visibility || !Object.keys(visibility).length) return;
    const handler = () => applyVisibilityRules(rootEl, elementSchema, uiRules);
    rootEl._swVisibilityHandler = handler;
    rootEl.addEventListener('input', handler);
    rootEl.addEventListener('change', handler);
  }
  function isFieldHidden(rootEl, fieldPath) {
    if (!rootEl || !fieldPath) return false;
    const row = rootEl.querySelector('[data-field-row="' + cssEscape(fieldPath) + '"]');
    return !!(row && row.hidden);
  }
  function looksRequired(parentSchema, key) {
    return Array.isArray(parentSchema && parentSchema.required) && parentSchema.required.indexOf(key) >= 0;
  }
  function labelFor(propSchema, key) {
    return (propSchema && propSchema.title) || key;
  }

  /* Build a single input element for a primitive field. */
  function buildPrimitiveInput(propSchema, fieldPath, value, hint, disabled) {
    const t = schemaPrimitiveType(propSchema);
    let el;
    if (Array.isArray(propSchema && propSchema.enum)) {
      el = document.createElement('select');
      const enumValues = propSchema.enum;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— select —';
      el.appendChild(placeholder);
      enumValues.forEach(v => {
        const opt = document.createElement('option');
        opt.value = String(v);
        opt.textContent = String(v);
        if (value !== undefined && String(value) === String(v)) opt.selected = true;
        el.appendChild(opt);
      });
    } else if (hint === 'textarea' || t === 'string' && (propSchema.maxLength || 0) > 200) {
      el = document.createElement('textarea');
      el.rows = 3;
      if (value !== undefined && value !== null) el.value = String(value);
    } else if (t === 'boolean') {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!value;
    } else if (t === 'integer' || t === 'number') {
      el = document.createElement('input');
      el.type = 'number';
      if (propSchema.minimum !== undefined) el.min = propSchema.minimum;
      if (propSchema.maximum !== undefined) el.max = propSchema.maximum;
      if (value !== undefined && value !== null) el.value = String(value);
    } else {
      el = document.createElement('input');
      el.type = 'text';
      if (propSchema.pattern) el.pattern = propSchema.pattern;
      if (propSchema.format === 'date') el.type = 'date';
      else if (propSchema.format === 'date-time') el.type = 'datetime-local';
      else if (propSchema.format === 'email') el.type = 'email';
      if (value !== undefined && value !== null) el.value = String(value);
    }
    el.setAttribute('data-field-path', fieldPath);
    el.className = 'sw-input';
    if (disabled) el.disabled = true;
    return el;
  }

  /* Render an object schema's properties as a labelled list of fields. */
  function renderObject(rootSchema, schema, parentPath, values, container, disabled, uiSchema, uiRules) {
    const props = (schema && schema.properties) || {};
    const keys = orderedPropertyKeys(schema, parentPath, uiSchema);
    keys.forEach(key => {
      const propSchema = props[key];
      const fieldPath = parentPath ? parentPath + '.' + key : key;
      const value = values ? values[key] : undefined;
      const row = document.createElement('div');
      row.className = 'sw-field';
      row.setAttribute('data-field-row', fieldPath);
      const visibleWhen = visibilityExpressionForPath(uiRules, fieldPath);
      if (visibleWhen) row.setAttribute('data-visible-when', visibleWhen);

      const label = document.createElement('label');
      label.className = 'sw-label';
      const lblText = document.createElement('span');
      lblText.className = 'sw-lbl';
      lblText.textContent = labelFor(propSchema, key);
      label.appendChild(lblText);
      if (looksRequired(schema, key)) {
        const req = document.createElement('em');
        req.className = 'sw-req';
        req.textContent = 'required';
        label.appendChild(req);
      }
      if (propSchema && propSchema.description) {
        const desc = document.createElement('p');
        desc.className = 'sw-desc';
        desc.textContent = propSchema.description;
        label.appendChild(desc);
      }
      row.appendChild(label);

      if (isObjectSchema(propSchema)) {
        const nested = document.createElement('div');
        nested.className = 'sw-nested';
        renderObject(rootSchema, propSchema, fieldPath, value || {}, nested, disabled, uiSchema, uiRules);
        row.appendChild(nested);
      } else if (isArraySchema(propSchema)) {
        const arrayBox = renderArray(rootSchema, propSchema, fieldPath, Array.isArray(value) ? value : [], disabled, uiSchema, uiRules);
        row.appendChild(arrayBox);
      } else {
        const hint = presentationHint(uiSchema, fieldPath);
        const inp = buildPrimitiveInput(propSchema, fieldPath, value, hint, disabled);
        row.appendChild(inp);
      }
      container.appendChild(row);
    });
  }

  /* Render an array-of-objects (or array-of-primitives) field as a stack of
     item cards. Tracer scope: one-row-per-item, no add/remove buttons in
     skeleton mode; in interactive mode an "Add row" button at the bottom. */
  function renderArray(rootSchema, schema, fieldPath, values, disabled, uiSchema, uiRules) {
    const wrap = document.createElement('div');
    wrap.className = 'sw-array';
    wrap.setAttribute('data-field-array', fieldPath);
    const itemsSchema = schema.items || { type: 'string' };

    function renderItem(itemValue, idx) {
      const itemPath = fieldPath + '[' + idx + ']';
      const card = document.createElement('div');
      card.className = 'sw-array-item';
      card.setAttribute('data-field-item', itemPath);
      if (isObjectSchema(itemsSchema)) {
        renderObject(rootSchema, itemsSchema, itemPath, itemValue || {}, card, disabled, uiSchema, uiRules);
      } else {
        const hint = presentationHint(uiSchema, itemPath);
        const inp = buildPrimitiveInput(itemsSchema, itemPath, itemValue, hint, disabled);
        card.appendChild(inp);
      }
      if (!disabled) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'sw-array-remove';
        rm.textContent = '×';
        rm.title = 'Remove this row';
        rm.addEventListener('click', () => {
          card.remove();
          reindexArray(wrap, fieldPath);
        });
        card.appendChild(rm);
      }
      return card;
    }

    (values || []).forEach((v, i) => wrap.appendChild(renderItem(v, i)));

    if (!disabled) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'sw-array-add';
      addBtn.textContent = '+ Add row';
      addBtn.addEventListener('click', () => {
        const next = wrap.querySelectorAll('.sw-array-item').length;
        wrap.insertBefore(renderItem(undefined, next), addBtn);
      });
      wrap.appendChild(addBtn);
    }
    return wrap;
  }

  /* After a remove from an array, renumber data-field-path attributes on
     surviving items so readValues produces a contiguous array. */
  function reindexArray(wrap, fieldPath) {
    const items = wrap.querySelectorAll(':scope > .sw-array-item');
    items.forEach((item, idx) => {
      const oldPrefix = item.getAttribute('data-field-item');
      const newPrefix = fieldPath + '[' + idx + ']';
      if (oldPrefix === newPrefix) return;
      item.setAttribute('data-field-item', newPrefix);
      // Rewrite descendant paths.
      item.querySelectorAll('[data-field-path]').forEach(node => {
        const cur = node.getAttribute('data-field-path');
        node.setAttribute('data-field-path', cur.replace(oldPrefix, newPrefix));
      });
      item.querySelectorAll('[data-field-row]').forEach(node => {
        const cur = node.getAttribute('data-field-row');
        node.setAttribute('data-field-row', cur.replace(oldPrefix, newPrefix));
      });
      item.querySelectorAll('[data-field-array]').forEach(node => {
        const cur = node.getAttribute('data-field-array');
        node.setAttribute('data-field-array', cur.replace(oldPrefix, newPrefix));
      });
    });
  }

  /* Public — clear rootEl and render the form for elementSchema. */
  function schemaWalker_renderForm(rootEl, elementSchema, options) {
    options = options || {};
    clearVisibilityBinding(rootEl);
    rootEl.innerHTML = '';
    rootEl.classList.add('sw-root');
    if (!elementSchema || !isObjectSchema(elementSchema)) {
      rootEl.appendChild(document.createTextNode('No schema to render.'));
      return;
    }
    const uiSchema = resolveUiSchema(options.uiSchema);
    const uiRules = resolveUiRules(options.uiRules);
    renderObject(elementSchema, elementSchema, '', options.values || {}, rootEl, !!options.disabled, uiSchema, uiRules);
    bindVisibilityRules(rootEl, elementSchema, uiRules);
    applyVisibilityRules(rootEl, elementSchema, uiRules);
  }

  /* Public — walk rootEl, build JSON matching elementSchema's shape. */
  function schemaWalker_readValues(rootEl, elementSchema, options) {
    options = options || {};
    const includeHidden = !!options.includeHidden;
    function readObject(schema, parentPath) {
      const out = {};
      const props = (schema && schema.properties) || {};
      Object.keys(props).forEach(key => {
        const propSchema = props[key];
        const fieldPath = parentPath ? parentPath + '.' + key : key;
        if (!includeHidden && isFieldHidden(rootEl, fieldPath)) {
          out[key] = undefined;
          return;
        }
        if (isObjectSchema(propSchema)) {
          out[key] = readObject(propSchema, fieldPath);
        } else if (isArraySchema(propSchema)) {
          out[key] = readArray(propSchema, fieldPath);
        } else {
          out[key] = readPrimitive(propSchema, fieldPath);
        }
      });
      return out;
    }
    function readArray(schema, fieldPath) {
      const wrap = rootEl.querySelector('[data-field-array="' + cssEscape(fieldPath) + '"]');
      if (!wrap) return [];
      const items = wrap.querySelectorAll(':scope > .sw-array-item');
      const out = [];
      items.forEach((item, idx) => {
        const itemPath = fieldPath + '[' + idx + ']';
        const itemsSchema = schema.items || { type: 'string' };
        if (isObjectSchema(itemsSchema)) {
          out.push(readObject(itemsSchema, itemPath));
        } else {
          out.push(readPrimitive(itemsSchema, itemPath));
        }
      });
      return out;
    }
    function readPrimitive(propSchema, fieldPath) {
      if (!includeHidden && isFieldHidden(rootEl, fieldPath)) return undefined;
      const inp = rootEl.querySelector('[data-field-path="' + cssEscape(fieldPath) + '"]');
      if (!inp) return undefined;
      const t = schemaPrimitiveType(propSchema);
      if (inp.tagName === 'SELECT') {
        const v = inp.value;
        return v === '' ? undefined : v;
      }
      if (t === 'boolean')                  return !!inp.checked;
      if (t === 'integer')                  return inp.value === '' ? undefined : parseInt(inp.value, 10);
      if (t === 'number')                   return inp.value === '' ? undefined : Number(inp.value);
      return inp.value === '' ? undefined : inp.value;
    }
    if (!elementSchema || !isObjectSchema(elementSchema)) return {};
    return readObject(elementSchema, '');
  }

  /* CSS.escape polyfill — querySelector with field paths containing dots needs
     the path quoted; CSS.escape isn't universally available in older runtimes. */
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  window.schemaWalker_renderForm = schemaWalker_renderForm;
  window.schemaWalker_readValues = schemaWalker_readValues;
})();
