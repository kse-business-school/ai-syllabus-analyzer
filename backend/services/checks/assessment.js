// Бали і правила шаблону школи щодо компонентів оцінювання (ТЗ §2).
const {
  tr, pluralUk, makeCheck, isNum, filled, sameNumber, fmt, plural, totals, courseTerm, parseDate, isoDay,
  textSources, sentences, excerpt, findPhrase,
} = require('./common');

const SECTION = 'assessment';
const PARTICIPATION_LIMIT = 30;
const SMALL_COURSE_HOURS = 30;
const DEADLINE_GRACE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
// Відсоток не належить назві, якщо між ними більше символів
const MENTION_GAP = 40;

const componentLabel = (a, i) => (filled(a.name) ? a.name : `Component ${i + 1}`);

// 1. Сума ваг = 100 (critical)
function weightsTotal(state) {
  const weighted = (state.assessments || []).filter((a) => isNum(a.weight));
  if (!weighted.length) return [];
  const total = weighted.reduce((acc, a) => acc + a.weight, 0);
  if (sameNumber(total, 100)) return [];
  const missing = (state.assessments || []).filter((a) => !isNum(a.weight)).map((a) => a.id);
  return [makeCheck({
    rule: 'assessment.weights_total', severity: 'critical', section: SECTION, path: 'assessments[].weight',
    message: tr(state, `The component weights add up to ${fmt(total)}%, not 100%.${missing.length ? ` ${plural(missing.length, 'component')} have no weight yet.` : ''}`,
      `Ваги компонентів дають ${fmt(total)}%, а не 100%.${missing.length ? ` Ще без ваги: ${pluralUk(missing.length, ['компонент', 'компоненти', 'компонентів'])}.` : ''}`),
    details: { total, missingWeightIds: missing },
  })];
}

// «40% of classes» — частка чогось іншого, не вага; «25% of the final grade» — вага
function notAWeight(after) {
  const m = after.match(/^\s*of\s+(?:the\s+)?(?:(?:final|total|overall|course)\s+)?([\p{L}]+)/iu);
  return Boolean(m) && !/^(grades?|marks?|scores?|total|points|assessment)$/i.test(m[1]);
}

/**
 * Згадки «<назва> … N%» / «N% … <назва>» у тексті. Кожен відсоток прив'язується до найближчої назви
 * (не далі MENTION_GAP символів, без іншого відсотка між ними; за рівної відстані — до назви перед ним).
 * Повертає [{ componentId, value, excerpt }].
 */
function weightMentions(text, components) {
  const out = [];
  for (const sentence of sentences(String(text).normalize('NFC'))) {
    // Довша назва поглинає вкладену («Final Exam» проти «Exam»)
    let names = components.flatMap((c) => findPhrase(sentence, c.name).map((m) => ({ ...m, id: c.id })));
    names = names.filter((n) => !names.some((o) => o !== n && o.start <= n.start && o.end >= n.end && (o.end - o.start) > (n.end - n.start)));
    if (!names.length) continue;
    const percents = [...sentence.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)]
      .map((m) => ({ start: m.index, end: m.index + m[0].length, value: Number(m[1].replace(',', '.')) }))
      .filter((p) => !notAWeight(sentence.slice(p.end)));
    for (const p of percents) {
      const between = (a, b) => percents.some((q) => q !== p && q.start >= a && q.end <= b);
      let best = null;
      for (const n of names) {
        const before = n.end <= p.start;
        const gap = before ? p.start - n.end : n.start - p.end;
        if (gap < 0 || gap > MENTION_GAP) continue;
        if (before ? between(n.end, p.start) : between(p.end, n.start)) continue;
        if (!best || gap < best.gap || (gap === best.gap && before)) best = { gap, id: n.id };
      }
      if (best) out.push({ componentId: best.id, value: p.value, excerpt: excerpt(sentence) });
    }
  }
  return out;
}

