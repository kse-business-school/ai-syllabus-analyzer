// Тести генератора .docx за шаблоном: розбір word/document.xml без мережі і БД.
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderSyllabusDocx } = require('../../services/document/writers/templateDocx');
const { loadFixtureRefs } = require('../../services/references/fixtureRefs');
const { riskManagementState } = require('../fixtures/state/riskManagement');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const refs = loadFixtureRefs('MBA28');

const textOf = (node) => Array.from(node.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
async function parse(state, opts, withRefs = refs) {
  const buf = await renderSyllabusDocx(state, withRefs, opts);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const rels = zip.file('word/_rels/document.xml.rels') ? await zip.file('word/_rels/document.xml.rels').async('string') : '';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, 'p'));
  const styleOf = (p) => p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val');
  const tables = Array.from(body.childNodes).filter((n) => n.localName === 'tbl').map((t) => ({
    node: t,
    rows: Array.from(t.childNodes).filter((n) => n.localName === 'tr').map((tr) =>
      Array.from(tr.childNodes).filter((n) => n.localName === 'tc').map(textOf)),
  }));
  return {
    buf, xml, rels, tables, text: textOf(doc),
    h1: paragraphs.filter((p) => styleOf(p) === 'Heading1').map(textOf),
    h2: paragraphs.filter((p) => styleOf(p) === 'Heading2').map(textOf),
    hyperlinks: doc.getElementsByTagNameNS(W, 'hyperlink').length,
    highlights: doc.getElementsByTagNameNS(W, 'highlight').length,
  };
}
const findTable = (r, firstCell) => r.tables.find((t) => t.rows[0][0].startsWith(firstCell));

describe('renderSyllabusDocx', () => {
  let r;
  beforeAll(async () => { r = await parse(riskManagementState(), { programLabel: 'MBA 28' }); });

  test('заголовки розділів пронумеровані 1..6 за порядком', () => {
    expect(r.h1).toEqual([
      '1. Summary', '2. Instructor', '3. Course Structure & Schedule',
      '4. Assessment and Grading', '5. Course Materials', '6. Course Policies',
    ]);
    expect(r.text).toContain('COURSE SYLLABUS · Risk Management');
  });

  test('є таблиці At a Glance, Matrix, Schedule, Assessment', () => {
    const glance = findTable(r, 'Program');
    expect(glance.rows.find((x) => x[0] === 'Program')[1]).toBe('MBA 28');
    expect(findTable(r, 'Course learning outcome')).toBeTruthy();
    expect(findTable(r, 'Session').rows[0]).toEqual(['Session', 'Topic', 'Type', 'Format', 'Guest speaker', 'Additional information']);
    expect(findTable(r, 'Component')).toBeTruthy();
  });

  test('At a Glance: contact 20, self-study 14; Total ваг 100', () => {
    const glance = findTable(r, 'Program');
    expect(glance.rows.find((x) => x[0] === 'Contact hours')[1]).toContain('20');
    expect(glance.rows.find((x) => x[0] === 'Self-study hours')[1]).toContain('14');
    expect(glance.rows.find((x) => x[0] === 'Assessment')[1]).toBe('3 components · 100%');
    const total = findTable(r, 'Component').rows.find((x) => x[0] === 'Total');
    expect(total[1]).toBe('100');
  });

  test('розклад: дата/час і тривалість у колонці Session', () => {
    const row = findTable(r, 'Session').rows[1];
    expect(row[0]).toContain('2026-04-25');
    expect(row[0]).toContain('(4 ac. hours)');
  });

  test('library-політики без вибору → плейсхолдер, locked passing → текст довідника', () => {
    expect(r.text).toContain('[Choose an option: Participation Credit]');
    expect(r.text).toContain('[Choose an option: Grading Detail]');
    expect(r.text).toContain('60 out of 100');
    expect(r.h2).toContain('Passing Threshold');
    expect(r.highlights).toBeGreaterThan(0);
  });

  test('обраний варіант довідника і власний текст', async () => {
    const state = riskManagementState();
    state.policies.find((p) => p.key === 'policy.attendance').optionKey = 'attendance_std';
    const late = state.policies.find((p) => p.key === 'policy.late');
    late.optionKey = null;
    const res = await parse(state);
    expect(res.text).toContain('Attendance is mandatory');
    expect(res.text).not.toContain('[Choose an option: Attendance]');
    expect(res.text).toContain('Assignments submitted after the deadline'); // власний текст
    expect(res.text).not.toContain('[Choose an option: Late Submission]');
  });

  test('неперевірений URL не стає гіперпосиланням, перевірений — стає', async () => {
    const state = riskManagementState();
    state.materials.required = [
      { id: 'a', citation: 'Unverified', url: 'https://example.com/a', verified: false, source: 'parsed', evidenceBlockIds: [] },
      { id: 'b', citation: 'Verified', url: 'https://example.com/b', verified: true, source: 'parsed', evidenceBlockIds: [] },
    ];
    const res = await parse(state);
    expect(res.text).toContain('https://example.com/a');
    expect(res.hyperlinks).toBe(1);
    expect(res.rels).toContain('https://example.com/b');
    expect(res.rels).not.toContain('https://example.com/a');
  });

  test('PLO у матриці беруться з refs, partial позначається', async () => {
    const state = riskManagementState();
    const code = refs.outcomes[0].code;
    state.outcomes[0].plo = [{ code, coverage: 'partial', confirmed: true }];
    const res = await parse(state);
    const row = findTable(res, 'Course learning outcome').rows[1];
    expect(row[1]).toContain(code);
    expect(row[1]).toContain(refs.outcomes[0].text);
    expect(row[1]).toContain('(partial)');
  });

  test('повністю порожній мінімальний стан не падає і дає плейсхолдери', async () => {
    const empty = {
      schemaVersion: 1, programCode: null, track: 'scratch', language: null,
      header: { term: {}, computed: {} },
      summary: { prerequisites: {}, shortDescription: {}, objectives: [], capstone: { criteriaKeys: [] } },
      outcomes: [], instructors: [], sessions: [], individualWork: [], assessments: [],
      compensation: { items: [] }, materials: { required: [], recommended: [] }, policies: [], sections: {},
    };
    const res = await parse(empty);
    expect(res.h1).toHaveLength(6);
    expect(res.text).toContain('[To be completed: Short Course Description]');
    expect(res.text).toContain('[Choose an option: Late Submission]');
    expect(res.highlights).toBeGreaterThan(5);
    // і без refs
    await expect(renderSyllabusDocx(empty, undefined)).resolves.toBeInstanceOf(Buffer);
  });
});

