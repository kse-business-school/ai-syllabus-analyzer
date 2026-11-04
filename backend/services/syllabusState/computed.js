// E-поля стану (header.computed і header.courseKind) — чиста функція від стану й довідників програми.
// Пише їх лише store.mutate / initState через recompute; ні модель, ні викладач їх не задають.
//
// Неповні дані: сума рахується з відомих значень (сесія без годин просто не додається),
// а null — лише коли не відомо жодного значення. Про пропуски повідомляє computedWarnings(state):
// схема стану не має місця для прапорців, тож перевірки (services/checks) беруть їх звідти в Check.details.

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Сума відомих чисел; null, якщо відомих немає. */
function sumKnown(values) {
  const known = values.filter(isNum);
  return known.length ? round2(known.reduce((a, b) => a + b, 0)) : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** 'YYYY-MM-DD' з початку рядка, якщо це реальна дата; інакше null. */
function isoDay(value) {
  const m = ISO_DATE.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}

// Коди ProgramCourse порівнюються без різниці в регістрі, пробілах і формі Unicode
const normCode = (code) => String(code || '').normalize('NFC').replace(/\s+/g, '').toUpperCase();

/** Нормативний курс своєї програми за кодом (назва не враховується — див. docs/api-v5.md §1). */
function findCoreCourse(refs, courseCode) {
  const code = normCode(courseCode);
  if (!code) return null;
  return (refs?.coreCourses || []).find((c) => normCode(c.code) === code) || null;
}

/**
 * Тип курсу в наборі. Призначення (CourseOffering, refs.offeringTypes) мають пріоритет над переліком
 * нормативних курсів програми; без призначення — за refs.coreCourses (лише за кодом, не за назвою).
 */
function courseKindOf(refs, courseCode) {
  const assigned = refs?.offeringTypes?.[normCode(courseCode)];
  if (assigned === 'core' || assigned === 'elective') return assigned;
  return findCoreCourse(refs, courseCode) ? 'core' : 'elective';
}

function computeFields(state) {
  const sessions = state.sessions || [];
  const hoursOf = (type) => sumKnown(sessions.filter((s) => s.type === type).map((s) => s.hours));
  const days = sessions.map((s) => isoDay(s.date)).filter(Boolean).sort();
  return {
    contactHours: sumKnown(sessions.map((s) => s.hours)),
    lectureHours: hoursOf('lecture'),
    practiceHours: hoursOf('practice'),
    workshopHours: hoursOf('workshop'),
    selfStudyHours: sumKnown((state.individualWork || []).map((w) => w.hours)),
    assessmentTotal: sumKnown((state.assessments || []).map((a) => a.weight)),
    deliveryModes: [...new Set(sessions.map((s) => s.format).filter(Boolean))],
    termFromSchedule: { start: days[0] || null, end: days[days.length - 1] || null },
  };
}

/**
 * Новий стан з перерахованими E-полями (вхідний не змінюється).
 * courseKind рахується лише за наявності refs: core — якщо header.courseCode є серед refs.coreCourses, інакше elective.
 */
function recompute(state, refs) {
  const header = { ...state.header, computed: computeFields(state) };
  if (refs) header.courseKind = courseKindOf(refs, state.header?.courseCode);
  return { ...state, header };
}

/**
 * Пропуски в даних, з яких рахуються E-поля: [{ code, field, ids }].
 * Порожній масив сутностей пропуском не вважається (тоді поле просто null).
 */
function computedWarnings(state) {
  const missing = (items, key) => (items || []).filter((x) => !isNum(x[key])).map((x) => x.id);
  return [
    { code: 'SESSIONS_WITHOUT_HOURS', field: 'contactHours', ids: missing(state.sessions, 'hours') },
    { code: 'INDIVIDUAL_WORK_WITHOUT_HOURS', field: 'selfStudyHours', ids: missing(state.individualWork, 'hours') },
    { code: 'ASSESSMENTS_WITHOUT_WEIGHT', field: 'assessmentTotal', ids: missing(state.assessments, 'weight') },
    { code: 'SESSIONS_WITHOUT_DATE', field: 'termFromSchedule', ids: (state.sessions || []).filter((s) => !isoDay(s.date)).map((s) => s.id) },
  ].filter((w) => w.ids.length);
}

module.exports = { recompute, computeFields, computedWarnings, findCoreCourse, courseKindOf, isoDay };
