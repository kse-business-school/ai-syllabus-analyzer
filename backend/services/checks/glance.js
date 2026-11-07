// At a Glance ↔ тіло (ТЗ §2). Працює лише коли в стані є header.declared — значення таблиці At a Glance
// з вхідного файлу (трек 2). У треку 1 таблицю будує генератор із тіла, тож розбіжностей бути не може.
const { tr, pluralUk, makeCheck, isNum, filled, sameNumber, fmt, totals, parseDate, isoDay, normName } = require('./common');

const SECTION = 'at_a_glance';

// Режим розкладу збігається із заявленим: hybrid — є hybrid-заняття або поєднання online і offline
function deliveryMatches(declared, modes) {
  const set = new Set(modes);
  if (declared === 'hybrid') return set.has('hybrid') || (set.has('online') && set.has('offline'));
  return set.size === 1 && set.has(declared);
}

// Заявлений терм → { start, end } у ms; рядок розбираємо, лише якщо в ньому дві дати
function declaredTerm(term) {
  if (!term) return null;
  if (typeof term === 'object') {
    const start = parseDate(term.start);
    const end = parseDate(term.end);
    return isNum(start) && isNum(end) ? { start, end } : null;
  }
  const parts = String(term).split(/\s*(?:–|—|\bto\b|\btill\b|\buntil\b|\s-\s)\s*/i);
  if (parts.length !== 2) return null;
  const start = parseDate(parts[0]);
  const end = parseDate(parts[1]);
  return isNum(start) && isNum(end) ? { start, end } : null;
}

function run(state) {
  const declared = state.header?.declared;
  if (!declared || typeof declared !== 'object') return [];
  const t = totals(state);
  const out = [];

  const numeric = [
    ['assessmentTotal', 'glance.assessment_total', 'Assessment total', t.assessmentTotal, 'the weights in Assessment and Grading add up to', 'assessments[].weight', 'загальну вагу оцінювання', 'ваги в розділі «Оцінювання» дають'],
    ['contactHours', 'glance.contact_hours', 'Contact hours', t.contactHours, 'the sessions in the schedule add up to', 'sessions[].hours', 'аудиторних годин', 'заняття в розкладі дають'],
    ['selfStudyHours', 'glance.self_study_hours', 'Self-study hours', t.selfStudyHours, 'Individual work adds up to', 'individualWork[].hours', 'годин самостійної роботи', 'самостійна робота дає'],
  ];
  for (const [field, rule, label, body, phrase, bodyPath, labelUk, phraseUk] of numeric) {
    const value = declared[field];
    if (!isNum(value) || !isNum(body) || sameNumber(value, body)) continue;
    out.push(makeCheck({
      rule, severity: 'high', section: SECTION, path: `header.declared.${field}`,
      message: tr(state, `At a Glance states ${label.toLowerCase()} of ${fmt(value)}, but ${phrase} ${fmt(body)}. Which figure is correct?`,
        `У «Коротко про курс» зазначено ${labelUk}: ${fmt(value)}, але ${phraseUk} ${fmt(body)}. Яке значення правильне?`),
      details: { declared: value, body, bodyPath },
    }));
  }

  if (filled(declared.deliveryMode) && t.deliveryModes.length && !deliveryMatches(declared.deliveryMode, t.deliveryModes)) {
    out.push(makeCheck({
      rule: 'glance.delivery_mode', severity: 'warning', section: SECTION, path: 'header.declared.deliveryMode',
      message: tr(state, `At a Glance says the course is ${declared.deliveryMode}, while the schedule lists ${t.deliveryModes.join(', ')} sessions. Which delivery mode applies?`,
        `У «Коротко про курс» формат курсу — ${declared.deliveryMode}, а в розкладі заняття у форматі ${t.deliveryModes.join(', ')}. Який формат правильний?`),
      details: { declared: declared.deliveryMode, body: t.deliveryModes, bodyPath: 'sessions[].format' },
    }));
  }

  // Терм: усі дати розкладу мають лежати в заявленому діапазоні
  const term = declaredTerm(declared.term);
  if (term && t.scheduleTerm) {
    const first = parseDate(t.scheduleTerm.start);
    const last = parseDate(t.scheduleTerm.end);
    if (first < term.start || last > term.end) {
      out.push(makeCheck({
        rule: 'glance.term', severity: 'warning', section: SECTION, path: 'header.declared.term',
        message: tr(state, `At a Glance gives the term as ${isoDay(term.start)} – ${isoDay(term.end)}, but the schedule runs from ${t.scheduleTerm.start} to ${t.scheduleTerm.end}. Should the term or the session dates be updated?`,
          `У «Коротко про курс» терміни курсу ${isoDay(term.start)} – ${isoDay(term.end)}, а розклад триває з ${t.scheduleTerm.start} до ${t.scheduleTerm.end}. Оновити терміни чи дати занять?`),
        details: { declared: { start: isoDay(term.start), end: isoDay(term.end) }, body: t.scheduleTerm, bodyPath: 'sessions[].date' },
      }));
    }
  }

  // Викладач: заявлене ім'я має збігатися з профілем (без урахування регістру і пробілів)
  const names = (state.instructors || []).map((i) => normName(i.name)).filter(Boolean);
  const declaredName = normName(declared.instructor);
  if (declaredName && names.length && !names.some((n) => declaredName.includes(n) || n.includes(declaredName))) {
    out.push(makeCheck({
      rule: 'glance.instructor', severity: 'warning', section: SECTION, path: 'header.declared.instructor',
      message: tr(state, `At a Glance names ${declared.instructor} as the instructor, but the Instructor section describes ${state.instructors.map((i) => i.name).filter(Boolean).join(', ')}. Who teaches the course?`,
        `У «Коротко про курс» викладачем зазначено ${declared.instructor}, а в розділі «Викладач» — ${state.instructors.map((i) => i.name).filter(Boolean).join(', ')}. Хто викладає курс?`),
      details: { declared: declared.instructor, body: state.instructors.map((i) => i.name), bodyPath: 'instructors[].name' },
    }));
  }
  return out;
}

module.exports = { run, deliveryMatches, declaredTerm };
