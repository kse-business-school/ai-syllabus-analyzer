// Спільне для формулювальника й інструментів чату: як текст від моделі стає значенням слота в чернетці.
// Шлях і форма значення — як у docs/api-v5.md §9: текстовий слот-об'єкт (shortDescription, capstone) → value = рядок тексту
// (провенанс при accept ставить сервіс рішень), списки (objectives, outcomes) → value = масив повних сутностей.
const { getPath, concretePath } = require('../syllabusState/paths');

// D-слоти, які формулювальник чернетить з розповіді викладача
const NARRATIVE_SLOTS = ['course.description', 'course.objectives', 'course.outcomes', 'course.capstone'];

const DRAFTABLE = {
  'course.description': { mode: 'text', path: 'summary.shortDescription' },
  'course.capstone': { mode: 'text', path: 'summary.capstone' },
  'course.objectives': { mode: 'list', path: 'summary.objectives[]', idPrefix: 'obj', extra: () => ({}) },
  'course.outcomes': { mode: 'list', path: 'outcomes[]', idPrefix: 'clo', extra: () => ({ plo: [], assessmentIds: [] }) },
  'assessment.criteria': { mode: 'text', path: 'assessments[].criteria', entity: 'assessments' },
  // B-слот без каталогу (fixtures/reference/prerequisites.json порожній) деградує до тексту викладача
  'course.prerequisites': { mode: 'text', path: 'summary.prerequisites' },
  'schedule.additional': { mode: 'text', path: 'sessions[].additional', entity: 'sessions' },
};

// Скалярні числові поля стану (решта скалярів — рядки)
const NUMERIC_PATHS = new Set(['header.ects', 'header.totalHours']);

const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** «- text», «1. text», «• text» → «text»; порожні рядки відкидаються. */
function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

function nextId(prefix, taken) {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  const id = `${prefix}${n}`;
  taken.add(id);
  return id;
}

/** Рядки → масив повних сутностей слота-списку; сутності на тих самих позиціях зберігають id та інші поля. */
function listEntities(def, lines, existing = []) {
  const taken = new Set(existing.map((e) => e?.id).filter(Boolean));
  return lines.map((line, i) => {
    const old = existing[i];
    if (old?.id) {
      return old.text === line ? old : { ...old, text: line, source: 'ai_draft', evidenceBlockIds: [] };
    }
    return { id: nextId(def.idPrefix, taken), ...def.extra(), text: line, source: 'ai_draft', evidenceBlockIds: [] };
  });
}

/**
 * Частина входу createDraftSuggestions для слота з DRAFTABLE: { target: { path, entityId }, value, text }.
 * text — те, що сканується на факти; value — що буде записано при accept.
 * @returns {object|null} null, якщо слот не чернеткується текстом
 */
function draftTarget(slotKey, { state, text, entityId = null }) {
  const def = DRAFTABLE[slotKey];
  if (!def) return null;
  if (def.mode === 'list') {
    const lines = splitLines(text);
    if (!lines.length) return null;
    const existing = getPath(state, def.path) || [];
    return { target: { path: def.path, entityId: null }, value: listEntities(def, lines, existing), text: lines.join('\n') };
  }
  const value = String(text || '').trim();
  if (!value) return null;
  return { target: { path: def.entity ? concretePath(def.path, { id: entityId }) : def.path, entityId: def.entity ? entityId : null }, value, text: value };
}

/** Поточне значення слота як текст (для known сканера фактів і reword). */
function currentText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(currentText).filter(Boolean).join('\n');
  if (typeof value === 'object') return filled(value.text) ? String(value.text) : (filled(value.citation) ? String(value.citation) : '');
  return String(value);
}

/**
 * Тексти довідника, з яких факт у чернетці слота вважається названим системою. Лише довідник цього слота:
 * політика → її блок і варіанти, capstone → критерії Capstone, outcomes → ПРН. Числа з чужих політик
 * (наприклад «48 hours» з політики запізнень) не роблять факт «відомим» в описі курсу.
 */
