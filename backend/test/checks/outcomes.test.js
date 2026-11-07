const { runChecks } = require('../../services/checks');
const { normalizePloCode } = require('../../services/checks/plo');
const { rm, refs, byRule } = require('./helpers');

const plo = (code, coverage = 'full') => ({ code, coverage, confirmed: true });

describe('CLO без компонента оцінювання (warning)', () => {
  test('зв\'язок з будь-якого боку зараховується', () => {
    const state = rm((s) => {
      s.outcomes[3].assessmentIds = ['as2'];             // clo4 — з боку CLO
      s.assessments[2].outcomeIds.push('clo5');          // clo5 — з боку компонента
    });
    expect(byRule(runChecks(state, refs()), 'outcomes.clo_unassessed').map((c) => c.id)).toEqual(['outcomes.clo_unassessed:clo6']);
  });
});

describe('покриття PLO', () => {
  const coverage = (plos, kind = 'core', programCode = 'MBA27') => {
    const state = rm((s) => { s.header.courseKind = kind; plos.forEach((p, i) => { s.outcomes[i].plo = p; }); }, { programCode });
    return byRule(runChecks(state, refs(programCode)), 'plo.coverage');
  };

  test.each([
    [[[plo('ПРН1')]], 'info'],
    [[[plo('ПРН1', 'partial')]], 'high'],
    [[[plo('ПРН1', 'partial')], [plo('ПРН1', 'partial')]], 'high'],  // один і той самий PLO двічі — 0.5
    [[[plo('ПРН1', 'partial')], [plo('ПРН2', 'partial')]], 'info'],  // два різні PLO по 0.5 — 1
    [[], 'high'],
  ])('core, %j → %s', (plos, severity) => {
    const [check] = coverage(plos);
    expect(check.severity).toBe(severity);
    if (severity === 'high') expect(check.message).toMatch(/\?$/);
  });

  test('elective — лише info з кількістю покритих PLO', () => {
    const [check] = coverage([[plo('ПРН3'), plo('ПРН4', 'partial')]], 'elective', 'MBA28');
    expect(check).toMatchObject({ severity: 'info', passed: true, details: { covered: ['ПРН3', 'ПРН4'] } });
    expect(check.message).toMatch(/2 programme learning outcomes covered/);
  });

  test('тип курсу не визначено → info без оцінки', () => {
    expect(coverage([], null)[0]).toMatchObject({ severity: 'info', passed: false, path: 'header.courseKind' });
  });

  test('латинська P і «PRN» у коді нормалізуються (єдина канонічна форма, C08); невідомий код → warning', () => {
    const state = rm((s) => { s.header.courseKind = 'core'; s.outcomes[0].plo = [plo('PRN1'), plo('ПPН 2'), plo('ПРН20')]; }, { programCode: 'MBA28' });
    const checks = runChecks(state, refs('MBA28'));
    expect(byRule(checks, 'plo.coverage')[0]).toMatchObject({ severity: 'info', details: { covered: ['ПРН1', 'ПРН2'] } });
    // ПРН20 є лише в MBA27: силабус перевіряється проти свого programCode
    expect(byRule(checks, 'plo.unknown_code').map((c) => [c.id, c.severity])).toEqual([
      ['plo.unknown_code:ПРН20', 'warning'],
    ]);
  });

  test('normalizePloCode', () => {
    expect(normalizePloCode('ПPН 1')).toBe('ПРН1');
    expect(normalizePloCode('прн-12')).toBe('ПРН12');
    expect(normalizePloCode('ПРН1'.normalize('NFD'))).toBe('ПРН1');
  });
});
