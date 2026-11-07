// Генератор .docx силабуса за шаблоном KSE зі структурованого стану (ТЗ етап 4).
// Чиста функція без БД: renderSyllabusDocx(state, refs, { programLabel }) → Buffer.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, BorderStyle,
  ShadingType, ExternalHyperlink, LevelFormat, AlignmentType, Header, Footer, ImageRun, PageNumber,
} = require('docx');
const S = require('./templateStyles');
const { FROM_FILE_NOTE } = require('../../syllabusState/render');
const { policyDecided } = require('../../syllabusState/slots');
const { blockTitle, lockedText, optionText } = require('../../references/policyText');
const { LABELS, labelsFor, sectionTitleOf, docTitleOf, sessionNumbers } = require('../labels');
const { ploCoverage, fixedTextOf, weightText } = require('../../syllabusState/render');
const { fixtureTemplate } = require('../../references/fixtureRefs');
const fs = require('fs');
const path = require('path');
const logoImage = require('sharp')(fs.readFileSync(path.join(__dirname, '../../../assets/brand/kse-business-school-green.svg'))).resize({ width: 728 }).png().toBuffer();

const DASH = '—';
const has = (v) => typeof v === 'string' ? v.trim() !== '' : v != null;
const clean = (v) => (typeof v === 'string' ? v.trim() : v);

// ---- Рядкові/абзацні будівельні блоки ----
const run = (text, opts = {}) => new TextRun({ text, font: S.FONT, size: S.SIZES.body, ...opts });
// Мова плейсхолдерів — мова документа; збірка після await logo синхронна, тож значення не перемежовується
let placeholderLang = 'en';
const KINDS_UK = { 'To be completed': 'Заповнити', 'Choose an option': 'Оберіть варіант' };
const kindText = (kind) => (placeholderLang === 'uk' ? KINDS_UK[kind] || kind : kind);
const placeholder = (label, kind = 'To be completed') =>
  new TextRun({ text: `[${kindText(kind)}: ${label}]`, font: S.FONT, size: S.SIZES.body, highlight: S.PLACEHOLDER_HIGHLIGHT });

const para = (children, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: [].concat(children) });
const textPara = (text, label, kind) => para(has(text) ? run(clean(text)) : placeholder(label, kind));
const heading1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun({ text })] });
const heading2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text })] });

const border = { style: BorderStyle.SINGLE, size: 4, color: S.COLORS.border };
const borders = { top: border, bottom: border, left: border, right: border };

// Комірка: children — рядок, TextRun/Paragraph або їх масив
function cell(content, width, { header = false, label = false, bold = false } = {}) {
  const items = [].concat(content == null ? DASH : content);
  const paragraphs = items.map((it) => {
    if (it instanceof Paragraph) return it;
    const r = typeof it === 'string'
      ? new TextRun({ text: it, font: S.FONT, size: S.SIZES.table, bold: header || label || bold })
      : it;
    return new Paragraph({ spacing: { after: 40 }, children: [r] });
  });
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: header ? { type: ShadingType.CLEAR, fill: S.COLORS.tableHeaderFill, color: 'auto' }
      : label ? { type: ShadingType.CLEAR, fill: S.COLORS.tableLabelFill, color: 'auto' } : undefined,
    children: paragraphs.length ? paragraphs : [new Paragraph({})],
  });
}

function table(widths, headerRow, rows, { labelFirst = false } = {}) {
  const trs = [];
  if (headerRow) trs.push(new TableRow({ tableHeader: true, children: headerRow.map((h, i) => cell(h, widths[i], { header: true })) }));
  for (const r of rows) {
    trs.push(new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { label: labelFirst && i === 0 })) }));
  }
  return new Table({ width: { size: S.CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows: trs });
}

// Плейсхолдер у комірці таблиці (підсвічений)
const cellPlaceholder = (label, kind) => new TextRun({
  text: `[${kindText(kind || 'To be completed')}: ${label}]`, font: S.FONT, size: S.SIZES.table, highlight: S.PLACEHOLDER_HIGHLIGHT,
});
const orPlaceholder = (v, label) => (has(v) ? String(clean(v)) : cellPlaceholder(label));

