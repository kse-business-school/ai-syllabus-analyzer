// Покриття програмних результатів навчання (PLO/ПРН). Тип курсу — лише header.courseKind
// (визначений за ProgramCourse свого programCode), ніколи за назвою курсу.
const { tr, pluralUk, makeCheck, fmt, plural } = require('./common');

const SECTION = 'learning_outcomes';
const COVERAGE_WEIGHT = { full: 1, partial: 0.5 };
// Канонічний код ПРН — спільний для всіх модулів (services/references/ploCode.js)
const { canonicalPloCode: normalizePloCode } = require('../references/ploCode');

function run(state, refs) {
  const known = new Map((refs?.outcomes || []).map((o) => [normalizePloCode(o.code), o.code]));
  const coverage = new Map(); // канонічний код → max вага покриття
  const unknown = new Map();  // код як у стані → CLO, де він трапився
  const unconfirmed = new Set(); // CLO із зв'язками, яких викладач ще не підтвердив (з файлу або від моделі)
  for (const o of state.outcomes || []) {
    for (const p of o.plo || []) {
      const canonical = known.get(normalizePloCode(p.code));
      if (!canonical) {
        unknown.set(p.code, [...(unknown.get(p.code) || []), o.id]);
        continue;
      }
      // Зараховуються лише підтверджені зв'язки (docs/api-v5.md: підтвердження ставить confirmed: true)
      if (p.confirmed !== true) {
        unconfirmed.add(o.id);
        continue;
      }
      coverage.set(canonical, Math.max(coverage.get(canonical) || 0, COVERAGE_WEIGHT[p.coverage] ?? 0));
    }
  }
  const out = [...unknown].map(([code, outcomeIds]) => makeCheck({
    rule: 'plo.unknown_code', entityId: code, severity: 'warning', section: SECTION, path: 'outcomes[].plo',
    message: tr(state, `"${code}" is not among the programme learning outcomes of ${state.programCode || 'this programme'}. Which programme outcome did you mean?`,
      `«${code}» немає серед програмних результатів навчання ${state.programCode || 'цієї програми'}. Який ПРН ви мали на увазі?`),
    details: { code, outcomeIds, programCode: state.programCode || null },
  }));

  const score = [...coverage.values()].reduce((a, b) => a + b, 0);
  const covered = [...coverage.keys()];
  const details = { courseKind: state.header?.courseKind || null, programCode: state.programCode || null, score, covered, unconfirmedOutcomeIds: [...unconfirmed] };
  const pendingNote = unconfirmed.size ? tr(state, ` ${plural(unconfirmed.size, 'learning outcome')} still ${unconfirmed.size === 1 ? 'has' : 'have'} programme outcome links waiting for your confirmation; they count once confirmed.`,
    ` Зв'язки з ПРН ще чекають вашого підтвердження: ${pluralUk(unconfirmed.size, ['результат навчання', 'результати навчання', 'результатів навчання'])}; їх буде зараховано після підтвердження.`) : '';
  const kind = state.header?.courseKind;
  if (kind === 'core' && score < 1) {
    out.push(makeCheck({
      rule: 'plo.coverage', severity: 'high', section: SECTION, path: 'outcomes[].plo',
      message: tr(state, `${state.header?.courseTitle || 'This course'} is a core course in ${state.programCode}, so it should fully cover at least one programme learning outcome (partial coverage counts as half). ${covered.length ? `Right now the confirmed coverage adds up to ${fmt(score)}.` : 'No confirmed programme outcome links yet.'}${pendingNote} Which programme outcomes do the course outcomes contribute to?`,
        `${state.header?.courseTitle || 'Цей курс'} — нормативний курс ${state.programCode}, тож має повністю покривати принаймні один ПРН (часткове покриття рахується як половина). ${covered.length ? `Зараз підтверджене покриття — ${fmt(score)}.` : 'Підтверджених зв\'язків з ПРН ще немає.'}${pendingNote} Яким ПРН сприяють результати навчання курсу?`),
      details: { ...details, required: 1 },
    }));
  } else if (kind === 'core') {
    out.push(makeCheck({
      rule: 'plo.coverage', severity: 'info', section: SECTION, path: 'outcomes[].plo', passed: true,
      message: tr(state, `${plural(covered.length, 'programme learning outcome')} covered.${pendingNote}`, `Покрито ${pluralUk(covered.length, ['ПРН', 'ПРН', 'ПРН'])}.${pendingNote}`),
      details,
    }));
  } else if (kind === 'elective') {
    out.push(makeCheck({
      rule: 'plo.coverage', severity: 'info', section: SECTION, path: 'outcomes[].plo', passed: true,
      message: tr(state, `Elective course: ${plural(covered.length, 'programme learning outcome')} covered.${pendingNote}`, `Вибірковий курс: покрито ${pluralUk(covered.length, ['ПРН', 'ПРН', 'ПРН'])}.${pendingNote}`),
      details,
    }));
  } else {
    out.push(makeCheck({
      rule: 'plo.coverage', severity: 'info', section: SECTION, path: 'header.courseKind',
      message: tr(state, 'The course type (core or elective) is not determined yet, so programme outcome coverage is not checked.', 'Тип курсу (нормативний чи вибірковий) ще не визначено, тому покриття ПРН не перевіряється.'),
      details,
    }));
  }
  return out;
}

module.exports = { run, normalizePloCode };