function referenceTexts(refs, slotKey) {
  if (String(slotKey).startsWith('policy.')) {
    const block = (refs?.policyLibrary?.blocks || []).find((b) => b.key === slotKey);
    return [block?.text, ...(block?.options || []).map((o) => o.text)].filter(Boolean);
  }
  if (slotKey === 'course.capstone') {
    return (refs?.capstone?.criteria || []).map((c) => `${c.name}: ${c.description}${c.weight != null ? ` ${Math.round(c.weight * 100)}%` : ''}`);
  }
  if (slotKey === 'course.outcomes') return (refs?.outcomes || []).map((o) => o.text).filter(Boolean);
  return [];
}

module.exports = { NARRATIVE_SLOTS, DRAFTABLE, NUMERIC_PATHS, splitLines, listEntities, draftTarget, currentText, referenceTexts, filled };

// ---------- Списки сутностей (C і B→C): propose_items / propose_instructor (аудит A02) ----------
// Модель передає структуровані рядки; сервер будує повні сутності за schema.js, сам знаходить факти (proposedValues
// з path '[<id>].<поле>') і шаблон картки. «Change the value» змінює саме це поле сутності (applyFieldValues).
const { SESSION_TYPES, DELIVERY_FORMATS } = require('../syllabusState/schema');
const { scanFacts, isKnownFact, corpusOf } = require('./facts');

const COMPENSATION_GROUPS = ['comp', 'proof', 'retake', 'improve'];
const GROUP_LABELS = { comp: 'Compensation', proof: 'Proof of absence', retake: 'Retake', improve: 'Grade improvement' };
const MAX_ITEMS = 40;
const MAX_FIELD_CHARS = 1000;

// kind: text — факти шукає сканер; title — уся назва є фактом, якщо викладач її не назвав дослівно;
// number — число з одиницею (unit: hours | percent); enum — категорія; url — лише названий викладачем; list — масив рядків
const field = (from, name, kind, extra = {}) => ({ from, name, kind, ...extra });

const ITEM_SLOTS = {
  'schedule.sessions': {
    path: 'sessions[]', idPrefix: 's', noun: 'Session', numbered: true,
    main: field('label', 'topic', 'text'),
    fields: [
      field('type', 'type', 'enum', { values: SESSION_TYPES }), field('hours', 'hours', 'number', { unit: 'hours' }),
      field('format', 'format', 'enum', { values: DELIVERY_FORMATS }), field('date', 'date', 'text'), field('time', 'time', 'text'),
      field('guest', 'guest', 'text'),
    ],
    blank: () => ({ n: 0, topic: null, type: null, hours: null, format: null, guest: null, additional: null, date: null, time: null }),
    line: (e, f) => [`Session ${e.n}: ${f('topic')}`, e.type && f('type'), e.hours != null && `${f('hours')} h`, e.format && f('format'),
      e.date && f('date'), e.time && f('time'), e.guest && `guest: ${f('guest')}`].filter(Boolean).join(' · '),
  },
  'schedule.individual_work': {
    path: 'individualWork[]', idPrefix: 'iw', noun: 'Task',
    main: field('label', 'title', 'text'),
    fields: [field('hours', 'hours', 'number', { unit: 'hours' })],
    blank: () => ({ title: null, hours: null }),
    line: (e, f) => [f('title'), e.hours != null && `${f('hours')} h`].filter(Boolean).join(' · '),
  },
  'assessment.components': {
    path: 'assessments[]', idPrefix: 'as', noun: 'Component',
    main: field('label', 'name', 'text'),
    fields: [field('weight', 'weight', 'number', { unit: 'percent', max: 100 }), field('deadline', 'deadline', 'text'), field('criteria', 'criteria', 'text')],
    blank: () => ({ name: null, fixtureRef: null, weight: null, criteria: null, deadline: null, isParticipation: false, isControl: false, outcomeIds: [] }),
    line: (e, f) => [f('name'), e.weight != null && `${f('weight')}%`, e.deadline && `deadline: ${f('deadline')}`, e.criteria && `criteria: ${f('criteria')}`]
      .filter(Boolean).join(' · '),
  },
  'assessment.compensation': {
    path: 'compensation.items[]', idPrefix: 'comp', noun: 'Rule',
    main: field('label', 'text', 'text'),
    fields: [field('group', 'group', 'enum', { values: COMPENSATION_GROUPS })],
    blank: () => ({ group: 'comp', fixtureRef: null, text: null, modified: false }),
    line: (e, f) => `${GROUP_LABELS[e.group] || e.group}: ${f('text')}`,
  },
  'materials.required': {
    path: 'materials.required[]', idPrefix: 'm', noun: 'Reading',
    main: field('label', 'citation', 'title'),
    fields: [field('url', 'url', 'url')],
    blank: () => ({ citation: null, url: null, verified: false }),
    line: (e, f) => [f('citation'), e.url && f('url')].filter(Boolean).join(' '),
  },
  'materials.recommended': {
    path: 'materials.recommended[]', idPrefix: 'mr', noun: 'Reading',
    main: field('label', 'citation', 'title'),
    fields: [field('url', 'url', 'url')],
    blank: () => ({ citation: null, url: null, verified: false }),
    line: (e, f) => [f('citation'), e.url && f('url')].filter(Boolean).join(' '),
  },
};