const bullet = (children) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [].concat(children) });
const numbered = (children, instance) => new Paragraph({ numbering: { reference: 'numbered', level: 0, instance }, spacing: { after: 60 }, children: [].concat(children) });

function bulletList(items, label) {
  const texts = (items || []).map((i) => (typeof i === 'string' ? i : i?.text)).filter(has);
  return texts.length ? texts.map((t) => bullet(run(clean(t)))) : [para(placeholder(label))];
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const fmtDate = (d) => (has(d) ? d : null);
const hoursLabel = (h, L) => (h != null ? (L === LABELS.uk ? `${fmtNum(h)} ак. год` : `${fmtNum(h)} ac. hour${h === 1 ? '' : 's'}`) : null);
const TYPE_LABELS = { en: { lecture: 'Lecture', practice: 'Practice', workshop: 'Workshop' }, uk: { lecture: 'Лекція', practice: 'Практика', workshop: 'Воркшоп' } };
const FORMAT_LABELS = { en: { offline: 'Offline', online: 'Online', hybrid: 'Hybrid' }, uk: { offline: 'Офлайн', online: 'Онлайн', hybrid: 'Змішаний' } };
const lang = (state) => (state.language === 'uk' ? 'uk' : 'en');

// ---- Розділи ----
// Кожен будівник отримує { state, refs, L, meta (розділ шаблону), sub (розділ — частина групи з кількох), standalone }
function atAGlance({ state, refs, L, programLabel, meta, standalone }) {
  const h = state.header || {};
  const c = h.computed || {};
  const uk = lang(state) === 'uk';
  const term = h.term?.start || h.term?.end ? h.term : c.termFromSchedule;
  const termText = term && (term.start || term.end) ? [term.start, term.end].filter(Boolean).join(' – ') : null;

  let contact = c.contactHours != null ? (uk ? `${fmtNum(c.contactHours)} ак. год` : `${fmtNum(c.contactHours)} ac. hours`) : DASH;
  const parts = (uk ? [['лекції', c.lectureHours], ['практика', c.practiceHours], ['воркшопи', c.workshopHours]]
    : [['lectures', c.lectureHours], ['practice', c.practiceHours], ['workshops', c.workshopHours]])
    .filter(([, v]) => v != null && v !== 0).map(([n, v]) => `${n} ${fmtNum(v)}`);
  if (c.contactHours != null && parts.length) contact += ` (${parts.join(', ')})`;

  const assessments = state.assessments || [];
  const total = c.assessmentTotal != null ? c.assessmentTotal : assessments.reduce((a, x) => a + (x.weight || 0), 0);
  const assessmentText = assessments.length
    ? (uk ? `компонентів: ${assessments.length} · ${fmtNum(total)}%` : `${assessments.length} component${assessments.length === 1 ? '' : 's'} · ${fmtNum(total)}%`)
    : DASH;

  const instructors = (state.instructors || []).map((i) => i.name).filter(has).join(', ');
  const F = FORMAT_LABELS[lang(state)];
  const modes = h.deliveryFormat ? F[h.deliveryFormat] : (c.deliveryModes || []).map((m) => F[m] || m).join(', ');

  const rows = [
    [L.program, programLabel || state.programCode || DASH],
    // Корпус і блок програми (B-8.6) — лише для програм із закритим списком блоків
    ...((refs.programBlocks || []).length ? [[L.programBlock, has(h.programBlock) ? h.programBlock : cellPlaceholder(L.programBlock)]] : []),
    ...(h.courseKind && (refs.programBlocks || []).length ? [[L.courseType, L[h.courseKind] || h.courseKind]] : []),
    [L.term, termText || DASH],
    [L.deliveryMode, modes || DASH],
    [uk ? L.credits : 'Credits / ECTS', h.ects != null ? `${fmtNum(h.ects)} ${uk ? 'ЄКТС' : 'ECTS'}` : DASH],
    [L.contactHours, contact],
    [L.selfStudyHours, c.selfStudyHours != null ? (uk ? `${fmtNum(c.selfStudyHours)} год` : `${fmtNum(c.selfStudyHours)} hours`) : DASH],
    [L.instructor, instructors || DASH],
    [uk ? 'Оцінювання' : 'Assessment', assessmentText],
  ];
  if (has(h.department)) rows.push([L.department, h.department]);
  if (has(h.language)) rows.push([L.language, h.language]);
  if (has(h.studyMode)) rows.push([L.studyMode, h.studyMode]);

  return [...(standalone ? [heading2(sectionTitleOf(meta, state.language) || 'At a Glance')] : []), table(S.columnWidths('glance'), null, rows, { labelFirst: true })];
}

function matrixTable(state, refs, L) {
  const uk = L === LABELS.uk;
  const plos = new Map((refs.outcomes || []).map((o) => [o.code, o]));
  const assessments = state.assessments || [];
  const rows = (state.outcomes || []).map((clo, idx) => {
    const ploCells = (clo.plo || []).length
      ? clo.plo.map((p) => {
        const ref = plos.get(p.code);
        const suffix = p.coverage === 'partial' ? ` (${L.partial})` : '';
        return `${p.code}${ref ? ` — ${ref.text}` : ''}${suffix}`;
      })
      : [cellPlaceholder(uk ? 'Результат програми' : 'Programme outcome')];
    const ids = new Set(clo.assessmentIds || []);
    for (const a of assessments) if ((a.outcomeIds || []).includes(clo.id)) ids.add(a.id);
    const names = assessments.filter((a) => ids.has(a.id)).map((a) => a.name).filter(has);
    return [`CLO ${idx + 1}. ${has(clo.text) ? clo.text : '[To be completed]'}`, ploCells, names.length ? names : [cellPlaceholder(uk ? 'Компонент оцінювання' : 'Assessment component')]];
  });
  if (!rows.length) rows.push([cellPlaceholder(uk ? 'Результати навчання' : 'Learning Outcomes'), DASH, DASH]);
  return table(S.columnWidths('matrix'), uk
    ? ['Результат навчання курсу (CLO)', 'Результат програми (ПРН)', 'Як оцінюється']
    : ['Course learning outcome (CLO)', 'Programme outcome (PLO)', 'Assessed by'], rows);
}

// Заголовок підрозділу: у групі з кількох розділів — назва розділу; окремий розділ — без нього (є heading1 групи)
const subHeading = (ctx, text) => (ctx.sub ? [heading2(text)] : []);
const titleOf = (ctx) => sectionTitleOf(ctx.meta, ctx.state.language);

function courseInfo(ctx) {
  const { state, L } = ctx;
  const sm = state.summary || {};
  return [heading2(L.courseTitle), textPara(state.header?.courseTitle, L.courseTitle), heading2(L.prerequisites), textPara(sm.prerequisites?.text, L.prerequisites)];
}

function learningOutcomes(ctx) {
  const { state, refs, L } = ctx;
  const out = [...subHeading(ctx, titleOf(ctx)), para(run(L.loIntro))];
  const clos = (state.outcomes || []).filter((o) => has(o.text));
  if (clos.length) clos.forEach((o) => out.push(numbered(run(clean(o.text)), 1)));
  else out.push(para(placeholder(titleOf(ctx))));
  out.push(matrixTable(state, refs, L), para([], { spacing: { after: 60 } }));
  return out;
}

// B-9.1: ПРН програми, які курс підсилює, і результати курсу, що їх формують (лише підтверджені зв'язки)
function programmeOutcomes(ctx) {
  const { state, refs, L } = ctx;
  const rows = ploCoverage(state, refs).map(({ plo, clos }) => [`${plo.code}. ${plo.text}`, clos.join(', ')]);
  const out = [...subHeading(ctx, titleOf(ctx)), para(run(L.ploIntro))];
  if (!rows.length) rows.push([cellPlaceholder(L.ploColumn), DASH]);
  out.push(table(S.columnWidths('glance'), [L.ploColumn, L.ploHow], rows));
  return out;
}

function capstone(ctx) {
  const { state, refs } = ctx;
  const sm = state.summary || {};
  const out = [...subHeading(ctx, titleOf(ctx)), textPara(sm.capstone?.text, titleOf(ctx))];
  const criteria = new Map((refs.capstone?.criteria || []).map((c) => [c.key, c.name]));
  const keys = sm.capstone?.criteriaKeys || [];
  if (keys.length) {
    out.push(para(run(lang(state) === 'uk' ? 'Пов\'язані критерії Capstone:' : 'Related Capstone criteria:', { bold: true })));
    keys.forEach((k) => out.push(bullet(run(criteria.get(k) || k))));
  }
  return out;
}

function instructorSection(ctx) {
  const { state, L } = ctx;
  const uk = lang(state) === 'uk';
  const out = [...subHeading(ctx, titleOf(ctx))];
  const list = state.instructors || [];
  if (!list.length) return [...out, para(placeholder(titleOf(ctx) || 'Instructor'))];
  list.forEach((ins) => {
    // Лише вбудовані JPEG: генератор не виконує мережевих запитів і не читає довільних шляхів.
    if (typeof ins.photo === 'string' && ins.photo.length < 200000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(ins.photo)) {
      const data = Buffer.from(ins.photo.split(',')[1], 'base64');
      if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
        out.push(para(new ImageRun({ type: 'jpg', data, transformation: { width: 96, height: 96 }, altText: { name: 'Instructor photo', title: ins.name || 'Instructor', description: 'Instructor profile photo' } })));
      }
    }
    out.push(table(S.columnWidths('instructor'), null, [
      [uk ? 'ПІБ' : 'Name', orPlaceholder(ins.name, uk ? 'ПІБ лектора' : 'Instructor name')],
      [uk ? 'Посада' : 'Position', orPlaceholder(ins.position, uk ? 'Посада' : 'Position')],
      [L.email, orPlaceholder(ins.email, L.email)],
      [L.officeHours, orPlaceholder(ins.officeHours, L.officeHours)],
      [L.assistants, has(ins.assistants) ? ins.assistants : DASH],
    ], { labelFirst: true }));
    out.push(heading2(L.expertise), ...bulletList(ins.expertise, L.expertise));
    out.push(heading2(L.education), ...bulletList(ins.education, L.education));
    out.push(heading2(L.experience), ...bulletList(ins.experience, L.experience));
  });
  return out;
}