const hasSoffice = spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status === 0;
(hasSoffice ? describe : describe.skip)('templateDocx smoke (LibreOffice)', () => {
  test('файл конвертується в PDF', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-docx-'));
    try {
      const file = path.join(dir, 's.docx');
      fs.writeFileSync(file, await renderSyllabusDocx(riskManagementState(), refs));
      execFileSync('soffice', [`-env:UserInstallation=file://${dir}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', dir, file], { timeout: 110000, stdio: 'ignore' });
      expect(fs.readFileSync(path.join(dir, 's.pdf')).slice(0, 4).toString()).toBe('%PDF');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
});


describe('профіль MMM (B-6, B-8.9): розділи 0–9 українською', () => {
  const { createEmptyState } = require('../../services/syllabusState/empty');
  const { validateState } = require('../../services/syllabusState/schema');
  const mmm = loadFixtureRefs('MMM26');
  const e = { source: 'instructor_directed', evidenceBlockIds: [] };
  const state = () => {
    const s = createEmptyState({ programCode: 'MMM26', refs: mmm, language: 'uk', course: { title: 'Кількісні маркетингові дослідження' } });
    s.header.programBlock = '1.1 Consumer & Research';
    s.modules = [{ id: 'm1', n: 1, title: 'Основи досліджень', ...e }, { id: 'm2', n: 2, title: 'Аналіз', ...e }];
    const session = (id, n, moduleId, topic, extra = {}) => ({ id, n, topic, type: 'workshop', hours: 2, format: 'offline', guest: null, additional: null, date: null, time: null, moduleId, prep: null, deadline: null, guestId: null, ...e, ...extra });
    s.sessions = [session('s1', 1, 'm1', 'Вступ', { prep: 'Відео 15 хв' }), session('s2', 2, 'm1', 'Вибірка'), session('s3', 3, 'm2', 'Регресія', { guestId: 'g1', deadline: '2026-12-01' })];
    s.guests = [{ id: 'g1', name: 'Олена Коваль', company: 'Brand Co', topic: 'Кейс', format: 'Q&A', status: 'confirmed', ...e }];
    s.assessments = [{ id: 'as1', name: 'Активна участь', fixtureRef: null, weight: 30, criteria: 'Якість внеску', deadline: 'Увесь курс', isParticipation: true, isControl: false, outcomeIds: [], maxPoints: 14, unitCount: 7, rubric: [{ points: 0, descriptor: 'Немає внеску' }, { points: 1, descriptor: 'Частковий' }, { points: 2, descriptor: 'Повний' }], ...e }];
    s.materials.bySession = [{ id: 'bs1', sessionId: 's3', citation: 'Стаття про регресію', url: null, verified: false, ...e }];
    s.summary.practicalApplication = { text: 'Учасники будують модель на даних власного бізнесу.', ...e };
    s.outcomes = [{ id: 'clo1', text: 'Побудувати план дослідження', plo: [{ code: mmm.outcomes[0].code, coverage: 'full', confirmed: true }], assessmentIds: [], ...e }];
    return s;
  };

  test('стан MMM валідний за схемою', () => expect(validateState(state())).toEqual([]));

  test('.docx: групи 0–9 з профілю, педагогічний підхід, модулі, гості, бали з рубрикою, матеріали за сесіями', async () => {
    const r = await parse(state(), {}, mmm);
    expect(r.h1).toEqual([
      '0. Дані про курс', '1. Зв\'язок з результатами програми MMM', '2. Лектор', '3. Результати навчання курсу',
      '4. Структура курсу та розклад занять', '5. Гостьові спікери', '6. Оцінювання', '7. Матеріали курсу',
      '8. Педагогічний підхід', '9. Політики курсу',
    ]);
    expect(r.text).toContain('СИЛАБУС КУРСУ · Кількісні маркетингові дослідження');
    expect(r.text).toContain('1.1 Consumer & Research');
    expect(r.text).toContain('Сесія 2.1');
    expect(r.text).toContain('Модуль 2. Аналіз');
    expect(r.text).toContain('Олена Коваль');
    expect(r.text).toContain('14 балів (7 × 2)');
    expect(r.text).toContain('Перед сесією 2.1 — Стаття про регресію');
    expect(r.text).toContain('Доказовий маркетинг, а не тренди');
    expect(r.text).toContain(mmm.outcomes[0].text);
    expect(r.text).not.toContain('Порада для лектора');
    expect(r.text).not.toContain('Course Objectives');
    expect(findTable(r, 'Сесія / дата').rows[0]).toEqual(['Сесія / дата', 'Тема', 'Зміст і формат', 'Підготовка до заняття', 'Дедлайн']);
  });
});
