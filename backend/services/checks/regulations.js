// Положення про організацію освітнього процесу KSE і Політика ШІ (ТЗ §2) — лише з даних стану, без LLM.
// Зіставлення компонент ↔ категорії заборон ШІ — судження моделі, воно в checks/llm.js.
const { policyDecided } = require('../syllabusState/slots');
const { tr, pluralUk, makeCheck, filled, policyOf, textSources, sentences, excerpt, findPhrase } = require('./common');

// Режими довідника policy.ai_mode, що дозволяють ШІ
const AI_PERMITTING_MODES = ['ai_mode_disclosure', 'ai_mode_scoped', 'ai_mode_required'];
// Розділ 3 Політики ШІ; запасний перелік, якщо в довіднику не знайдено рядка «Prohibited (…): …»
const AI_PROHIBITED_FALLBACK = [
  'essays, research papers, term papers and literature reviews',
  'answers to exams, quizzes and tests',
  'calculation and analytical work where the reasoning must be the student’s own',
  'debates and oral presentations',
  'analysis of primary sources',
];
// Політики про доброчесність і ШІ згадують «penalties» за порушення, а не бонусні/штрафні бали оцінювання
const MISCONDUCT_POLICIES = new Set(['policy.integrity', 'policy.ai_mode', 'policy.ai_place']);