function scheduleSection(ctx) {
  const { state, L } = ctx;
  const uk = lang(state) === 'uk';
  const T = TYPE_LABELS[lang(state)];
  const F = FORMAT_LABELS[lang(state)];
  const sessions = state.sessions || [];
  const modules = [...(state.modules || [])].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const guests = new Map((state.guests || []).map((g) => [g.id, g]));
  // Розклад із підготовкою / дедлайнами / модулями (B-6.2) — колонки шаблону MMM; інакше — колонки MBA
  const extended = Boolean(modules.length || sessions.some((x) => has(x.prep) || has(x.deadline)));
  const out = [...subHeading(ctx, titleOf(ctx))];
  const rows = [];
  let currentModule = null;
  for (const { session: x, label, module } of sessionNumbers(state)) {
    if (module && module !== currentModule) {
      currentModule = module;
      const title = `${L.module} ${module}. ${modules[module - 1]?.title || ''}`.trim();
      rows.push(extended ? [[title], '', '', '', ''] : [[title], '', '', '', '', '']);
    }
    const when = [fmtDate(x.date), has(x.time) ? x.time : null].filter(Boolean).join(', ');
    const sessionCell = [`${L.session} ${label}`];
    if (when) sessionCell.push(when);
    if (x.hours != null) sessionCell.push(`(${hoursLabel(x.hours, L)})`);
    const guest = x.guestId ? guests.get(x.guestId)?.name : x.guest;
    if (extended) {
      const content = [T[x.type], F[x.format], has(guest) ? `${L.guest}: ${guest}` : null, has(x.additional) ? x.additional : null].filter(Boolean).join('; ');
      rows.push([sessionCell, orPlaceholder(x.topic, L.topic), content || DASH, has(x.prep) ? x.prep : DASH, has(x.deadline) ? x.deadline : DASH]);
    } else {
      rows.push([sessionCell, orPlaceholder(x.topic, L.topic), T[x.type] || DASH, F[x.format] || DASH, has(guest) ? guest : DASH, has(x.additional) ? x.additional : DASH]);
    }
  }
  if (extended) {
    if (!rows.length) rows.push([cellPlaceholder(uk ? 'Сесії' : 'Sessions'), DASH, DASH, DASH, DASH]);
    out.push(table(S.columnWidths('scheduleExtended'), [uk ? 'Сесія / дата' : 'Session / date', L.topic, L.format, L.prep, L.deadline], rows));
  } else {
    if (!rows.length) rows.push([cellPlaceholder(uk ? 'Сесії' : 'Sessions'), DASH, DASH, DASH, DASH, DASH]);
    out.push(table(S.columnWidths('schedule'), uk
      ? ['Сесія', 'Тема', 'Тип', 'Формат', 'Гість', 'Додатково']
      : ['Session', 'Topic', 'Type', 'Format', 'Guest speaker', 'Additional information'], rows));
  }

  const iw = state.individualWork || [];
  // Самостійна робота — розділ шаблону MBA; у розкладах без неї (MMM) порожній блок не додається
  if (iw.length || !extended) {
    out.push(heading2(uk ? 'Самостійна робота' : 'Individual Work'));
    const iwRows = iw.map((w) => [orPlaceholder(w.title, uk ? 'Вид роботи' : 'Activity'), w.hours != null ? (uk ? `${fmtNum(w.hours)} год` : `${fmtNum(w.hours)} hours`) : DASH]);
    const total = state.header?.computed?.selfStudyHours;
    const sum = iw.reduce((a, w) => a + (w.hours || 0), 0);
    if (!iwRows.length) iwRows.push([cellPlaceholder(uk ? 'Самостійна робота' : 'Individual Work'), DASH]);
    else iwRows.push([[L.total], uk ? `${fmtNum(total != null ? total : sum)} год` : `${fmtNum(total != null ? total : sum)} hours`]);
    out.push(table(S.columnWidths('glance'), [uk ? 'Вид роботи' : 'Activity', uk ? 'Години' : 'Hours'], iwRows));
  }
  return out;
}

