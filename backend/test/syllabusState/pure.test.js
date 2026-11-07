// Чисті модулі syllabusState: empty, computed, paths, readiness, render, diff.
const { validateState } = require('../../services/syllabusState/schema');
const { createEmptyState } = require('../../services/syllabusState/empty');
const { recompute, computedWarnings } = require('../../services/syllabusState/computed');
const { getPath, setPath, updateEntity, changedPaths, sectionsTouched, sectionOfPath } = require('../../services/syllabusState/paths');
const { computeReadiness } = require('../../services/syllabusState/readiness');
const { renderState, CHOOSE_OPTION, FROM_FILE_NOTE } = require('../../services/syllabusState/render');
const { diffRendered, diffBlock } = require('../../services/syllabusState/diff');
const { loadFixtureRefs } = require('../../services/references/fixtureRefs');
const { riskManagementState } = require('../fixtures/state/riskManagement');

const refs27 = loadFixtureRefs('MBA27');
const refs28 = loadFixtureRefs('MBA28');

describe('createEmptyState', () => {
  test.each([['MBA27', refs27], ['MBA28', refs28]])('валідний для %s', (programCode, refs) => {
    const state = createEmptyState({ programCode, refs, course: { title: 'New course' } });
    expect(validateState(state)).toEqual([]);
    expect(state.programCode).toBe(programCode);
    expect(state.sections).toEqual({});
  });

  test('політики: усі 13 блоків, locked з текстом фікстури, library без дефолту', () => {
    const state = createEmptyState({ programCode: 'MBA28', refs: refs28, course: { title: 'X' } });
    expect(state.policies).toHaveLength(13);
    for (const p of state.policies) {
      const block = refs28.policyLibrary.blocks.find((b) => b.key === p.key);
      if (p.mode === 'locked') {
        expect(p).toMatchObject({ text: block.text, source: 'fixture', fixtureRef: { key: p.key, version: refs28.policyLibrary.version } });
      } else {
        expect(p).toMatchObject({ optionKey: null, text: null, source: null });
      }
    }
  });

  test('courseKind і ECTS — з ProgramCourse лише за кодом своєї програми', () => {
    const core = createEmptyState({ programCode: 'MBA27', refs: refs27, course: { title: 'Risk Management', code: 'НД.4' } });
    expect(core.header).toMatchObject({ courseKind: 'core', ects: 2 });
    // Той самий код у MBA28 — інший курс (Strategic Management, 4 ECTS)
    expect(createEmptyState({ programCode: 'MBA28', refs: refs28, course: { title: 'Risk Management', code: 'НД.4' } }).header.ects).toBe(4);
    // Збіг за назвою не робить курс нормативним
    const byName = createEmptyState({ programCode: 'MBA27', refs: refs27, course: { title: 'Risk Management' } });
    expect(byName.header).toMatchObject({ courseKind: 'elective', ects: null });
  });
});

describe('recompute', () => {
  test('Risk Management: contact 20, self-study 14, сума ваг 100, термін із розкладу', () => {
    const state = riskManagementState();
    state.header.computed = { ...state.header.computed, contactHours: 0, selfStudyHours: 0, assessmentTotal: 0, deliveryModes: [], termFromSchedule: { start: null, end: null } };
    const { computed } = recompute(state, refs28).header;
    expect(computed).toEqual({
      contactHours: 20, lectureHours: null, practiceHours: null, workshopHours: null,
      selfStudyHours: 14, assessmentTotal: 100, deliveryModes: ['hybrid'],
      termFromSchedule: { start: '2026-04-25', end: '2026-05-09' },
    });
    expect(computedWarnings(state)).toEqual([]);
  });

  test('чиста функція: вхідний стан не змінюється', () => {
    const state = riskManagementState();
    const copy = structuredClone(state);
    recompute(state, refs27);
    expect(state).toEqual(copy);
  });

  test('години за типом; частина без годин — сума відомих і попередження', () => {
    const state = riskManagementState();
    state.sessions[0].type = 'lecture';
    state.sessions[1].type = 'practice';
    state.sessions[2].type = 'practice';
    state.sessions[3].hours = null;
    state.sessions[4].format = 'online';
    state.sessions[5].date = 'TBD';
    const { computed } = recompute(state, refs28).header;
    expect(computed).toMatchObject({ contactHours: 16, lectureHours: 4, practiceHours: 8, workshopHours: null, deliveryModes: ['hybrid', 'online'] });
    expect(computedWarnings(state)).toEqual([
      { code: 'SESSIONS_WITHOUT_HOURS', field: 'contactHours', ids: ['s4'] },
      { code: 'SESSIONS_WITHOUT_DATE', field: 'termFromSchedule', ids: ['s6'] },
    ]);
  });

  test('без даних — null, а не 0', () => {
    const { computed } = createEmptyState({ refs: refs28, course: { title: 'X' } }).header;
    expect(computed).toMatchObject({ contactHours: null, selfStudyHours: null, assessmentTotal: null, deliveryModes: [], termFromSchedule: { start: null, end: null } });
  });

  test('courseKind — за courseCode у ProgramCourse своєї програми', () => {
    const state = riskManagementState({ programCode: 'MBA27' });
    state.header.courseCode = null;
    expect(recompute(state, refs27).header.courseKind).toBe('elective'); // коду немає — назва не рахується
    state.header.courseCode = ' нд.4 ';
    expect(recompute(state, refs27).header.courseKind).toBe('core');
    expect(recompute(state).header.courseKind).toBe('core'); // без refs courseKind не чіпаємо
  });
});

