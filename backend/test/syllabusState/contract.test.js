const fs = require('fs');
const path = require('path');
const { SECTION_KEYS, validateState } = require('../../services/syllabusState/schema');
const { sectionGaps, getSlot, isFullSentence, policyDecided } = require('../../services/syllabusState/slots');

const REF = path.join(__dirname, '../../fixtures/reference');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REF, f), 'utf8'));

test('ключі розділів спільного шаблону й профілів програм — серед SECTION_KEYS схеми', () => {
  const common = read('template.sections.json').sections.map((s) => s.key);
  expect(SECTION_KEYS.filter((k) => common.includes(k))).toEqual(common); // той самий порядок
  const { readTemplateFixtures } = require('../../services/references/fixtureRefs');
  for (const s of readTemplateFixtures()) expect(SECTION_KEYS).toContain(s.key);
});

test('довідник політик: 13 блоків, 3 locked, library без дефолту', () => {
  const { blocks } = read('policies.library.json');
  expect(blocks).toHaveLength(13);
  expect(blocks.filter((b) => b.mode === 'locked').map((b) => b.key)).toEqual(['policy.absence', 'policy.passing', 'policy.fallback']);
  for (const b of blocks.filter((x) => x.mode === 'library')) {
    expect(b.options.length).toBeGreaterThan(1);
    expect(b.options.some((o) => o.default)).toBe(false);
  }
});

test('переліки ПРН і нормативних компонентів різні для MBA27 і MBA28', () => {
  const lo = read('learning-outcomes.json').programs;
  expect([lo.MBA27.outcomes.length, lo.MBA28.outcomes.length]).toEqual([20, 17]);
  const pc = read('programme-courses.json').programmes;
  expect([pc.MBA27.core.length, pc.MBA28.core.length]).toEqual([14, 11]);
});

test('пороги повноти: порожній стан не заповнений, речення рахується як повне', () => {
  expect(sectionGaps('schedule', {})).toEqual(['At least one session']);
  expect(sectionGaps('learning_outcomes', { outcomes: [{ text: 'Apply risk frameworks' }] })).toEqual([]);
  expect(isFullSentence('Risk is')).toBe(false);
  expect(isFullSentence('This course explains how risk is managed.')).toBe(true);
  expect(sectionGaps('assessment', { assessments: [{ name: 'Exam', weight: 25, criteria: '', deadline: '09.05' }] })).toEqual(['Exam: criteria']);
});

test('політика зарахована лише після явного вибору або власного тексту', () => {
  expect(policyDecided({ mode: 'library', optionKey: null, text: 'Parsed text', source: 'parsed' })).toBe(false);
  expect(policyDecided({ mode: 'library', optionKey: 'late_gbs', text: '…', source: 'fixture' })).toBe(true);
  expect(policyDecided({ mode: 'library', optionKey: null, text: 'Own text', source: 'instructor_directed' })).toBe(true);
  expect(policyDecided({ mode: 'locked', text: 'Pass at 60' })).toBe(true);
});

test('editability політики береться з mode блоку', () => {
  const state = { policies: [{ key: 'policy.passing', mode: 'locked' }, { key: 'policy.late', mode: 'library' }] };
  expect(getSlot('policy.passing', state).editability).toBe('locked');
  expect(getSlot('policy.late', state).editability).toBe('library');
  expect(getSlot('policy.unknown', state)).toBeNull();
});

test('validateState відхиляє невідомий розділ і зайві поля', () => {
  const errors = validateState({ schemaVersion: 1, sections: { nope: { approved: true } }, extra: 1 });
  expect(errors.some((e) => e.includes('nope'))).toBe(true);
  expect(errors.some((e) => e.includes('extra'))).toBe(true);
});

test('еталонний стан Risk Management валідний за схемою', () => {
  const { riskManagementState } = require('../fixtures/state/riskManagement');
  expect(validateState(riskManagementState())).toEqual([]);
  expect(validateState(riskManagementState({ programCode: 'MBA27' }))).toEqual([]);
});