function guestSpeakers(ctx) {
  const { state, L } = ctx;
  const rows = (state.guests || []).map((g) => [
    orPlaceholder([g.name, g.company].filter(has).join(', '), L.guestName),
    has(g.topic) || has(g.format) ? [g.topic, g.format].filter(has).join(' — ') : DASH,
    g.status ? L.status[g.status] : DASH,
  ]);
  if (!rows.length) rows.push([DASH, DASH, DASH]);
  return [...subHeading(ctx, titleOf(ctx)), table(S.columnWidths('guests'), [L.guestName, L.guestTopic, L.guestStatus], rows)];
}

function assessmentSection(ctx) {
  const { state, L } = ctx;
  const uk = lang(state) === 'uk';
  const list = state.assessments || [];
  const points = list.some((a) => a.maxPoints != null);
  const out = [...subHeading(ctx, titleOf(ctx))];
  const rows = list.map((a) => [
    orPlaceholder(a.name, L.component),
    points ? weightText(a, L) : (a.weight != null ? fmtNum(a.weight) : cellPlaceholder(L.weight)),
    orPlaceholder(a.criteria, L.criteria),
    has(a.deadline) ? a.deadline : DASH,
  ]);
  const total = state.header?.computed?.assessmentTotal != null
    ? state.header.computed.assessmentTotal : list.reduce((x, a) => x + (a.weight || 0), 0);
  if (!rows.length) rows.push([cellPlaceholder(uk ? 'Компоненти оцінювання' : 'Assessment components'), DASH, DASH, DASH]);
  else if (!points) rows.push([[L.total], fmtNum(total), '', '']);
  out.push(table(S.columnWidths('assessment'), [L.component, points ? (uk ? 'Бали / вага' : 'Points / weight') : (uk ? 'Вага (%)' : 'Weight (%)'), L.criteria, L.deadline], rows));

  // Рубрика (B-6.3): рівні оцінювання компонента
  for (const a of list.filter((x) => (x.rubric || []).length)) {
    out.push(para(run(`${L.rubric}: ${a.name || L.component}`, { bold: true })));
    a.rubric.forEach((r) => out.push(bullet(run(`${fmtNum(r.points)} — ${r.descriptor}`))));
  }

  const items = state.compensation?.items || [];
  if (items.length) {
    out.push(heading2(uk ? 'Компенсаційні заходи' : 'Compensation Measures'));
    items.forEach((i) => out.push(bullet(has(i.text) ? run(clean(i.text)) : placeholder(uk ? 'Компенсаційний захід' : 'Compensation measure'))));
  }
  return out;
}