describe('paths', () => {
  test('get/set за шляхами слотів', () => {
    const state = riskManagementState();
    expect(getPath(state, 'summary.shortDescription.text')).toMatch(/^In today/);
    expect(getPath(state, 'assessments[as2].weight')).toBe(25);
    expect(getPath(state, 'policies{policy.late}').candidateOptionKey).toBe('late_gbs');
    expect(getPath(state, 'sessions[].hours')).toEqual([4, 4, 4, 4, 1, 3]);

    const next = setPath(state, 'assessments[as2].weight', 30);
    expect(next.assessments[1].weight).toBe(30);
    expect(state.assessments[1].weight).toBe(25);
    expect(next.assessments[0]).toBe(state.assessments[0]); // структурне спільне використання

    const added = setPath(state, 'materials.required[m9]', { citation: 'Book', url: null, verified: false, source: 'instructor_directed', evidenceBlockIds: [] });
    expect(added.materials.required.map((m) => m.id)).toEqual(['m1', 'm9']);
    expect(setPath(added, 'materials.required[m1]', null).materials.required.map((m) => m.id)).toEqual(['m9']);
    expect(updateEntity(state, 'policies', 'policy.late', { optionKey: 'late_daily' }).policies.find((p) => p.key === 'policy.late').optionKey).toBe('late_daily');
    expect(() => setPath(state, 'assessments[nope].weight', 1)).toThrow(expect.objectContaining({ code: 'PATH_NOT_FOUND' }));
  });

  test('changedPaths: сутність за id, масив цілком при додаванні, E-поля не рахуються', () => {
    const before = riskManagementState();
    let after = setPath(before, 'assessments[as1].weight', 30);
    after = setPath(after, 'policies{policy.late}.optionKey', 'late_gbs');
    after = setPath(after, 'header.computed.contactHours', 99);
    expect(changedPaths(before, after).map((c) => [c.path, c.section])).toEqual([
      ['assessments[as1]', 'assessment'],
      ['policies{policy.late}', 'policies'],
    ]);
    const grown = setPath(before, 'outcomes[clo7]', { text: 'New', plo: [], assessmentIds: [], source: 'ai_draft', evidenceBlockIds: [] });
    expect(changedPaths(before, grown).map((c) => c.path)).toEqual(['outcomes[]']);
    expect(sectionsTouched(before, setPath(before, 'header.courseTitle', 'Risk'))).toEqual(['course_info']);
    expect(sectionOfPath('sessions[s1].format')).toBe('schedule');
    expect(sectionOfPath('header.courseCode')).toBe('at_a_glance');
  });
});

describe('computeReadiness', () => {
  const approveAllMeta = (state) => {
    for (const key of Object.keys(computeReadiness(state, { refs: refs28 }).sections)) {
      state.sections[key] = { approved: true, approvedAt: '2026-10-01T00:00:00.000Z', approvedRevision: 1 };
    }
    return state;
  };

  test('порожній стан: score 0, розділи empty', () => {
    const r = computeReadiness(createEmptyState({ programCode: 'MBA28', refs: refs28 }), { refs: refs28 });
    expect(r.score).toBe(0);
    expect(r.counts).toEqual({ approved: 0, required: 11, pendingSuggestions: 0 });
    expect(r.sections.policies.status).toBe('empty');
    expect(r.sections.short_description).toMatchObject({ status: 'empty', complete: false });
  });

  test('порожній стан навіть із прапорцями approved не дає 100%', () => {
    const r = computeReadiness(approveAllMeta(createEmptyState({ programCode: 'MBA28', refs: refs28 })), { refs: refs28 });
    expect(r.score).toBe(0);
  });

  test('нерозпізнаний стан ({}) — 0', () => {
    expect(computeReadiness({}, { refs: refs28 }).score).toBe(0);
    expect(computeReadiness(null).score).toBe(0);
  });

  test('без жодного затвердження — 0, навіть для заповненого силабусу', () => {
    const r = computeReadiness(riskManagementState(), { refs: refs28 });
    expect(r.score).toBe(0);
    expect(r.sections.short_description).toMatchObject({ status: 'draft', complete: true, approved: false });
  });

  test('рахуються лише затверджені й заповнені розділи', () => {
    const state = approveAllMeta(riskManagementState());
    const r = computeReadiness(state, { refs: refs28 });
    // Політики library ще не обрані → policies не complete, затвердження не рахується
    expect(r.sections.policies).toMatchObject({ status: 'draft', complete: false, approved: false });
    expect(r.counts.approved).toBe(10);
    expect(r.score).toBe(Math.round((10 / 11) * 100));
  });

  test('поради й перевірки на score не впливають; непройдені перевірки рахуються за розділом', () => {
    const state = approveAllMeta(riskManagementState());
    const base = computeReadiness(state, { refs: refs28 }).score;
    const checks = [
      { id: 'a', severity: 'critical', section: 'assessment', passed: false },
      { id: 'b', severity: 'warning', section: 'assessment', passed: false },
      { id: 'c', severity: 'high', section: 'assessment', passed: true },
    ];
    const r = computeReadiness(state, { refs: refs28, checks, pendingSuggestions: 4 });
    expect(r.score).toBe(base);
    expect(r.counts.pendingSuggestions).toBe(4);
    expect(r.sections.assessment.checks).toEqual({ critical: 1, high: 0, other: 1 });
  });
});

