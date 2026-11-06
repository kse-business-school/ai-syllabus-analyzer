// Трек 2, крок 3: витяг слотів → Syllabus.state. Детерміновано, без LLM: createEmptyState + витягнуте,
// source 'parsed', evidenceBlockIds з витягу, E-поля перераховує recompute.
const { createEmptyState } = require('../../syllabusState/empty');
const { recompute } = require('../../syllabusState/computed');
const { validateState } = require('../../syllabusState/schema');
const { parseDate, isoDay } = require('../../checks/common');

const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const clean = (v) => (filled(v) ? String(v).trim() : null);
// Слот із вмістом отримує походження 'parsed' і докази; порожній — без походження
const prov = (has, blockIds) => (has ? { source: 'parsed', evidenceBlockIds: [...new Set(blockIds)] } : { source: null, evidenceBlockIds: [] });
const textProv = (text, blockIds) => prov(filled(text), blockIds);

// Мова документа: кирилиця переважає → uk, інакше en (мова стану, не поле header.language)
function detectLanguage(slots) {
  const sample = [slots.shortDescription.text, ...slots.objectives.map((o) => o.text), ...slots.outcomes.map((o) => o.text),
    ...slots.sessions.map((s) => s.topic)].filter(Boolean).join(' ');
  const cyrillic = (sample.match(/[Ѐ-ӿ]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (!cyrillic && !latin) return 'en';
  return cyrillic > latin ? 'uk' : 'en';
}

// Повна дата розкладу → ISO (потрібна E-полю termFromSchedule); неповну лишаємо текстом як у файлі
function sessionDate(text) {
  const t = clean(text);
  if (!t) return null;
  const ms = parseDate(t);
  return ms === null ? t : isoDay(ms);
}

/**
 * @param {{ slots: object, policies?: object[], programCode: string, refs: object }} input
 *   slots — результат extractSlots; policies — state.policies від policyMatch (за замовчуванням порожні блоки довідника)
 * @returns {object} state, валідний за syllabusState/schema.validateState (інакше кидає помилку)
 */
function toState({ slots, policies, programCode, refs, courseMatch, courseCode }) {
  const h = slots.header;
  // courseKind і ECTS нормативного курсу — лише за кодом (createEmptyState + recompute); назва — тільки підказка.
  // courseCode (parse/index.courseCodeOf) — код із призначення або форми, якщо у файлі його немає
  const code = courseCode !== undefined ? clean(courseCode) : clean(h.code);
  const state = createEmptyState({ programCode, track: 'upload', refs, course: { code }, language: detectLanguage(slots) });

  const headerHas = [h.title, h.code, h.department, h.ects, h.totalHours, h.language, h.studyMode, h.deliveryFormat, h.termText, h.termStart, h.termEnd].some(filled);
  const d = slots.declared;
  const declared = {
    assessmentTotal: d.assessmentTotal ?? null, contactHours: d.contactHours ?? null, selfStudyHours: d.selfStudyHours ?? null,
    deliveryMode: d.deliveryMode ?? null, term: clean(d.term), instructor: clean(d.instructor),
  };
  const hasDeclared = Object.values(declared).some((v) => v !== null);
  const evidence = [...h.blockIds, ...(hasDeclared ? d.blockIds : [])];
  state.header = {
    ...state.header,
    courseTitle: clean(h.title),
    courseCode: code,
    department: clean(h.department),
    ects: h.ects ?? state.header.ects, // файл має пріоритет; інакше ECTS нормативного курсу
    totalHours: h.totalHours ?? null,
    studyMode: clean(h.studyMode),
    deliveryFormat: h.deliveryFormat ?? null,
    language: clean(h.language),
    term: { start: h.termStart || null, end: h.termEnd || null },
    ...(hasDeclared ? { declared } : {}),
    ...prov(headerHas || hasDeclared, evidence),
  };
  state.language = detectLanguage(slots);

  state.summary = {
    prerequisites: { fixtureRefs: [], text: clean(slots.prerequisites.text), ...textProv(slots.prerequisites.text, slots.prerequisites.blockIds) },
    shortDescription: { text: clean(slots.shortDescription.text), ...textProv(slots.shortDescription.text, slots.shortDescription.blockIds) },
    objectives: slots.objectives.filter((o) => filled(o.text))
      .map((o, i) => ({ id: `obj${i + 1}`, text: clean(o.text), ...prov(true, o.blockIds) })),
    capstone: { criteriaKeys: [], projectTypes: [], text: clean(slots.capstone.text), ...textProv(slots.capstone.text, slots.capstone.blockIds) },
  };

  // Локальні id моделі (clo1, as1 …) переназначаються за порядком; зв'язки переносяться
  const outcomeId = new Map(slots.outcomes.map((o, i) => [o.id, `clo${i + 1}`]));
  const assessmentId = new Map(slots.assessments.map((a, i) => [a.id, `as${i + 1}`]));
  const assessments = slots.assessments.map((a, i) => ({
    id: assessmentId.get(a.id), name: clean(a.name), fixtureRef: null, weight: a.weight ?? null, criteria: clean(a.criteria),
    deadline: clean(a.deadline), isParticipation: Boolean(a.isParticipation), isControl: Boolean(a.isControl),
    outcomeIds: [...new Set(a.outcomeIds.map((id) => outcomeId.get(id)).filter(Boolean))], ...prov(true, a.blockIds),
  }));
  state.assessments = assessments;
  state.outcomes = slots.outcomes.map((o) => ({
    id: outcomeId.get(o.id), text: clean(o.text),
    // Зв'язок із ПРН названо у файлі; покриття (full/partial) файл не вказує, підтверджує викладач
    plo: o.ploCodes.map((code) => ({ code, coverage: 'full', confirmed: false })),
    assessmentIds: assessments.filter((a) => a.outcomeIds.includes(outcomeId.get(o.id))).map((a) => a.id),
    ...prov(true, o.blockIds),
  }));

  state.instructors = slots.instructors.map((p, i) => ({
    id: `ins${i + 1}`, crmId: null, name: clean(p.name), position: clean(p.position), email: clean(p.email),
    officeHours: clean(p.officeHours), assistants: null,
    expertise: p.expertise.filter(filled), education: p.education.filter(filled), experience: p.experience.filter(filled),
    ...prov(true, p.blockIds),
  }));
  state.sessions = slots.sessions.map((s, i) => ({
    id: `s${i + 1}`, n: i + 1, topic: clean(s.topic), type: s.type ?? null, hours: s.hours ?? null, format: s.format ?? null,
    guest: clean(s.guest), additional: clean(s.additional), date: sessionDate(s.date), time: clean(s.time), ...prov(true, s.blockIds),
  }));
  state.individualWork = slots.individualWork.map((w, i) => ({
    id: `iw${i + 1}`, title: clean(w.title), hours: w.hours ?? null, ...prov(true, w.blockIds),
  }));

  let m = 0;
  const material = (x) => ({ id: `m${++m}`, citation: clean(x.citation), url: clean(x.url), verified: false, ...prov(true, x.blockIds) });
  state.materials = { required: slots.materials.required.map(material), recommended: slots.materials.recommended.map(material) };

  if (policies) state.policies = policies;

  const result = recompute(state, refs);
  // Призначення курс × набір (refs.offeringTypes) уже враховане в recompute і має пріоритет над переліком курсів
  const assigned = refs?.offeringTypes?.[String(code || '').normalize('NFC').replace(/\s+/g, '').toUpperCase()];
  if (courseMatch && !assigned) result.header.courseKind = courseMatch.matchedBy === 'code' ? courseMatch.kind : 'elective';
  const errors = validateState(result);
  if (errors.length) throw Object.assign(new Error(`Parsed state is invalid: ${errors.slice(0, 5).join('; ')}`), { code: 'PARSE_INVALID_STATE', errors });
  return result;
}

module.exports = { toState, detectLanguage };