function materialItem(m) {
  const cite = has(m.citation) ? clean(m.citation) : null;
  const children = [cite ? run(cite) : placeholder('Reference')];
  if (has(m.url)) {
    // Гіперпосилання — лише для перевірених URL, інакше простий текст
    if (m.verified) {
      children.push(run(' '), new ExternalHyperlink({
        link: m.url.trim(),
        children: [new TextRun({ text: m.url.trim(), font: S.FONT, size: S.SIZES.body, color: S.COLORS.link, underline: {} })],
      }));
    } else children.push(run(` ${m.url.trim()}`));
  }
  return bullet(children);
}

function materialsSection(ctx) {
  const { state, L } = ctx;
  const uk = lang(state) === 'uk';
  const mat = state.materials || {};
  const block = (title, arr, label, required) => {
    const items = arr || [];
    return [heading2(title), ...(items.length ? items.map(materialItem) : [required ? para(placeholder(label)) : para(run(DASH))])];
  };
  const out = [...subHeading(ctx, titleOf(ctx)),
    ...block(uk ? L.required : 'Required', mat.required, uk ? 'Обов\'язкові матеріали' : 'Required materials', true),
    ...block(uk ? L.recommended : 'Recommended', mat.recommended, uk ? 'Рекомендовані матеріали' : 'Recommended materials', false)];
  // B-8.4: матеріали до занять — четверта група
  const per = mat.bySession || [];
  if (per.length) {
    const labels = new Map(sessionNumbers(state).map(({ session, label }) => [session.id, label]));
    out.push(heading2(L.bySession));
    per.forEach((m) => out.push(materialItem({ ...m, citation: `${L.before(labels.get(m.sessionId) || '?')} — ${m.citation || ''}` })));
  }
  return out;
}

