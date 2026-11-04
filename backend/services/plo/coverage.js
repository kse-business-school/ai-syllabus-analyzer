// Матриця покриття ПРН на рівні набору (ТЗ, доповнення 29.10 §8): та сама матриця CLO → PLO зі силабусів,
// зібрана по всіх призначеннях курсів набору. Чиста функція без БД і LLM.
const { normalizePloCode } = require('../checks/plo');

// Вага клітинки: суцільна заливка 1, штрихування 0,5, порожньо 0 (як у перевірці plo.coverage)
const COVERAGE_WEIGHT = { full: 1, partial: 0.5 };

// Стани силабуса, з яких матриця ще не збирається
const SKIP_STATUSES = ['analyzing', 'error'];

const idOf = (v) => (v == null ? '' : String(v));
const sameCode = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Силабус для призначення: за offeringId, інакше за програмою й кодом курсу. Із кількох — найсвіжіший зі станом.
 */
function pickSyllabus(offering, syllabi) {
  const fresh = (list) => list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
  const usable = syllabi.filter((s) => s.state && !SKIP_STATUSES.includes(s.status));
  const byOffering = usable.filter((s) => idOf(s.offeringId) === idOf(offering._id));
  if (byOffering.length) return fresh(byOffering);
  return fresh(usable.filter((s) => !s.offeringId
    && sameCode(s.programCode || s.state.programCode, offering.programCode)
    && sameCode(s.course?.code || s.state.header?.courseCode, offering.courseCode)));
}

/** Внесок одного силабуса: код ПРН → { weight, clos[] } (вага — максимум за всіма CLO, як у перевірці). */
function syllabusContribution(state, knownCodes) {
  const assessments = new Map((state.assessments || []).map((a) => [a.id, a]));
  const byPlo = new Map();
  for (const clo of state.outcomes || []) {
    for (const p of clo.plo || []) {
      const code = knownCodes.get(normalizePloCode(p.code));
      const weight = COVERAGE_WEIGHT[p.coverage] ?? 0;
      if (!code || weight === 0) continue;
      const entry = byPlo.get(code) || { weight: 0, clos: [] };
      entry.weight = Math.max(entry.weight, weight);
      entry.clos.push({
        id: clo.id,
        text: clo.text || '',
        coverage: p.coverage,
        assessments: (clo.assessmentIds || []).map((id) => assessments.get(id)).filter(Boolean)
          .map((a) => ({ id: a.id, name: a.name || '', weight: a.weight ?? null })),
      });
      byPlo.set(code, entry);
    }
  }
  return byPlo;
}

/**
 * @param {{outcomes: {code,text}[], offerings: object[], syllabi: object[]}} input
 *   outcomes — ПРН набору (references), offerings — призначення цього набору, syllabi — силабуси набору зі state.
 * @returns {{courses: object[], outcomes: object[]}}
 *   courses[i].cells[code] = { weight, clos[] }; outcomes[j].sum — Σ по курсах; uncovered = Σ 0.
 */
function buildCoverage({ outcomes = [], offerings = [], syllabi = [] }) {
  const knownCodes = new Map(outcomes.map((o) => [normalizePloCode(o.code), o.code]));
  const courses = offerings.map((offering) => {
    const syllabus = pickSyllabus(offering, syllabi);
    const cells = {};
    if (syllabus) {
      for (const [code, entry] of syllabusContribution(syllabus.state, knownCodes)) cells[code] = entry;
    }
    return {
      offeringId: idOf(offering._id),
      courseCode: offering.courseCode,
      courseName: offering.courseName || syllabus?.course?.name || syllabus?.state?.header?.courseTitle || '',
      type: offering.type,
      syllabusId: syllabus ? idOf(syllabus._id) : null,
      cells,
    };
  });
  return {
    courses,
    outcomes: outcomes.map((o) => {
      const sum = courses.reduce((acc, c) => acc + (c.cells[o.code]?.weight || 0), 0);
      return { code: o.code, text: o.text, ...(o.label ? { label: o.label } : {}), sum, uncovered: sum === 0 };
    }),
  };
}

module.exports = { buildCoverage, pickSyllabus, COVERAGE_WEIGHT };