// 2. Вага компонента однакова скрізь, де згадується (high)
function weightConsistency(state) {
  const components = (state.assessments || []).filter((a) => filled(a.name) && isNum(a.weight));
  if (!components.length) return [];
  const mentions = textSources(state).flatMap((src) => weightMentions(src.text, components).map((m) => ({ ...m, path: src.path, sourceId: src.entityId || src.policyKey || null })));
  return components.flatMap((a) => {
    const conflicting = mentions.filter((m) => m.componentId === a.id && !sameNumber(m.value, a.weight));
    if (!conflicting.length) return [];
    const values = [...new Set(conflicting.map((m) => fmt(m.value)))];
    return [makeCheck({
      rule: 'assessment.weight_consistency', entityId: a.id, severity: 'high', section: SECTION, path: 'assessments[].weight',
      message: tr(state, `"${a.name}" is worth ${fmt(a.weight)}% in Assessment and Grading, but elsewhere the syllabus gives ${values.map((v) => `${v}%`).join(' and ')}. Which weight is correct?`,
        `«${a.name}» має вагу ${fmt(a.weight)}% у розділі «Оцінювання», але деінде силабус називає ${values.map((v) => `${v}%`).join(' і ')}. Яка вага правильна?`),
      details: { weight: a.weight, mentions: conflicting.map(({ path, sourceId, value, excerpt: e }) => ({ path, sourceId, value, excerpt: e })) },
    })];
  });
}

// 3. Повнота рядка: Weight, Performance Criteria, Deadline (high, по рядку)
function rowComplete(state) {
  return (state.assessments || []).flatMap((a, i) => {
    const missing = [!isNum(a.weight) && 'Weight', !filled(a.criteria) && 'Performance Criteria', !filled(a.deadline) && 'Deadline'].filter(Boolean);
    const missingUk = [!isNum(a.weight) && 'ваги', !filled(a.criteria) && 'критеріїв оцінювання', !filled(a.deadline) && 'дедлайну'].filter(Boolean);
    if (!missing.length) return [];
    return [makeCheck({
      rule: 'assessment.row_complete', entityId: a.id, severity: 'high', section: SECTION, path: 'assessments[]',
      message: tr(state, `"${componentLabel(a, i)}" has no ${missing.join(', ')}. Each component needs a weight, performance criteria and a deadline.`,
        `«${componentLabel(a, i)}» не має ${missingUk.join(', ')}. Кожен компонент потребує ваги, критеріїв оцінювання й дедлайну.`),
      details: { missing },
    })];
  });
}

// Шаблон: до 30 ак. год — щонайменше 2 компоненти, понад 30 — щонайменше 3 (critical, «must include»)
function componentCount(state) {
  const count = (state.assessments || []).length;
  if (!count) return []; // порожній розділ — прогалина повноти, не порушення правила
  const { contactHours } = totals(state);
  if (!isNum(contactHours)) {
    return [makeCheck({
      rule: 'assessment.component_count', severity: 'info', section: SECTION, path: 'sessions[].hours',
      message: tr(state, 'Add session durations to enable this check: the required number of assessment components depends on contact hours.', 'Додайте тривалість занять, щоб увімкнути цю перевірку: потрібна кількість компонентів оцінювання залежить від аудиторних годин.'),
      details: { components: count, contactHours: null },
    })];
  }
  const required = contactHours <= SMALL_COURSE_HOURS ? 2 : 3;
  if (count >= required) return [];
  return [makeCheck({
    rule: 'assessment.component_count', severity: 'critical', section: SECTION, path: 'assessments[]',
    message: tr(state, `A course with ${fmt(contactHours)} contact hours must include at least ${required} assessment components; this syllabus has ${count}.`,
      `Курс на ${fmt(contactHours)} аудиторних год має містити щонайменше ${required} компоненти оцінювання; у силабусі — ${count}.`),
    details: { components: count, required, contactHours, thresholdHours: SMALL_COURSE_HOURS },
  })];
}