// B-6.4: текст рівня програми (той самий у кожному силабусі програми)
function pedagogicalApproach(ctx) {
  const items = fixedTextOf(ctx.refs, ctx.state.language);
  return [...subHeading(ctx, titleOf(ctx)), ...items.flatMap((p) => [para(run(p.title, { bold: true })), para(run(p.text))])];
}

const textSection = (get) => (ctx) => [...subHeading(ctx, titleOf(ctx)), textPara(get(ctx.state), titleOf(ctx))];

/** Будівники за ключем розділу шаблону; розділ без будівника не виводиться. */
const BUILDERS = {
  at_a_glance: atAGlance,
  course_info: courseInfo,
  short_description: textSection((st) => st.summary?.shortDescription?.text),
  course_objectives: (ctx) => [...subHeading(ctx, titleOf(ctx)), ...bulletList(ctx.state.summary?.objectives, titleOf(ctx))],
  programme_outcomes: programmeOutcomes,
  learning_outcomes: learningOutcomes,
  practical_application: textSection((st) => st.summary?.practicalApplication?.text),
  connection_to_capstone: capstone,
  instructor: instructorSection,
  schedule: scheduleSection,
  guest_speakers: guestSpeakers,
  assessment: assessmentSection,
  materials: materialsSection,
  pedagogical_approach: pedagogicalApproach,
  policies: (ctx) => policiesSection(ctx.state, ctx.refs),
};

