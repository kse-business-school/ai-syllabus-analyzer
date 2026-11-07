// Самостійна робота (шаблон школи: «одна академічна година занять ≈ дві години самостійної роботи»).
// «typically … approximately» — не заборона, тому лише warning з питанням.
const { tr, pluralUk, makeCheck, isNum, fmt, totals } = require('./common');

const SELF_STUDY_RATIO = 2;
const LOWER = 0.5;
const UPPER = 1.5;

function run(state) {
  const { contactHours, selfStudyHours } = totals(state);
  if (!isNum(contactHours) || contactHours <= 0 || !isNum(selfStudyHours)) return [];
  const expected = contactHours * SELF_STUDY_RATIO;
  const ratio = selfStudyHours / expected;
  if (ratio >= LOWER && ratio <= UPPER) return [];
  return [makeCheck({
    rule: 'workload.self_study_ratio', severity: 'warning', section: 'schedule', path: 'individualWork[].hours',
    message: tr(state, `Individual work adds up to ${fmt(selfStudyHours)} hours. With ${fmt(contactHours)} contact hours the school template expects about ${fmt(expected)} (two hours per contact hour). Is the self-study estimate complete?`,
      `Самостійна робота становить ${fmt(selfStudyHours)} год. За ${fmt(contactHours)} аудиторних год шаблон школи передбачає близько ${fmt(expected)} (дві години на одну аудиторну). Чи повна оцінка самостійної роботи?`),
    details: { contactHours, selfStudyHours, expected, ratio: Math.round(ratio * 1000) / 1000, bounds: [LOWER, UPPER] },
  })];
}

module.exports = { run };