const ALTERNATIVE_RE = /\b(alternative|make-?up|substitute|replacement)\s+(tasks?|assignments?|assessments?|exams?|tests?|work)\b|альтернативн\S*\s+завдан/i;
const RETAKE_RE = /\b(re-?sit\w*|re-?tak\w*|second attempt|repeat (?:the )?(?:exam|test|assessment))\b|перескла\S*|повторн\S*\s+(?:склада|проход)\S*/gi;
// «retake the course» — наслідок пропусків (правило відвідування), а не перескладання контрольного заходу
const WHOLE_COURSE_RE = /^\s+(?:the\s+|this\s+|a\s+)?(?:course|class|module|subject)\b|^\s+курс/i;
const BONUS_RE = /\b(bonus\w*|extra (?:credit|points?)|penalt\w*|penali[sz]\w*|deduct\w*)\b|бонус\S*|штраф\S*|додатков\S*\s+бал\S*/i;
const QUANTITY_RE = /\d+(?:[.,]\d+)?\s*(?:[\p{L}-]+\s+){0,2}?(?:%|percent\b|points?\b|pts\b|marks?\b|бал\S*|відсот\S*)/iu;
// Механізм описаний словами, хоч розмір не названо: «reduction of the maximum possible score», «will receive zero», «added to the final grade»
const SCORE = '(?:scores?|grades?|marks?|points?)';
const EFFECT_RES = [
  new RegExp(`\\b(?:reduc\\w+|lower\\w*|decreas\\w+|deduct\\w*|subtract\\w*|los[ei]\\w*|forfeit\\w*)\\b[^.]{0,80}\\b${SCORE}\\b`, 'i'),
  new RegExp(`\\b${SCORE}\\b[^.]{0,60}\\b(?:reduc\\w+|lower\\w*|decreas\\w+|deduct\\w*)`, 'i'),
  /\b(?:receiv\w+|get|gets|earn\w*|assigned|given)\b[^.]{0,30}\b(?:zero|0)\b/i,
  /\b(?:not be accepted|will not be graded|will not be assessed)\b/i,
  new RegExp(`\\b(?:add\\w*|award\\w*|increas\\w+|credited)\\b[^.]{0,60}\\b${SCORE}\\b`, 'i'),
  /(?:знижен\S*|зменшен\S*|віднім\S*)[^.]{0,60}бал\S*|отрим\S*[^.]{0,20}\b0\b/i,
];
const OPTIONAL_RE = /\b(optional|voluntary|non-?mandatory|not (?:mandatory|compulsory|required))\b|необов['’ʼ]?язков\S*|за бажанням|добровільн\S*/i;
// Прохідний бал: «pass … N», «minimum of N points», «прохідний бал N»
const PASSING_PATTERNS = [
  /\bpass(?:ing)?\s+(?:mark|grade|score|threshold|level)\b[^.\d]{0,30}(\d{1,3})\b/i,
  /\b(?:to\s+pass|pass(?:ing)?\s+the\s+course|pass\s+this\s+course)\b[^.]{0,80}?(?:at\s+least|a\s+minimum\s+of|minimum(?:\s+of)?|no\s+less\s+than|not\s+less\s+than)\s*(\d{1,3})\s*(?:points?|%|marks?|out\s+of|\/\s*100)/i,
  /\b(\d{1,3})\s*(?:points?|%|marks?)?\s+(?:is|are)\s+(?:the\s+)?(?:minimum\s+)?(?:required|needed)\s+to\s+pass\b/i,
  /прохідн\S*\s+(?:бал|поріг)\S*[^.\d]{0,30}(\d{1,3})/i,
  /(?:мінімум|щонайменше|не\s+менше)\s+(\d{1,3})\s+бал\S*[^.]{0,60}(?:зарах|склас|пройти|успішн)/i,
];
// «minimum of N points» без «pass» у реченні — не про прохідний бал (напр., мінімум за активність)
const MINIMUM_POINTS_RE = /\bminimum\s+of\s+(\d{1,3})\s+points?\b/i;
const PASS_CONTEXT_RE = /\bpass|\bfinal\s+(?:grade|score)|\boverall\s+(?:grade|score)|зарах/i;
const PASSING_SCORE = 60;

// Тексти з назвами компонентів (назва теж може казати «Bonus quiz» чи «Optional essay»)
const sources = (state) => [
  ...(state.assessments || []).filter((a) => filled(a.name)).map((a) => ({ path: 'assessments[].name', section: 'assessment', entityId: a.id, text: a.name })),
  ...textSources(state),
];

const mentionsRetake = (sentence) => [...sentence.matchAll(RETAKE_RE)]
  .some((m) => !WHOLE_COURSE_RE.test(sentence.slice(m.index + m[0].length)));

// Згадки по реченнях: test — regex або предикат; [{ path, section, sourceId, sentence }]
function findMentions(list, test) {
  const match = typeof test === 'function' ? test : (s) => test.test(s);
  return list.flatMap((src) => sentences(src.text).filter(match)
    .map((s) => ({ path: src.path, section: src.section, sourceId: src.entityId || src.policyKey || null, policyKey: src.policyKey, sentence: s })));
}
const publicMention = ({ path, sourceId, sentence }) => ({ path, sourceId, excerpt: excerpt(sentence) });

// critical, 2.5.6(1): альтернативні завдання для тих, хто з поважних причин пропустив контрольний захід
function alternativeTasks(state) {
  const hasComp = (state.compensation?.items || []).some((c) => c.group === 'comp');
  const inPolicies = (state.policies || []).some((p) => ALTERNATIVE_RE.test(p.text || ''));
  if (hasComp || inPolicies) return [];
  return [makeCheck({
    rule: 'regulations.alternative_tasks', severity: 'critical', section: 'assessment', path: 'compensation.items[]',
    message: tr(state, 'The syllabus must offer an alternative task to students who miss an assessment for a valid reason (Regulations 2.5.6(1)). What alternative task will you offer?',
      'Силабус має передбачати альтернативне завдання для студентів, які пропустили контроль з поважної причини (Положення, п. 2.5.6(1)). Яке альтернативне завдання ви запропонуєте?'),
    details: { regulation: '2.5.6(1)' },
  })];
}

// critical, 2.5.4(2): прохідний бал — 60
function passingScore(state) {
  const found = textSources(state).flatMap((src) => sentences(src.text).flatMap((s) => {
    const values = PASSING_PATTERNS.map((re) => s.match(re)).filter(Boolean).map((m) => Number(m[1]));
    const min = s.match(MINIMUM_POINTS_RE);
    if (min && PASS_CONTEXT_RE.test(s)) values.push(Number(min[1]));
    return [...new Set(values)].filter((v) => v !== PASSING_SCORE)
      .map((value) => ({ value, path: src.path, section: src.section, sourceId: src.entityId || src.policyKey || null, sentence: s }));
  }));
  if (!found.length) return [];
  const values = [...new Set(found.map((f) => f.value))];
  return [makeCheck({
    rule: 'regulations.passing_score', severity: 'critical', section: found[0].section, path: found[0].path,
    message: tr(state, `The syllabus sets a passing score of ${values.join(' / ')}. Under the Regulations (2.5.4(2)) a student passes with at least ${PASSING_SCORE} out of 100 points.`,
      `Силабус встановлює прохідний бал ${values.join(' / ')}. За Положенням (п. 2.5.4(2)) курс зараховано від ${PASSING_SCORE} зі 100 балів.`),
    details: { regulation: '2.5.4(2)', required: PASSING_SCORE, found: found.map((f) => ({ value: f.value, ...publicMention(f) })) },
  })];
}

// high, 2.5.6(4), умовна: якщо згадано перескладання — порядок має бути описаний
function retake(state) {
  const mentions = findMentions(sources(state), mentionsRetake);
  if (!mentions.length) return [];
  const described = (state.compensation?.items || []).some((c) => c.group === 'retake')
    || mentions.some((m) => m.path.startsWith('policies'));
  if (described) return [];
  return [makeCheck({
    rule: 'regulations.retake', severity: 'high', section: 'assessment', path: 'compensation.items[]',
    message: tr(state, 'The syllabus mentions a retake, but does not describe how it works (Regulations 2.5.6(4)). How can a student retake an assessment, and how is it graded?',
      'Силабус згадує перескладання, але не описує його порядок (Положення, п. 2.5.6(4)). Як студент може перескласти контроль і як його оцінюють?'),
    details: { regulation: '2.5.6(4)', mentions: mentions.map(publicMention) },
  })];
}

// high, 2.4.3: вимоги щодо відвідування присутні
function attendance(state) {
  const p = policyOf(state, 'policy.attendance');
  if (p && (policyDecided(p) || filled(p.text))) return [];
  return [makeCheck({
    rule: 'regulations.attendance', severity: 'high', section: 'policies', path: 'policies{policy.attendance}',
    message: tr(state, 'The syllabus has no attendance requirements (Regulations 2.4.3). Which attendance rule applies to this course?',
      'У силабусі немає вимог до відвідування (Положення, п. 2.4.3). Яке правило відвідування діє в курсі?'),
    details: { regulation: '2.4.3' },
  })];
}

// medium, 2.5.4(1), умовна: бонусні/штрафні бали, якщо згадуються, описані (розмір або механізм впливу на оцінку)
function bonusPenalty(state) {
  const mentions = findMentions(sources(state).filter((s) => !MISCONDUCT_POLICIES.has(s.policyKey)), BONUS_RE)
    .filter((m) => !QUANTITY_RE.test(m.sentence) && !EFFECT_RES.some((re) => re.test(m.sentence)));
  if (!mentions.length) return [];
  return [makeCheck({
    rule: 'regulations.bonus_penalty', severity: 'medium', section: mentions[0].section, path: mentions[0].path,
    message: tr(state, 'The syllabus mentions bonus or penalty points without saying how they work (Regulations 2.5.4(1)). How many points are added or deducted, and when?',
      'Силабус згадує бонусні чи штрафні бали, але не пояснює, як вони працюють (Положення, п. 2.5.4(1)). Скільки балів додається чи знімається і коли?'),
    details: { regulation: '2.5.4(1)', mentions: mentions.map(publicMention) },
  })];
}

// warning: правила ШІ зафіксовані в силабусі або в інструкціях до завдань
function aiRules(state) {
  const place = policyOf(state, 'policy.ai_place');
  const mode = policyOf(state, 'policy.ai_mode');
  if (place?.optionKey === 'ai_place_assignments') return [];
  if (mode && policyDecided(mode)) return [];
  return [makeCheck({
    rule: 'regulations.ai_rules', severity: 'warning', section: 'policies', path: 'policies{policy.ai_mode}',
    message: tr(state, 'The syllabus does not state the rules for AI use yet. Which option fits the course, or are the rules given in each assignment brief?',
      'Силабус ще не визначає правил використання ШІ. Який варіант підходить курсу, чи правила подано в кожному завданні?'),
    details: { aiModeOption: mode?.optionKey || null, aiPlaceOption: place?.optionKey || null },
  })];
}

/** Перелік заборонених категорій (Політика ШІ, розд. 3) з довідника політик програми. */
function aiProhibitedCategories(refs) {
  const block = (refs?.policyLibrary?.blocks || []).find((b) => b.key === 'policy.ai_mode');
  for (const option of block?.options || []) {
    const line = String(option.text || '').split('\n').find((l) => /^\s*Prohibited\b/i.test(l));
    if (!line) continue;
    const list = line.replace(/^[^:]*:\s*/, '').replace(/\.\s*$/, '').split(/\s*;\s*/).filter(Boolean);
    if (list.length) return list;
  }
  return AI_PROHIBITED_FALLBACK;
}

/**
 * Детермінована частина перевірки «дозвіл ШІ ↔ заборони»: чи обрано режим, що дозволяє ШІ, і чи є компоненти.
 * Саме зіставлення компонент ↔ категорія робить checks/llm.js.
 */
function aiPermissionScope(state, refs) {
  const p = policyOf(state, 'policy.ai_mode');
  const mode = p?.optionKey || null;
  const components = (state.assessments || []).filter((a) => filled(a.name));
  const option = (refs?.policyLibrary?.blocks || []).find((b) => b.key === 'policy.ai_mode')?.options?.find((o) => o.key === mode);
  return {
    applicable: AI_PERMITTING_MODES.includes(mode) && components.length > 0,
    mode, policyText: p?.text || option?.text || null,
    components, categories: aiProhibitedCategories(refs),
  };
}

// critical (через LLM): дозвіл ШІ не перетинається із забороненими категоріями. Тут — лише позначка, що звірка потрібна.
function aiProhibitions(state, refs) {
  const scope = aiPermissionScope(state, refs);
  if (!scope.applicable) return [];
  return [makeCheck({
    rule: 'regulations.ai_prohibitions', severity: 'info', section: 'policies', path: 'policies{policy.ai_mode}', passed: true,
    message: tr(state, `AI use is permitted in this course, so each assessment component is cross-checked against the uses the KSE AI Policy prohibits (section 3).`,
      'У курсі дозволено використання ШІ, тож кожен компонент оцінювання звіряється із забороненими способами за Політикою KSE щодо ШІ (розділ 3).'),
    details: { mode: scope.mode, componentIds: scope.components.map((a) => a.id), categories: scope.categories, needsJudgement: true },
  })];
}

// medium, 2.4.3: силабус не називає контрольний захід необов'язковим
function controlMandatory(state) {
  const list = sources(state);
  const attendanceOption = policyOf(state, 'policy.attendance')?.optionKey || null;
  return (state.assessments || []).filter((a) => a.isControl && filled(a.name)).flatMap((a) => {
    const mentions = list.flatMap((src) => sentences(src.text)
      .filter((s) => OPTIONAL_RE.test(s) && (src.entityId === a.id && src.path.startsWith('assessments') || findPhrase(s, a.name).length))
      .map((s) => ({ path: src.path, section: src.section, sourceId: src.entityId || src.policyKey || null, sentence: s })));
    if (!mentions.length) return [];
    return [makeCheck({
      rule: 'regulations.control_mandatory', entityId: a.id, severity: 'medium', section: 'assessment', path: mentions[0].path,
      message: tr(state, `"${a.name}" is a control assessment, but the syllabus describes it as optional. Control assessments are compulsory under the Regulations (2.4.3). Is it meant to be optional?`,
        `«${a.name}» — контрольний захід, але силабус описує його як необов'язковий. За Положенням (п. 2.4.3) контрольні заходи обов'язкові. Він справді має бути необов'язковим?`),
      details: { regulation: '2.4.3', attendanceOption, mentions: mentions.map(publicMention) },
    })];
  });
}

// info, 2.4.5(1): мова силабуса — українська або англійська
const LANGUAGES = { en: 'English', english: 'English', uk: 'Ukrainian', ua: 'Ukrainian', ukrainian: 'Ukrainian', 'українська': 'Ukrainian', 'англійська': 'English' };
function language(state) {
  const raw = [state.language, state.header?.language].filter(filled).map((x) => String(x).trim().toLowerCase());
  const known = raw.map((x) => LANGUAGES[x]).filter(Boolean);
  if (known.length) {
    return [makeCheck({
      rule: 'regulations.language', severity: 'info', section: 'at_a_glance', path: 'language', passed: true,
      message: tr(state, `The syllabus is in ${known[0]}, as the Regulations allow (2.4.5(1)).`, `Силабус ${known[0] === 'Ukrainian' ? 'українською' : 'англійською'}, як дозволяє Положення (п. 2.4.5(1)).`),
      details: { regulation: '2.4.5(1)', language: known[0] },
    })];
  }
  return [makeCheck({
    rule: 'regulations.language', severity: 'info', section: 'at_a_glance', path: 'header.language',
    message: raw.length
      ? tr(state, `The syllabus language is given as "${raw[0]}". The Regulations (2.4.5(1)) expect Ukrainian or English. Which language is the course taught in?`,
        `Мову силабуса зазначено як «${raw[0]}». Положення (п. 2.4.5(1)) передбачає українську або англійську. Якою мовою викладається курс?`)
      : tr(state, 'The syllabus language is not set. The Regulations (2.4.5(1)) expect Ukrainian or English.', 'Мову силабуса не вказано. Положення (п. 2.4.5(1)) передбачає українську або англійську.'),
    details: { regulation: '2.4.5(1)', language: raw[0] || null },
  })];
}

const run = (state, refs) => [
  ...alternativeTasks(state), ...passingScore(state), ...aiProhibitions(state, refs), ...retake(state),
  ...attendance(state), ...bonusPenalty(state), ...controlMandatory(state), ...aiRules(state), ...language(state),
];

module.exports = { run, aiPermissionScope, aiProhibitedCategories, AI_PERMITTING_MODES };