function policiesSection(state, refs) {
  const blocks = [...(refs.policyLibrary?.blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const byKey = new Map((state.policies || []).map((p) => [p.key, p]));
  const out = [];
  const knownKeys = new Set();
  const emit = (title, text, label, kind) => out.push(heading2(title), has(text) ? para(run(clean(text))) : para(placeholder(label, kind)));

  for (const b of blocks) {
    knownKeys.add(b.key);
    const p = byKey.get(b.key);
    // B-1.4: заголовок і текст довідника — мовою документа
    const title = blockTitle(b, state.language);
    if (b.mode === 'locked') { emit(title, has(p?.text) ? p.text : lockedText(b, state.language, refs), title); continue; }
    if (has(p?.text) && !has(p?.optionKey)) {
      if (policyDecided(p)) { emit(title, p.text, title); continue; } // власний текст викладача
      // Текст з файлу без вибору: показуємо його з позначкою, а не порожній плейсхолдер
      out.push(heading2(title), para([run(clean(p.text)), run(` ${FROM_FILE_NOTE}`, { italics: true })]));
      continue;
    }
    if (has(p?.optionKey)) {
      const opt = (b.options || []).find((o) => o.key === p.optionKey);
      emit(title, has(p.text) ? p.text : optionText(opt, state.language), title, 'Choose an option');
      continue;
    }
    emit(title, null, title, 'Choose an option');
  }
  // Політики поза довідником (якщо є) — після відомих
  for (const p of state.policies || []) {
    if (knownKeys.has(p.key) || !has(p.text)) continue;
    emit(p.key.replace(/^policy\./, '').replace(/_/g, ' '), p.text, p.key);
  }
  return out;
}

// ---- Збірка ----
async function renderSyllabusDocx(state, refs, { programLabel } = {}) {
  const logo = await logoImage;
  refs = refs || {};
  const title = has(state.header?.courseTitle) ? state.header.courseTitle : null;
  const L = labelsFor(state.language);
  placeholderLang = state.language === 'uk' ? 'uk' : 'en';
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE, spacing: { after: 240 },
      children: [new TextRun({ text: state.language === 'uk' ? 'СИЛАБУС КУРСУ · ' : 'COURSE SYLLABUS · ' }), title ? new TextRun({ text: title }) : placeholder(L.courseTitle)],
    }),
  ];
  // Порядок, групи й номери розділів — з профілю шаблону програми (B-6.1, B-8.9): docNumber і docTitle групи;
  // розділ без номера (At a Glance у MBA) — перед нумерованими, з власним заголовком
  const template = (refs.template?.length ? [...refs.template] : fixtureTemplate(null)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((t) => BUILDERS[t.key]);
  const groups = [];
  for (const t of template) {
    const last = groups[groups.length - 1];
    if (t.docNumber != null && last && last.docNumber === t.docNumber) last.sections.push(t);
    else groups.push({ docNumber: t.docNumber ?? null, sections: [t] });
  }
  for (const g of groups) {
    const head = g.sections[0];
    if (g.docNumber != null) children.push(heading1(`${g.docNumber}. ${docTitleOf(head, state.language) || sectionTitleOf(head, state.language)}`));
    const sub = g.docNumber != null && g.sections.length > 1;
    for (const meta of g.sections) {
      children.push(...BUILDERS[meta.key]({ state, refs, L, meta, sub: sub && meta.key !== 'at_a_glance', standalone: g.docNumber == null, programLabel }));
    }
  }

  const font = S.FONT;
  const doc = new Document({
    creator: 'KSE Syllabus Analyzer',
    title: title ? `Syllabus — ${title}` : 'Syllabus',
    styles: {
      default: { document: { run: { font, size: S.SIZES.body } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', quickFormat: true, run: { font, size: S.SIZES.title, bold: true, color: S.COLORS.heading } },
        { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: S.SIZES.h1, bold: true, color: S.COLORS.heading }, paragraph: { outlineLevel: 0, keepNext: true } },
        { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: S.SIZES.h2, bold: true, color: S.COLORS.heading }, paragraph: { outlineLevel: 1, keepNext: true } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
        { reference: 'numbered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: S.PAGE.width, height: S.PAGE.height }, margin: { top: S.PAGE.margin, bottom: S.PAGE.margin, left: S.PAGE.margin, right: S.PAGE.margin } } },
      headers: { default: new Header({ children: [new Paragraph({ spacing: { after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, color: S.COLORS.border, size: 4, space: 8 } }, children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 182, height: 34 }, altText: { name: 'KSE Business School', title: 'KSE Business School', description: 'KSE Business School logo' } })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run('KSE Business School · Professor’s Tutor   |   ', { size: 18, color: S.COLORS.muted }), new TextRun({ children: [PageNumber.CURRENT], font: S.FONT, size: 18, color: S.COLORS.muted })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { renderSyllabusDocx };
