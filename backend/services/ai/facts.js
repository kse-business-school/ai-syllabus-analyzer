// Серверний сканер фактів для proposedValues (CLAUDE.md §0, ТЗ §4 «Механіка proposed_values»).
// Будь-яке число, відсоток, тривалість, дата, час або назва в лапках у чернетці моделі, яких немає
// в репліках викладача і в довідниках, мусить потрапити в proposedValues — навіть якщо модель їх не вказала.

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const UNITS = 'hours?|hrs?|h|days?|weeks?|months?|minutes?|mins?|points?|pts?|ac(?:ademic)?\\.? hours?|ects|credits?|percent|%|times|slides?|pages?|words?';
const NUM = '\\d+(?:[.,]\\d+)?';
const WORDNUM = `(?:${Object.keys(NUMBER_WORDS).join('|')})(?:[- ](?:${Object.keys(NUMBER_WORDS).join('|')}))?`;
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

// Порядок важливий: довші шаблони раніше, щоб «48 hours» не розпалось на «48»
const PATTERNS = [
  { label: 'Date', re: new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}\\b|\\b(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTHS})(?:,? \\d{4})?\\b`, 'gi') },
  { label: 'Time', re: /\b\d{1,2}[:.]\d{2}\s?(?:[–-]\s?\d{1,2}[:.]\d{2})?\s?(?:am|pm)?\b/gi },
  { label: 'Percentage', re: new RegExp(`\\b${NUM}\\s?%|\\b${NUM} percent\\b|\\b${WORDNUM} percent\\b`, 'gi') },
  { label: 'Quantity', re: new RegExp(`\\b(?:${NUM}|${WORDNUM})(?:\\s?[-–]\\s?(?:${NUM}))?[- ](?:${UNITS})\\b`, 'gi') },
  { label: 'Title', re: /“[^”]{3,120}”|"[^"]{3,120}"|«[^»]{3,120}»/g },
  { label: 'Number', re: new RegExp(`\\b${NUM}\\b`, 'g') },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[“”"«»]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

// Число — окреме слово: «clo3», «b0012», «obj2» чисел не дають, «2nd» дає 2; слова-числа — теж лише цілі («often» ≠ ten)
const DIGITS_RE = /(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)?(?=(?:st|nd|rd|th)?(?![\p{L}\p{N}_]))/gu;
const WORDNUM_RE = new RegExp(`(?<![\\p{L}])(?:${WORDNUM})(?![\\p{L}])`, 'giu');

/** Числа, які містить фрагмент (для порівняння «48 hours» з «48-hour» у репліці викладача). */
function numbersOf(text) {
  const t = norm(text);
  const digits = t.match(DIGITS_RE) || [];
  const words = (t.match(WORDNUM_RE) || []).map((w) => w.split(/[- ]/).reduce((sum, part) => sum + (NUMBER_WORDS[part] || 0), 0));
  return [...digits.map((d) => d.replace(',', '.')), ...words.map(String)];
}

// Сімейства одиниць: «48 hours», «48-hour», «48h», «48 hrs» — одна одиниця; «48 students» — інша
const UNIT_FAMILIES = [
  ['hour', /^(?:hours?|hrs?|h|годин\p{L}*)$/u],
  ['minute', /^(?:minutes?|mins?|хвилин\p{L}*)$/u],
  ['day', /^(?:days?|дн\p{L}*|день|доби|діб)$/u],
  ['week', /^(?:weeks?|тижд\p{L}*|тижн\p{L}*)$/u],
  ['month', /^(?:months?|місяц\p{L}*)$/u],
  ['point', /^(?:points?|pts?|бал\p{L}*)$/u],
  ['credit', /^(?:ects|credits?|кредит\p{L}*)$/u],
  ['percent', /^(?:%|percent|відсот\p{L}*)$/u],
  ['times', /^(?:times|рази?|разів)$/u],
  ['slide', /^slides?$/u],
  ['page', /^(?:pages?|сторін\p{L}*)$/u],
  ['word', /^(?:words?|слів)$/u],
];
const familyOf = (token) => (UNIT_FAMILIES.find(([, re]) => re.test(token)) || [null])[0];
// Скільки слів між числом і одиницею в репліці викладача («48 hours», «hours: 48», «a 48 hour grace», «48 academic hours»)
const UNIT_WINDOW = 3;

/** Токени: числа (у т. ч. слова-числа → цифри), «%», слова. */
function tokensOf(text) {
  return (norm(text).match(/\d+(?:[.,]\d+)?|%|\p{L}+/gu) || []).map((t) => (NUMBER_WORDS[t] !== undefined ? String(NUMBER_WORDS[t]) : t.replace(',', '.')));
}
const isNumberToken = (t) => /^\d/.test(t);

/** Пари «число|сімейство одиниці», які викладач назвав поруч (у вікні UNIT_WINDOW слів). */
function quantitiesOf(text) {
  const tokens = tokensOf(text);
  const out = new Set();
  tokens.forEach((t, i) => {
    if (!isNumberToken(t)) return;
    for (let j = Math.max(0, i - UNIT_WINDOW); j <= Math.min(tokens.length - 1, i + UNIT_WINDOW); j += 1) {
      const family = j !== i && familyOf(tokens[j]);
      if (family) out.add(`${t}|${family}`);
    }
  });
  return out;
}

const MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Дата як множина чисел (назва місяця → номер, без ведучих нулів): «Dec 1, 2026» ≡ «2026-12-01» ≡ «1 December 2026». */
function dateParts(text) {
  const t = norm(text);
  const parts = (t.match(/\d+/g) || []).map((n) => String(Number(n)));
  const month = MONTH_INDEX.findIndex((m) => new RegExp(`\\b${m}`).test(t));
  if (month >= 0) parts.push(String(month + 1));
  return new Set(parts);
}
const DATE_RE = PATTERNS.find((p) => p.label === 'Date').re;
const TIME_RE = PATTERNS.find((p) => p.label === 'Time').re;
const subset = (a, b) => [...a].every((x) => b.has(x));

/** Корпус відомого: точний текст, усі числа, числа з одиницями, дати й часи. */
function corpusOf(known) {
  const text = known.join('\n');
  const corpus = norm(text);
  return {
    text: corpus,
    numbers: new Set(numbersOf(corpus)),
    quantities: quantitiesOf(text),
    dates: [...corpus.matchAll(new RegExp(DATE_RE.source, 'gi'))].map((m) => dateParts(m[0])),
    times: [...corpus.matchAll(new RegExp(TIME_RE.source, 'gi'))].map((m) => dateParts(m[0])),
  };
}

/**
 * Факт уже названо викладачем або довідником. Число зараховується лише з тією самою одиницею
 * (A09: «We have 48 students» не робить відомим «48 hours»); дата — з тими самими днем/місяцем/роком;
 * назва в лапках — лише точний збіг; голе число без одиниці — якщо воно є в корпусі.
 */
function isKnownFact(label, value, corpus) {
  const v = norm(value);
  if (corpus.text.includes(v)) return true;
  if (label === 'Title') return false;
  const nums = numbersOf(value);
  if (!nums.length) return false;
  if (label === 'Date') {
    const parts = dateParts(value);
    return corpus.dates.some((d) => subset(parts, d));
  }
  if (label === 'Time') {
    const parts = dateParts(value);
    return corpus.times.some((d) => subset(parts, d));
  }
  if (label === 'Quantity' || label === 'Percentage') {
    const family = label === 'Percentage' ? 'percent' : tokensOf(value).map(familyOf).filter(Boolean).pop();
    if (!family) return nums.every((n) => corpus.numbers.has(n));
    return nums.every((n) => corpus.quantities.has(`${n}|${family}`));
  }
  return nums.every((n) => corpus.numbers.has(n));
}

/**
 * Знаходить факти в тексті чернетки, яких немає в корпусі відомого (репліки викладача, довідники, поточний стан).
 * @param {string} text чернетка моделі
 * @param {{ known?: string[] }} opts known — тексти, з яких факт вважається вже названим
 * @returns {{ id: string, label: string, value: string }[]} у порядку появи, без дублікатів
 */
function scanFacts(text, { known = [] } = {}) {
  const src = String(text || '');
  const corpus = corpusOf(known);
  const taken = [];
  const found = [];
  for (const { label, re } of PATTERNS) {
    for (const m of src.matchAll(re)) {
      const start = m.index; const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      const value = m[0].trim();
      const v = norm(value);
      if (isKnownFact(label, value, corpus)) continue;
      if (found.some((f) => norm(f.value) === v)) continue;
      found.push({ start, label, value });
    }
  }
  return found.sort((a, b) => a.start - b.start).map(({ label, value }, i) => ({ id: `v${i + 1}`, label, value }));
}

/**
 * Об'єднує значення, які назвала модель, зі знайденими сканером. Модельні мають пріоритет за підписом.
 * Повертає proposedValues для Suggestion.draft (усі confirmed: false).
 */
function mergeProposedValues(modelValues = [], scanned = []) {
  const out = [];
  const seen = new Set();
  for (const v of [...modelValues, ...scanned]) {
    // Факти полів сутностей (path '[id].поле') різні навіть з однаковим значенням: «2 h» у двох заняттях
    const key = norm(v.value) && `${v.path || ''}\u0000${norm(v.value)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `v${out.length + 1}`, label: v.label || 'Value', value: String(v.value), path: v.path || null, confirmed: false });
  }
  return out;
}

/**
 * Будує шаблон {{id}} з тексту: кожне входження значення proposedValues замінюється плейсхолдером.
 * Потрібен для «Change the value» без повторного виклику LLM.
 */
function toTemplate(text, proposedValues) {
  let template = String(text || '');
  for (const pv of [...proposedValues].sort((a, b) => b.value.length - a.value.length)) {
    if (!pv.value) continue;
    template = template.split(pv.value).join(`{{${pv.id}}}`);
  }
  return template;
}

/** Підставляє значення в шаблон. Невідомі плейсхолдери лишаються як є. */
function renderTemplate(template, proposedValues) {
  const byId = new Map(proposedValues.map((pv) => [pv.id, pv.value]));
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (all, id) => (byId.has(id) ? byId.get(id) : all));
}

module.exports = { scanFacts, mergeProposedValues, toTemplate, renderTemplate, numbersOf, isKnownFact, corpusOf };