describe('render + diff', () => {
  test('розділи в порядку шаблону; політики: варіант, власний текст або плейсхолдер', () => {
    const state = riskManagementState();
    const late = state.policies.find((p) => p.key === 'policy.late');
    late.optionKey = 'late_daily';
    const appeal = state.policies.find((p) => p.key === 'policy.appeal');
    Object.assign(appeal, { text: 'Write to me within a week.', source: 'instructor_directed' });

    const { sections } = renderState(state, refs28);
    expect(sections.map((s) => s.key)).toEqual(refs28.template.map((t) => t.key));
    expect(sections.find((s) => s.key === 'schedule')).toMatchObject({ docNumber: 3, title: 'Course Structure & Schedule' });
    const policyText = (title) => {
      const blocks = sections.find((s) => s.key === 'policies').blocks;
      return blocks[blocks.findIndex((b) => b.kind === 'heading' && b.text === title) + 1].text;
    };
    const lib = (key) => refs28.policyLibrary.blocks.find((b) => b.key === key);
    expect(policyText('Late Submission')).toBe(lib('policy.late').options.find((o) => o.key === 'late_daily').text);
    expect(policyText('Grade Appeal')).toBe('Write to me within a week.');
    // текст з файлу без вибору — ще не рішення: показується з позначкою, а не порожній плейсхолдер
    expect(policyText('Attendance')).toBe(`${state.policies.find((p) => p.key === 'policy.attendance').text.trim()} ${FROM_FILE_NOTE}`);
    expect(policyText('Participation Credit')).toBe(CHOOSE_OPTION); // тексту немає — плейсхолдер
    expect(policyText('Passing Threshold')).toBe(lib('policy.passing').text);
    for (const sec of sections) {
      for (const b of sec.blocks) expect(['heading', 'paragraph', 'list-item', 'table-row']).toContain(b.kind);
    }
  });

  test('diffRendered: змінений абзац — word diff, видалене заняття — del, нове — ins', () => {
    const before = riskManagementState();
    let after = setPath(before, 'summary.shortDescription.text', "In today's world, risk is everywhere. This course gives you the frameworks to see risk early and act on it.");
    after = setPath(after, 'sessions[]', [...after.sessions.slice(0, 5), { ...after.sessions[5], id: 's7', topic: 'Risk culture' }]);
    const { sections } = diffRendered(renderState(before, refs28), renderState(after, refs28));

    const desc = sections.find((s) => s.key === 'short_description').blocks;
    expect(desc).toHaveLength(1);
    expect(desc[0].parts.filter((p) => p.type === 'del').map((p) => p.text).join('')).toMatch(/fast-paced/);
    expect(desc[0].parts.filter((p) => p.type === 'ins')).toEqual([]);

    const changed = sections.find((s) => s.key === 'schedule').blocks.filter((b) => b.parts.some((p) => p.type !== 'eq'));
    expect(changed).toHaveLength(1);
    const text = (type) => changed[0].parts.filter((p) => p.type === type).map((p) => p.text.trim()).join(' ');
    expect(text('del')).toBe('Designing Effective Internal Controls');
    expect(text('ins')).toBe('Risk culture');
    expect(changed[0].text).toMatch(/^6 \| Risk culture \|/);

    // Без змін — усе eq
    const same = diffRendered(renderState(before, refs28), renderState(before, refs28));
    expect(same.sections.every((s) => s.blocks.every((b) => b.parts.every((p) => p.type === 'eq')))).toBe(true);
  });

  test('diffBlock: word-diff двох текстів', () => {
    const parts = diffBlock('alpha beta', 'alpha gamma');
    expect(parts.map((p) => p.type)).toEqual(expect.arrayContaining(['equal', 'delete', 'insert']));
  });
});
