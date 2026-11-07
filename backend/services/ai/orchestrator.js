// Аналіз силабусу v5, трек 2: parse (файл → Syllabus.state) → checks (детерміновані + м'які) → review (Ревізор) → картки.
// Стан пишеться лише через syllabusState/store.initState з умовою на lease; картки — через chat/draftSuggestions.
const Syllabus = require('../../models/Syllabus');
const Suggestion = require('../../models/Suggestion');
const SlotChange = require('../../models/SlotChange');
const { ownedAnalysis, assertLease } = require('../analysisLease');
const { httpError } = require('../../utils/httpError');
const store = require('../syllabusState/store');
const { renderState, renderText } = require('../syllabusState/render');
const references = require('../references');
const { parseToState } = require('./parse');
const { checksToCards, policyCards, courseHintCards, ploConfirmCards, programmeOutcomeCards } = require('./parse/cards');
const { reviewState } = require('./prompts/reviewer');
const { runChecks, runLlmChecks } = require('../checks');
const { createDraftSuggestions } = require('../chat/draftSuggestions');
const { resolveProfile } = require('../lecturers/profile');
const { prepareInstructor } = require('../lecturers/cards');

async function setStage(syllabusId, stage, leaseToken) {
  await assertLease(syllabusId, leaseToken);
  const updated = await Syllabus.updateOne(ownedAnalysis(syllabusId, leaseToken), { $set: { analysisStage: stage } });
  if (!updated.matchedCount) await assertLease(syllabusId, leaseToken);
}

// Збій допоміжного кроку не має губити результат парсингу: логуємо й продовжуємо без нього
async function optional(label, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'ANALYSIS_LEASE_LOST') throw error;
    console.error(`${label} failed:`, error.message);
    return fallback;
  }
}

// Тексти, з яких факт вважається вже названим викладачем (сканер фактів proposedValues)
function knownTexts(state, refs) {
  return [
    renderText(renderState(state, refs)),
    ...(state.policies || []).map((p) => p.text).filter(Boolean),
    ...(refs.policyLibrary?.blocks || []).flatMap((b) => [b.text, ...(b.options || []).map((o) => o.text)]).filter(Boolean),
  ];
}

/**
 * Повний аналіз силабусу з уже збереженим `document`. Попередні стан, журнал і картки замінюються.
 * @returns {Promise<{ suggestions: number, revision: number }>}
 */
async function analyzeSyllabus(syllabusId, { leaseToken } = {}) {
  await assertLease(syllabusId, leaseToken);
  const syllabus = await Syllabus.findById(syllabusId).lean();
  if (!syllabus) throw httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
  const blocks = syllabus.document?.blocks || [];
  if (!blocks.length) throw httpError(422, 'The document has not been read yet', { code: 'NO_DOCUMENT' });
  if (!syllabus.programCode) throw httpError(422, 'The syllabus has no programme edition. Choose it and upload the file again.', { code: 'PROGRAM_CODE_REQUIRED' });

  const refs = await references.getRefs(syllabus.programCode);

  // 1. parse: файл → стан
  await setStage(syllabusId, 'parse', leaseToken);
  const parsed = await parseToState({
    blocks, meta: { title: syllabus.title, courseName: syllabus.course?.name }, programCode: syllabus.programCode, refs,
    // Код курсу з призначення (курс × набір) або з форми upload: файл його може не містити
    course: { title: syllabus.course?.name || syllabus.title, code: syllabus.course?.code || null, fromOffering: Boolean(syllabus.offeringId) },
  });
  for (const warning of parsed.warnings) console.warn(`parse ${String(syllabusId)}: ${warning}`);
  const instructorCard = prepareInstructor(parsed.state, await resolveProfile(syllabus.instructor, { excludeSyllabusId: syllabusId }));

  await assertLease(syllabusId, leaseToken);
  await Suggestion.deleteMany({ syllabusId });
  await assertLease(syllabusId, leaseToken);
  await SlotChange.deleteMany({ syllabusId });
  let saved;
  try {
    saved = await store.initState(syllabusId, parsed.state, { setBaseline: true, refs, filter: ownedAnalysis(syllabusId, leaseToken) });
  } catch (error) {
    // Умова на lease не виконалась: цей запуск вже не власник
    if (error.code === 'STATE_CONFLICT') await assertLease(syllabusId, leaseToken);
    throw error;
  }
  const { state } = saved;

  // 2. checks: детерміновані перевірки (код) і м'які судження моделі → картки-питання, політики
  await setStage(syllabusId, 'checks', leaseToken);
  const checks = runChecks(state, refs);
  const softChecks = (await optional('soft checks', () => runLlmChecks(state, refs), []))
    .filter((c) => !String(c.id).startsWith('llm.unavailable'));
  const cards = [
    instructorCard,
    ...checksToCards([...checks, ...softChecks], state),
    ...policyCards(state, refs, { lockedNotes: parsed.lockedNotes }),
    ...courseHintCards(parsed.courseHint),
    ...ploConfirmCards(state, refs),
    ...programmeOutcomeCards(parsed.programmeOutcomes, state, refs),
  ];

  // 3. review: Ревізор оцінює якість формулювань вільних розділів
  await assertLease(syllabusId, leaseToken);
  await setStage(syllabusId, 'review', leaseToken);
  const reviewed = await optional('reviewer', () => reviewState({ state, refs, checks, blocks }), []);

  await assertLease(syllabusId, leaseToken);
  const created = await createDraftSuggestions([...cards, ...reviewed], {
    syllabusId, state, refs, known: knownTexts(state, refs),
  });
  const createdIds = created.map((c) => c._id);

  // deleteMany → insertMany не атомарні з lease: якщо lease перехопили між перевіркою і вставкою,
  // новий власник уже видалив старі картки, тож прибираємо лише свої (інакше — дублікати після перезапуску)
  let completed;
  try {
    completed = await Syllabus.updateOne(ownedAnalysis(syllabusId, leaseToken), {
      $set: { status: 'in_progress', analysisStage: 'done', needsRebuild: false, track: 'upload' },
      $unset: { analysisError: '' },
    });
  } catch (error) {
    await Suggestion.deleteMany({ _id: { $in: createdIds } });
    throw error;
  }
  if (!completed.matchedCount && leaseToken) {
    await Suggestion.deleteMany({ _id: { $in: createdIds } });
    await assertLease(syllabusId, leaseToken);
    throw Object.assign(new Error('The analysis is being continued by another process.'), { code: 'ANALYSIS_LEASE_LOST' });
  }
  return { suggestions: created.length, revision: saved.revision };
}

module.exports = { analyzeSyllabus };
