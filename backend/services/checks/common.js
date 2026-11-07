// Спільні хелпери детермінованих перевірок (ТЗ §2). Усе тут — чисті синхронні функції без БД і LLM.
const SEVERITIES = ['critical', 'high', 'medium', 'warning', 'info'];

/**
 * Check у формі docs/api-v5.md §3. id унікальний у межах результату: `rule` або `rule:entityId`
 * для перевірок по сутності; базове правило — у details.rule.
 */
function makeCheck({ rule, entityId = null, severity, section, path, message, details = {}, passed = false }) {
  return {
    id: entityId ? `${rule}:${entityId}` : rule,
    severity, section, path, message,
    details: { rule, ...(entityId ? { entityId } : {}), ...details },
    passed,
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const sameNumber = (a, b) => Math.abs(a - b) < 0.01;
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

/** Повідомлення перевірки мовою документа (B-1.3): uk — українською, інакше англійською. */
const tr = (state, en, uk) => (state?.language === 'uk' ? uk : en);
/** Множина для української: 1 компонент, 2 компоненти, 5 компонентів. */
function pluralUk(n, [one, few, many]) {
  const k = Math.abs(n) % 100; const d = k % 10;
  const word = k > 10 && k < 20 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many;
  return `${fmt(n)} ${word}`;
}

const policyOf = (state, key) => (state.policies || []).find((p) => p.key === key) || null;

// Сума, лише якщо всі значення відомі (інакше null: частковий підсумок вводить в оману)
function sumAll(items, get) {
  if (!items.length || !items.every((x) => isNum(get(x)))) return null;
  return items.reduce((acc, x) => acc + get(x), 0);
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Підсумки тіла силабуса. E-поля header.computed — основне джерело (їх перераховує store.mutate);
 * якщо поле ще порожнє, рахуємо з сутностей тим самим правилом.
 */
function totals(state) {
  const c = state.header?.computed || {};
  const sessions = state.sessions || [];
  const pick = (v, fallback) => (isNum(v) ? v : fallback());
  const sessionDates = sessions.map((s) => parseDate(s.date)).filter(isNum);
  const scheduleTerm = c.termFromSchedule?.start && c.termFromSchedule?.end
    ? { start: c.termFromSchedule.start, end: c.termFromSchedule.end }
    : sessionDates.length ? { start: isoDay(Math.min(...sessionDates)), end: isoDay(Math.max(...sessionDates)) } : null;
  return {
    contactHours: pick(c.contactHours, () => sumAll(sessions, (s) => s.hours)),
    selfStudyHours: pick(c.selfStudyHours, () => sumAll(state.individualWork || [], (w) => w.hours)),
    assessmentTotal: pick(c.assessmentTotal, () => {
      const weighted = (state.assessments || []).filter((a) => isNum(a.weight));
      return weighted.length ? weighted.reduce((acc, a) => acc + a.weight, 0) : null;
    }),
    deliveryModes: c.deliveryModes?.length ? c.deliveryModes : [...new Set(sessions.map((s) => s.format).filter(Boolean))],
    scheduleTerm,
  };
}

// Терм курсу: header.term, інакше діапазон дат розкладу
function courseTerm(state) {
  const t = state.header?.term;
  if (t?.start && t?.end) return { start: t.start, end: t.end, source: 'header.term' };
  const s = totals(state).scheduleTerm;
  return s ? { ...s, source: 'header.computed.termFromSchedule' } : null;
}

// --- Дати ---
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const utc = (y, m, d) => {
  const ms = Date.UTC(y, m, d);
  const back = new Date(ms);
  return back.getUTCMonth() === m && back.getUTCDate() === d ? ms : null;
};

/** Перша дата в тексті (ISO, dd.mm.yyyy, dd/mm/yyyy, «9 May 2026», «May 9, 2026») → UTC ms або null. */
function parseDate(text) {
  if (!filled(text)) return null;
  const s = String(text).toLowerCase();
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (m) return utc(+m[3], +m[2] - 1, +m[1]);
  m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})\\b`));
  if (m) return utc(+m[3], MONTHS.indexOf(m[2]), +m[1]);
  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`));
  if (m) return utc(+m[3], MONTHS.indexOf(m[1]), +m[2]);
  return null;
}

// --- Тексти стану ---
/**
 * Усі вільні тексти, де можуть згадуватися ваги, бали, перескладання тощо.
 * { path, section, entityId?, policyKey?, text }
 */
function textSources(state) {
  const out = [];
  const add = (path, section, text, extra = {}) => { if (filled(text)) out.push({ path, section, text: String(text), ...extra }); };
  for (const p of state.policies || []) add(`policies{${p.key}}.text`, 'policies', p.text, { policyKey: p.key });
  for (const a of state.assessments || []) {
    add('assessments[].criteria', 'assessment', a.criteria, { entityId: a.id });
    add('assessments[].deadline', 'assessment', a.deadline, { entityId: a.id });
  }
  for (const s of state.sessions || []) {
    add('sessions[].topic', 'schedule', s.topic, { entityId: s.id });
    add('sessions[].additional', 'schedule', s.additional, { entityId: s.id });
  }
  for (const c of state.compensation?.items || []) add('compensation.items[].text', 'assessment', c.text, { entityId: c.id });
  return out;
}

// Речення: розбиваємо за кінцевими знаками і переносами рядків
const sentences = (text) => String(text || '').split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

const excerpt = (text, max = 160) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normName = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Входження фрази в текст з межами слова (Unicode). Повертає [{ start, end }]. */
function findPhrase(text, phrase) {
  const p = normName(phrase);
  if (!p) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
  return [...String(text).normalize('NFC').matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

module.exports = {
  tr, pluralUk,
  SEVERITIES, makeCheck, isNum, filled, sameNumber, fmt, plural, policyOf, totals, courseTerm,
  parseDate, isoDay, textSources, sentences, excerpt, findPhrase, normName,
};