// Профіль викладача (instructor.profile): один запис instructors[0], поля — як у schema.js
const INSTRUCTOR_FIELDS = [
  field('name', 'name', 'text', { label: 'Name' }), field('position', 'position', 'text', { label: 'Position' }),
  field('email', 'email', 'title', { label: 'Email' }), field('office_hours', 'officeHours', 'text', { label: 'Office hours' }),
  field('assistants', 'assistants', 'text', { label: 'Assistants' }), field('expertise', 'expertise', 'list', { label: 'Expertise' }),
  field('education', 'education', 'list', { label: 'Education' }), field('experience', 'experience', 'list', { label: 'Experience' }),
];
const LIST_SEP = '; ';

const fieldString = (value) => (Array.isArray(value) ? value.join(LIST_SEP) : value == null ? '' : String(value));

function cleanText(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

/** Значення з аргументу інструмента → значення поля сутності; { error } якщо не підходить. */
function coerce(f, raw) {
  if (raw == null) return { skip: true };
  if (f.kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || (f.max != null && n > f.max)) return { error: `${f.name} must be a number between 0 and ${f.max ?? 'any'}` };
    return { value: n };
  }
  if (f.kind === 'enum') {
    const v = String(raw).trim().toLowerCase();
    if (!f.values.includes(v)) return { error: `${f.name} must be one of: ${f.values.join(', ')}` };
    return { value: v };
  }
  if (f.kind === 'list') {
    const list = (Array.isArray(raw) ? raw : String(raw).split(/\n|;/)).map(cleanText).filter(Boolean);
    return { value: list };
  }
  const s = cleanText(raw);
  if (s && s.length > MAX_FIELD_CHARS) return { error: `${f.name} is too long` };
  return s ? { value: s } : { skip: true };
}

/** Факти в новому/зміненому полі, яких не назвав викладач і немає в довіднику: [{ value, label }]. */
function fieldFacts(f, value, corpus, known) {
  const str = fieldString(value);
  if (!str) return [];
  if (f.kind === 'number') {
    const asText = f.unit === 'percent' ? `${str}%` : `${str} hours`;
    return isKnownFact(f.unit === 'percent' ? 'Percentage' : 'Quantity', asText, corpus) ? [] : [{ value: str }];
  }
  if (f.kind === 'title') return isKnownFact('Title', str, corpus) ? [] : [{ value: str }];
  if (f.kind === 'text' || f.kind === 'list') return scanFacts(str, { known }).map((x) => ({ value: x.value }));
  return [];
}

/** Рядки картки з плейсхолдерами {{id}} на місці фактів (як у шаблоні текстових чернеток). */
function renderEntity(line, entity, pvs, withPlaceholders) {
  return line(entity, (name) => {
    let s = fieldString(entity[name]);
    if (!withPlaceholders) return s;
    const own = pvs.filter((pv) => pv.path === `[${entity.id}].${name}`).sort((a, b) => b.value.length - a.value.length);
    for (const pv of own) {
      const at = s.indexOf(pv.value);
      if (at >= 0) s = `${s.slice(0, at)}{{${pv.id}}}${s.slice(at + pv.value.length)}`;
    }
    return s;
  });
}

