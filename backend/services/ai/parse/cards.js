// Трек 2: картки з детермінованих перевірок, політик і підказки про код курсу.
// Повертають входи для services/chat/draftSuggestions.createDraftSuggestions; тексти — англійською.
const { concretePath, sectionOfPath } = require('../../syllabusState/paths');
const { SECTION_KEYS } = require('../../syllabusState/schema');
const { policyDecided } = require('../../syllabusState/slots');
const { normalizePloCode } = require('../../checks/plo');

const PROMPT_VERSION = 'parse-cards-v1';

const TITLES = {
  'glance.assessment_total': 'At a Glance total does not match the assessment weights',
  'glance.contact_hours': 'At a Glance contact hours do not match the schedule',
  'glance.self_study_hours': 'At a Glance self-study hours do not match Individual work',
  'glance.delivery_mode': 'At a Glance delivery mode does not match the sessions',
  'glance.term': 'Schedule dates fall outside the stated term',
  'glance.instructor': 'At a Glance instructor does not match the instructor section',
  'assessment.weights_total': 'Assessment weights must add up to 100',
  'assessment.weight_consistency': 'A component weight is stated differently in different places',
  'assessment.row_complete': 'An assessment component is incomplete',
  'assessment.component_count': 'Number of assessment components',
  'assessment.participation_share': 'Participation weighs more than 30%',
  'assessment.deadline_in_term': 'A deadline is outside the course term',
  'workload.self_study_ratio': 'Self-study hours differ from the expected ratio',
  'regulations.alternative_tasks': 'Alternative task for a missed assessment',
  'regulations.passing_score': 'Passing score differs from the Regulations',
  'regulations.retake': 'Retake procedure is not described',
  'regulations.attendance': 'Attendance requirements are missing',
  'regulations.bonus_penalty': 'Bonus or penalty points have no stated size',
  'regulations.control_mandatory': 'A control assessment is described as optional',
  'regulations.ai_rules': 'Rules for AI use are not stated',
  'regulations.language': 'Syllabus language',
  'outcomes.clo_unassessed': 'A learning outcome has no assessment component',
  'plo.coverage': 'Programme learning outcome coverage',
  'plo.unknown_code': 'Unknown programme learning outcome code',
  'llm.ai_prohibition': 'AI use may overlap with a prohibited category',
  'llm.component_schedule': 'An assessment component has no matching session',
};

