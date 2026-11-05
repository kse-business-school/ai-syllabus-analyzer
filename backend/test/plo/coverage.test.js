// Чисті тести матриці покриття ПРН (без БД)
const { buildCoverage } = require('../../services/plo/coverage');

const outcomes = [
  { code: 'ПРН1', text: 'Strategy' },
  { code: 'ПРН7', text: 'Digital, data and AI' },
  { code: 'ПРН13', text: 'Organisational design' },
];
const offerings = [
  { _id: 'o1', programCode: 'MBA28', courseCode: 'RM.1', courseName: 'Risk Management', type: 'elective' },
  { _id: 'o2', programCode: 'MBA28', courseCode: 'ST.1', courseName: 'Strategy', type: 'core' },
  { _id: 'o3', programCode: 'MBA28', courseCode: 'NEW.1', courseName: 'Not started', type: 'core' },
];
const stateWith = (outcomesList, assessments = []) => ({ programCode: 'MBA28', outcomes: outcomesList, assessments });

test('вага клітинки: full 1, partial 0.5, максимум за кількома CLO; Σ по курсах', () => {
  const syllabi = [
    { _id: 's1', offeringId: 'o1', status: 'in_progress', updatedAt: '2026-10-01', course: {},
      state: stateWith([
        { id: 'c1', text: 'A', plo: [{ code: 'ПРН1', coverage: 'partial', confirmed: true }], assessmentIds: ['a1'] },
        { id: 'c2', text: 'B', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }], assessmentIds: [] },
      ], [{ id: 'a1', name: 'Exam', weight: 40 }]) },
    { _id: 's2', offeringId: 'o2', status: 'in_progress', updatedAt: '2026-10-01', course: {},
      state: stateWith([{ id: 'c1', text: 'C', plo: [{ code: 'ПРН1', coverage: 'partial', confirmed: true }] }]) },
  ];
  const r = buildCoverage({ outcomes, offerings, syllabi });
  expect(r.courses[0].cells['ПРН1'].weight).toBe(1);
  expect(r.courses[0].cells['ПРН1'].clos).toHaveLength(2);
  expect(r.courses[0].cells['ПРН1'].clos[0].assessments).toEqual([{ id: 'a1', name: 'Exam', weight: 40 }]);
  expect(r.outcomes.find((o) => o.code === 'ПРН1').sum).toBe(1.5);
});

test('ПРН без жодного курсу має Σ 0 і uncovered', () => {
  const r = buildCoverage({ outcomes, offerings, syllabi: [] });
  expect(r.outcomes.map((o) => [o.code, o.sum, o.uncovered])).toEqual([['ПРН1', 0, true], ['ПРН7', 0, true], ['ПРН13', 0, true]]);
  expect(r.courses.every((c) => c.syllabusId === null)).toBe(true);
});

test('код ПРН нормалізується (латинські P/H замість кириличних), невідомі коди ігноруються', () => {
  const state = stateWith([{ id: 'c1', text: 'A', plo: [{ code: 'ПPH7', coverage: 'full', confirmed: true }, { code: 'ПРН99', coverage: 'full', confirmed: true }] }]);
  const r = buildCoverage({ outcomes, offerings, syllabi: [{ _id: 's1', offeringId: 'o1', status: 'in_progress', course: {}, state }] });
  expect(Object.keys(r.courses[0].cells)).toEqual(['ПРН7']);
  expect(r.courses[0].cells['ПРН7'].weight).toBe(1);
});

test('силабус без offeringId прив\'язується за кодом курсу; з analyzing/error пропускається; береться найсвіжіший', () => {
  const mk = (id, updatedAt, status, code, instructor = 'L1') => ({
    _id: id, programCode: 'MBA28', status, updatedAt, course: { code: 'rm.1' }, instructor,
    state: stateWith([{ id: 'c', plo: [{ code, coverage: 'full', confirmed: true }] }]),
  });
  const assigned = offerings.map((o, i) => (i === 0 ? { ...o, lecturerId: 'L1' } : o));
  const r = buildCoverage({
    outcomes, offerings: assigned,
    syllabi: [mk('old', '2026-09-01', 'in_progress', 'ПРН1'), mk('new', '2026-10-01', 'in_progress', 'ПРН7'), mk('bad', '2026-11-01', 'error', 'ПРН13')],
  });
  expect(r.courses[0].syllabusId).toBe('new');
  expect(Object.keys(r.courses[0].cells)).toEqual(['ПРН7']);
});

test('A04: неприв\'язаний силабус чужого автора (або для призначення без викладача) у матрицю не потрапляє', () => {
  const foreign = { _id: 'x', programCode: 'MBA28', status: 'in_progress', updatedAt: '2026-12-01', course: { code: 'RM.1' }, instructor: 'L2',
    state: stateWith([{ id: 'c', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }] }]) };
  const assigned = offerings.map((o, i) => (i === 0 ? { ...o, lecturerId: 'L1' } : o));
  expect(buildCoverage({ outcomes, offerings: assigned, syllabi: [foreign] }).courses[0].syllabusId).toBeNull();
  expect(buildCoverage({ outcomes, offerings, syllabi: [{ ...foreign, instructor: 'L1' }] }).courses[0].syllabusId).toBeNull();
});

test('A07: непідтверджені зв\'язки CLO → ПРН не входять у Σ, але показуються окремо', () => {
  const syllabi = [{ _id: 's1', offeringId: 'o1', status: 'in_progress', course: {},
    state: stateWith([{ id: 'c1', text: 'A', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: false }] }]) }];
  const r = buildCoverage({ outcomes, offerings, syllabi });
  expect(r.courses[0].cells['ПРН1'].weight).toBe(0);
  expect(r.courses[0].cells['ПРН1'].unconfirmed).toEqual([{ id: 'c1', text: 'A', coverage: 'full' }]);
  expect(r.outcomes.find((o) => o.code === 'ПРН1')).toMatchObject({ sum: 0, uncovered: true });
});

test('силабус з offeringId іншого призначення не підхоплюється за кодом', () => {
  const syllabi = [{ _id: 's1', offeringId: 'other', programCode: 'MBA28', status: 'in_progress', course: { code: 'RM.1' },
    state: stateWith([{ id: 'c', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }] }]) }];
  expect(buildCoverage({ outcomes, offerings, syllabi }).courses[0].syllabusId).toBeNull();
});