/**
 * Збирає факти змінених полів і шаблон картки.
 * @param {object[]} entities  сутності після зміни
 * @param {Map} before         id → сутність до зміни
 */
function factsAndTemplate({ entities, before, fields, labelOf, line, known }) {
  const corpus = corpusOf(known);
  const pvs = [];
  for (const e of entities) {
    const old = before.get(e.id);
    for (const f of fields) {
      if (old && JSON.stringify(old[f.name] ?? null) === JSON.stringify(e[f.name] ?? null)) continue;
      for (const fact of fieldFacts(f, e[f.name], corpus, known)) {
        const path = `[${e.id}].${f.name}`;
        if (pvs.some((pv) => pv.path === path && pv.value === fact.value)) continue;
        pvs.push({ id: `v${pvs.length + 1}`, label: `${labelOf(e)} · ${f.label || f.name}`, value: fact.value, path });
      }
    }
  }
  const lines = (withPh) => entities.map((e) => renderEntity(line, e, pvs, withPh)).join('\n');
  // Шаблон завжди: картка показує читабельні рядки, а не поля сутностей
  return { proposedValues: pvs, text: lines(false), template: lines(true) };
}

/**
 * Чернетка списку сутностей.
 * @param {string} slotKey ключ із ITEM_SLOTS
 * @param {{ state, items: object[], mode: 'append'|'replace', known: string[] }} input
 *   items — рядки інструмента: { id|null, label, hours, weight, type, format, date, time, deadline, criteria, guest, url, group };
 *   id наявної сутності — правка цієї сутності (null-поля не змінюються), id null — нова сутність.
 *   append — додає/править, решта лишається; replace — список стає рівно таким.
 * @returns {{ target, value, text, template, proposedValues } | { error, message }}
 */
function itemsDraft(slotKey, { state, items, mode = 'append', known = [] }) {
  const def = ITEM_SLOTS[slotKey];
  if (!def) return { error: 'SLOT_NOT_LIST', message: `Use propose_items only for: ${Object.keys(ITEM_SLOTS).join(', ')}` };
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return { error: 'INVALID_VALUE', message: `Give between 1 and ${MAX_ITEMS} items` };
  if (!['append', 'replace'].includes(mode)) return { error: 'INVALID_VALUE', message: 'mode must be append or replace' };
  const existing = getPath(state, def.path) || [];
  const byId = new Map(existing.map((e) => [e.id, e]));
  const taken = new Set(existing.map((e) => e.id));
  const fields = [def.main, ...def.fields];
  const touched = [];
  for (const item of items) {
    const old = item?.id ? byId.get(item.id) : null;
    if (item?.id && !old) return { error: 'UNKNOWN_ENTITY', message: `Unknown ${def.noun.toLowerCase()} id: ${item.id}; use null for a new item` };
    const entity = old ? { ...old } : { id: nextId(def.idPrefix, taken), ...def.blank(), source: 'ai_draft', evidenceBlockIds: [] };
    for (const f of fields) {
      const r = coerce(f, item?.[f.from]);
      if (r.error) return { error: 'INVALID_VALUE', message: r.error };
      if (!r.skip) entity[f.name] = r.value;
    }
    if (!filled(entity[def.main.name])) return { error: 'INVALID_VALUE', message: `Every new ${def.noun.toLowerCase()} needs a ${def.main.name}` };
    if (old && JSON.stringify(old) !== JSON.stringify(entity)) {
      entity.source = 'ai_draft';
      entity.evidenceBlockIds = [];
    }
    touched.push(entity);
  }
  if (new Set(touched.map((e) => e.id)).size !== touched.length) return { error: 'INVALID_VALUE', message: 'Each existing item can appear only once' };
  const touchedById = new Map(touched.map((e) => [e.id, e]));
  let entities = mode === 'replace'
    ? touched
    : [...existing.map((e) => touchedById.get(e.id) || e), ...touched.filter((e) => !byId.has(e.id))];
  if (def.numbered) {
    // replace — нумерація заново; append — нові заняття після останнього номера
    let max = mode === 'replace' ? 0 : Math.max(0, ...existing.map((e) => Number(e.n) || 0));
    entities = entities.map((e) => (mode === 'replace' ? { ...e, n: (max += 1) } : byId.has(e.id) ? e : { ...e, n: (max += 1) }));
  }
  if (JSON.stringify(entities) === JSON.stringify(existing)) return { error: 'NO_CHANGE', message: 'The list already looks like this' };
  const { proposedValues, text, template } = factsAndTemplate({
    entities, before: byId, fields, known, line: def.line,
    labelOf: (e) => (def.numbered ? `${def.noun} ${e.n}` : String(e[def.main.name] || def.noun).slice(0, 40)),
  });
  return { target: { path: def.path, entityId: null }, value: entities, text, template, proposedValues };
}