function titleOf(check) {
  const rule = check.details?.rule || String(check.id).split(':')[0];
  return TITLES[rule] || rule.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Конкретний шлях стану для перевірки: шаблон слота + id сутності. */
function targetOf(check) {
  const id = check.details?.entityId;
  const path = id && check.path.includes('[]') ? concretePath(check.path, { id }) : check.path;
  const section = SECTION_KEYS.includes(check.section) ? check.section : sectionOfPath(path);
  return { path, section, entityId: id || null };
}

/**
 * Картки-питання з непройдених перевірок (passed=false). Перевірка вже містить питання до викладача англійською.
 * @param {Check[]} checks  результат runChecks (+ runLlmChecks)
 * @param {object} state    Syllabus.state (зарезервовано: контекст для майбутніх картинок з варіантами)
 * @returns {object[]} входи createDraftSuggestions
 */
function checksToCards(checks, state) { // eslint-disable-line no-unused-vars
  return (checks || []).filter((c) => !c.passed && c.message && c.path).map((c) => ({
    origin: 'check',
    checkId: c.id,
    severity: c.severity,
    kind: 'question',
    title: titleOf(c),
    description: c.message,
    rationale: c.details?.regulation ? `Regulations ${c.details.regulation}` : 'Automatic check of the syllabus',
    question: c.message,
    target: targetOf(c),
    promptVersion: PROMPT_VERSION,
  }));
}

const excerpt = (text, max = 220) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Картки політик.
 *  - library-блок з текстом викладача (source 'parsed'), але без обраного варіанта → choice:
 *    «Use option X» (якщо є кандидат), «Keep my text», решта варіантів довідника. Блок не зараховується, доки викладач не обере;
 *  - locked-блок, текст якого у файлі відрізнявся, → info-картка без змін (applicable: false): у документі стоїть текст довідника.
 * @param {object} state
 * @param {object} refs
 * @param {{ lockedNotes?: Array<{ key, fileText, evidenceBlockIds }> }} extra
 */
function policyCards(state, refs, { lockedNotes = [] } = {}) {
  const blocks = new Map((refs?.policyLibrary?.blocks || []).map((b) => [b.key, b]));
  const cards = [];
  for (const p of state.policies || []) {
    const block = blocks.get(p.key);
    if (!block || p.mode !== 'library' || !p.text || policyDecided(p)) continue;
    const candidate = p.candidateOptionKey ? block.options.find((o) => o.key === p.candidateOptionKey) : null;
    const options = [
      ...(candidate ? [{ id: `use_${candidate.key}`, label: `Use the standard option: ${candidate.label}`, optionKey: candidate.key }] : []),
      { id: 'keep', label: 'Keep my text', value: p.text },
      ...block.options.filter((o) => o !== candidate).map((o) => ({ id: `opt_${o.key}`, label: o.label, optionKey: o.key })),
    ];
    cards.push({
      origin: 'check',
      checkId: `policy.choice:${p.key}`,
      severity: candidate ? 'info' : 'medium',
      kind: 'choice',
      title: candidate ? `${block.title}: your text matches a standard option` : `${block.title}: choose how to use your text`,
      description: candidate
        ? `Your syllabus text on "${block.title}" corresponds to the standard option "${candidate.label}". You can switch to the standard wording or keep your own text.`
        : `Your syllabus has its own text on "${block.title}" (${excerpt(p.text)}). It does not match a standard option. Keep it, or pick a standard option.`,
      rationale: block.rationale || '',
      target: { path: `policies{${p.key}}`, section: 'policies' },
      options,
      evidenceBlockIds: p.evidenceBlockIds || [],
      promptVersion: PROMPT_VERSION,
    });
  }
  for (const note of lockedNotes) {
    const block = blocks.get(note.key);
    if (!block) continue;
    cards.push({
      origin: 'check',
      checkId: `policy.locked:${note.key}`,
      severity: 'info',
      kind: 'edit',
      applicable: false,
      title: `${block.title}: the standard KSE text is used`,
      description: `The wording in your file differs from the fixed KSE text for "${block.title}", so the syllabus will use the standard text: "${excerpt(block.text)}" This block cannot be edited.`,
      rationale: block.rationale || '',
      target: { path: `policies{${note.key}}`, section: 'policies' },
      evidenceBlockIds: note.evidenceBlockIds || [],
      promptVersion: PROMPT_VERSION,
    });
  }
  return cards;
}

/**
 * Збіг назви курсу з нормативним курсом програми: код не ставимо автоматично, а пропонуємо вибір (C16).
 * Confirm записує код через ту саму перевірку призначення курс × набір, що й PUT (decisions → claimOfferingForCode).
 */
function courseHintCards(courseHint) {
  if (!courseHint) return [];
  return [{
    origin: 'check',
    checkId: 'course.code_hint',
    severity: 'info',
    kind: 'choice',
    choiceBasis: true,
    title: 'Is this a core course of the programme?',
    description: `The course title matches the core course "${courseHint.title}" (code ${courseHint.code}) of the programme. If it is the same course, confirm its code; core courses must cover programme learning outcomes.`,
    rationale: 'Core courses must cover programme learning outcomes',
    target: { path: 'header.courseCode', section: 'at_a_glance' },
    options: [
      { id: 'confirm', label: `Yes, the course code is ${courseHint.code}`, value: courseHint.code },
      { id: 'different', label: 'No, it is a different course', value: null },
    ],
    promptVersion: PROMPT_VERSION,
  }];
}

/**
 * Зв'язки CLO → ПРН, названі у файлі, мають confirmed: false і не зараховуються (checks/plo, plo/coverage),
 * доки викладач їх не підтвердить. Картка на кожен такий CLO: Confirm записує ті самі зв'язки з confirmed: true.
 */
function ploConfirmCards(state, refs) {
  const known = new Set((refs?.outcomes || []).map((o) => normalizePloCode(o.code)));
  const outcomes = state.outcomes || [];
  return outcomes
    .map((clo, i) => ({ clo, n: i + 1, links: (clo.plo || []).filter((p) => known.has(normalizePloCode(p.code))) }))
    .filter(({ links }) => links.length && links.some((p) => p.confirmed !== true))
    .map(({ clo, n, links }) => ({
      origin: 'check',
      checkId: `plo.confirm:${clo.id}`,
      severity: 'medium',
      kind: 'edit',
      title: `Confirm the programme outcome links of LO${n}`,
      description: `Your file links LO${n} to ${links.map((p) => `${p.code}${p.coverage === 'partial' ? ' (partial)' : ''}`).join(', ')}. `
        + 'Confirm these links so they count towards programme outcome coverage, or cancel and map the outcome again.',
      rationale: 'Links taken from the file count only after you confirm them.',
      target: { path: `outcomes[${clo.id}].plo`, entityId: clo.id, section: 'learning_outcomes' },
      value: links.map((p) => ({ code: p.code, coverage: p.coverage, confirmed: false })),
      source: 'instructor_directed',
      promptVersion: PROMPT_VERSION,
    }));
}

/**
 * ПРН із розділу «Зв'язок з результатами програми» файлу (B-8.8): файл називає їх для курсу загалом, а покриття
 * рахується за підтвердженими зв'язками окремих результатів навчання. Тому — питання: які CLO їх формують.
 * Нічого не записується в стан, доки викладач не підтвердить конкретні зв'язки.
 */
function programmeOutcomeCards(programmeOutcomes, state, refs) {
  const known = new Map((refs?.outcomes || []).map((o) => [normalizePloCode(o.code), o]));
  const listed = (programmeOutcomes || []).filter((p) => known.has(normalizePloCode(p.ploCode)));
  if (!listed.length || !(refs?.template || []).some((t) => t.key === 'programme_outcomes')) return [];
  const linked = new Set((state.outcomes || []).flatMap((o) => (o.plo || []).map((p) => normalizePloCode(p.code))));
  const open = listed.filter((p) => !linked.has(normalizePloCode(p.ploCode)));
  if (!open.length) return [];
  const uk = state.language === 'uk';
  const codes = open.map((p) => normalizePloCode(p.ploCode)).join(', ');
  return [{
    origin: 'check',
    checkId: 'plo.programme_section',
    severity: 'medium',
    kind: 'question',
    title: uk ? 'Які результати курсу формують названі ПРН?' : 'Which course outcomes build the programme outcomes you named?',
    description: uk
      ? `У файлі зазначено, що курс підсилює ${codes}. Покриття ПРН рахується за зв'язками окремих результатів навчання курсу.`
      : `Your file says the course strengthens ${codes}. Programme outcome coverage counts links of individual course learning outcomes.`,
    question: uk
      ? `Які результати навчання курсу формують ${codes}?`
      : `Which course learning outcomes build ${codes}?`,
    rationale: 'Links count only after you confirm them.',
    target: { path: 'outcomes[].plo', section: 'programme_outcomes' },
    promptVersion: PROMPT_VERSION,
  }];
}

module.exports = { checksToCards, policyCards, courseHintCards, ploConfirmCards, programmeOutcomeCards, titleOf, TITLES };