// Обґрунтування в Performance Criteria: ключове слово і більше одного речення
const isJustified = (text) => /\b(justif\w*|because|due to)\b|обґрунтов|оскільки|через те/i.test(text || '') && sentences(text).length > 1;

// Шаблон: participation ≤ 30% (warning, «should normally … unless clearly justified»)
function participationShare(state) {
  const rows = (state.assessments || []).filter((a) => a.isParticipation && isNum(a.weight));
  if (!rows.length) return [];
  const share = rows.reduce((acc, a) => acc + a.weight, 0);
  if (share <= PARTICIPATION_LIMIT) return [];
  const justified = rows.some((a) => isJustified(a.criteria));
  const ids = rows.map((a) => a.id);
  if (justified) {
    return [makeCheck({
      rule: 'assessment.participation_share', severity: 'info', section: SECTION, path: 'assessments[].criteria', passed: true,
      message: tr(state, `Participation accounts for ${fmt(share)}% of the grade, above the usual ${PARTICIPATION_LIMIT}%; the Performance Criteria explain why.`,
        `Активність становить ${fmt(share)}% оцінки — більше за звичні ${PARTICIPATION_LIMIT}%; критерії оцінювання пояснюють чому.`),
      details: { share, limit: PARTICIPATION_LIMIT, componentIds: ids, justified: true },
    })];
  }
  return [makeCheck({
    rule: 'assessment.participation_share', severity: 'warning', section: SECTION, path: 'assessments[].weight',
    message: tr(state, `Participation accounts for ${fmt(share)}% of the grade. The school template expects no more than ${PARTICIPATION_LIMIT}% unless it is clearly justified. What is the reason for this weight? I will add it to the Performance Criteria.`,
      `Активність становить ${fmt(share)}% оцінки. Шаблон школи передбачає не більше ${PARTICIPATION_LIMIT}%, якщо немає чіткого обґрунтування. Чим зумовлена така вага? Я додам пояснення до критеріїв оцінювання.`),
    details: { share, limit: PARTICIPATION_LIMIT, componentIds: ids, justified: false },
  })];
}

// Дедлайн у межах терму: не раніше початку і не пізніше кінця + 30 днів (warning)
function deadlinesInTerm(state) {
  const term = courseTerm(state);
  const start = term && parseDate(term.start);
  const end = term && parseDate(term.end);
  if (!isNum(start) || !isNum(end)) return [];
  return (state.assessments || []).flatMap((a, i) => {
    const due = parseDate(a.deadline);
    if (!isNum(due)) return [];
    const early = due < start;
    const late = due > end + DEADLINE_GRACE_DAYS * DAY;
    if (!early && !late) return [];
    const where = early ? `before the course starts (${term.start})` : `more than ${DEADLINE_GRACE_DAYS} days after the course ends (${term.end})`;
    const whereUk = early ? `до початку курсу (${term.start})` : `більш ніж через ${DEADLINE_GRACE_DAYS} днів після завершення курсу (${term.end})`;
    return [makeCheck({
      rule: 'assessment.deadline_in_term', entityId: a.id, severity: 'warning', section: SECTION, path: 'assessments[].deadline',
      message: tr(state, `The deadline for "${componentLabel(a, i)}" (${isoDay(due)}) falls ${where}. Is this date correct?`,
        `Дедлайн «${componentLabel(a, i)}» (${isoDay(due)}) припадає ${whereUk}. Чи правильна ця дата?`),
      details: { deadline: isoDay(due), term: { start: term.start, end: term.end, source: term.source }, graceDays: DEADLINE_GRACE_DAYS },
    })];
  });
}

const run = (state) => [
  ...weightsTotal(state), ...weightConsistency(state), ...rowComplete(state),
  ...componentCount(state), ...participationShare(state), ...deadlinesInTerm(state),
];

module.exports = { run, weightMentions, isJustified };