/** Чернетка профілю викладача (instructors[0]); null-поля не змінюються. */
function instructorDraft({ state, values, known = [] }) {
  const list = state.instructors || [];
  const old = list[0] || null;
  const entity = old ? { ...old } : {
    id: 'ins1', crmId: null, name: null, position: null, email: null, officeHours: null, assistants: null,
    expertise: [], education: [], experience: [], source: 'ai_draft', evidenceBlockIds: [],
  };
  for (const f of INSTRUCTOR_FIELDS) {
    const r = coerce(f, values?.[f.from]);
    if (r.error) return { error: 'INVALID_VALUE', message: r.error };
    if (!r.skip) entity[f.name] = r.value;
  }
  if (old && JSON.stringify(old) === JSON.stringify(entity)) return { error: 'NO_CHANGE', message: 'The profile already has these details' };
  if (!filled(entity.name)) return { error: 'INVALID_VALUE', message: 'The instructor name is required' };
  entity.source = 'ai_draft';
  entity.evidenceBlockIds = [];
  const line = (e, f) => INSTRUCTOR_FIELDS.filter((x) => fieldString(e[x.name])).map((x) => `${x.label}: ${f(x.name)}`).join('\n');
  const { proposedValues, text, template } = factsAndTemplate({
    entities: [entity], before: new Map(old ? [[old.id, old]] : []), fields: INSTRUCTOR_FIELDS, known, line, labelOf: () => 'Instructor',
  });
  return { target: { path: 'instructors[]', entityId: null }, value: [entity, ...list.slice(1)], text, template, proposedValues };
}

const FIELD_PATH = /^\[([^\]]+)\]\.(\w+)$/;
const hasFieldPaths = (pvs) => (pvs || []).some((pv) => FIELD_PATH.test(pv.path || ''));

/**
 * «Change the value» для чернетки списку: кожен proposedValue з path '[id].поле' міняє підрядок у полі сутності.
 * Числові поля лишаються числами (інакше { error }).
 */
function applyFieldValues(value, before, after) {
  if (!Array.isArray(value)) return { value };
  const out = value.map((e) => ({ ...e }));
  for (const next of after) {
    const prev = before.find((pv) => pv.id === next.id);
    const m = FIELD_PATH.exec(next.path || '');
    if (!m || !prev || prev.value === next.value) continue;
    const entity = out.find((e) => e.id === m[1]);
    if (!entity || !(m[2] in entity)) continue;
    const current = entity[m[2]];
    const str = fieldString(current);
    const at = str.indexOf(prev.value);
    const replaced = at >= 0 ? `${str.slice(0, at)}${next.value}${str.slice(at + prev.value.length)}` : next.value;
    if (typeof current === 'number' || ['hours', 'weight'].includes(m[2])) {
      const n = Number(String(replaced).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return { error: `${m[2]} must stay a non-negative number` };
      entity[m[2]] = n;
    } else if (Array.isArray(current)) {
      entity[m[2]] = replaced.split(LIST_SEP).map((s) => s.trim()).filter(Boolean);
    } else {
      entity[m[2]] = replaced;
    }
  }
  return { value: out };
}

Object.assign(module.exports, {
  ITEM_SLOTS, INSTRUCTOR_FIELDS, COMPENSATION_GROUPS, itemsDraft, instructorDraft, applyFieldValues, hasFieldPaths,
});
