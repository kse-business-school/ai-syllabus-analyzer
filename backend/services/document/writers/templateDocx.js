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
const fs = require('fs');
const path = require('path');
const logoImage = require('sharp')(fs.readFileSync(path.join(__dirname, '../../../assets/brand/kse-business-school-green.svg'))).resize({ width: 728 }).png().toBuffer();

const DASH = '—';
const has = (v) => typeof v === 'string' ? v.trim() !== '' : v != null;
const clean = (v) => (typeof v === 'string' ? v.trim() : v);

// ---- Рядкові/абзацні будівельні блоки ----
const run = (text, opts = {}) => new TextRun({ text, font: S.FONT, size: S.SIZES.body, ...opts });
const placeholder = (label, kind = 'To be completed') =>
  new TextRun({ text: `[${kind}: ${label}]`, font: S.FONT, size: S.SIZES.body, highlight: S.PLACEHOLDER_HIGHLIGHT });

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
  text: `[${kind || 'To be completed'}: ${label}]`, font: S.FONT, size: S.SIZES.table, highlight: S.PLACEHOLDER_HIGHLIGHT,
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
const hoursLabel = (h) => (h != null ? `${fmtNum(h)} ac. hour${h === 1 ? '' : 's'}` : null);
const TYPE_LABELS = { lecture: 'Lecture', practice: 'Practice', workshop: 'Workshop' };
const FORMAT_LABELS = { offline: 'Offline', online: 'Online', hybrid: 'Hybrid' };

// ---- Розділи ----
function atAGlance(state, refs, programLabel) {
  const h = state.header || {};
  const c = h.computed || {};
  const term = h.term?.start || h.term?.end ? h.term : c.termFromSchedule;
  const termText = term && (term.start || term.end) ? [term.start, term.end].filter(Boolean).join(' – ') : null;

  let contact = c.contactHours != null ? `${fmtNum(c.contactHours)} ac. hours` : DASH;
  const parts = [['lectures', c.lectureHours], ['practice', c.practiceHours], ['workshops', c.workshopHours]]
    .filter(([, v]) => v != null && v !== 0).map(([n, v]) => `${n} ${fmtNum(v)}`);
  if (c.contactHours != null && parts.length) contact += ` (${parts.join(', ')})`;

  const assessments = state.assessments || [];
  const total = c.assessmentTotal != null ? c.assessmentTotal : assessments.reduce((a, x) => a + (x.weight || 0), 0);
  const assessmentText = assessments.length ? `${assessments.length} component${assessments.length === 1 ? '' : 's'} · ${fmtNum(total)}%` : DASH;

  const instructors = (state.instructors || []).map((i) => i.name).filter(has).join(', ');
  const modes = h.deliveryFormat ? FORMAT_LABELS[h.deliveryFormat] : (c.deliveryModes || []).map((m) => FORMAT_LABELS[m] || m).join(', ');

  const rows = [
    ['Program', programLabel || state.programCode || DASH],
    ['Term', termText || DASH],
    ['Delivery mode', modes || DASH],
    ['Credits / ECTS', h.ects != null ? `${fmtNum(h.ects)} ECTS` : DASH],
    ['Contact hours', contact],
    ['Self-study hours', c.selfStudyHours != null ? `${fmtNum(c.selfStudyHours)} hours` : DASH],
    ['Instructor', instructors || DASH],
    ['Assessment', assessmentText],
  ];
  if (has(h.department)) rows.push(['Department', h.department]);
  if (has(h.language)) rows.push(['Language', h.language]);
  if (has(h.studyMode)) rows.push(['Study mode', h.studyMode]);

  return [heading2('At a Glance'), table(S.columnWidths('glance'), null, rows, { labelFirst: true })];
}

function matrixTable(state, refs) {
  const plos = new Map((refs.outcomes || []).map((o) => [o.code, o]));
  const assessments = state.assessments || [];
  const rows = (state.outcomes || []).map((clo, idx) => {
    const ploCells = (clo.plo || []).length
      ? clo.plo.map((p) => {
        const ref = plos.get(p.code);
        const suffix = p.coverage === 'partial' ? ' (partial)' : '';
        return `${p.code}${ref ? ` — ${ref.text}` : ''}${suffix}`;
      })
      : [cellPlaceholder('Programme outcome')];
    const ids = new Set(clo.assessmentIds || []);
    for (const a of assessments) if ((a.outcomeIds || []).includes(clo.id)) ids.add(a.id);
    const names = assessments.filter((a) => ids.has(a.id)).map((a) => a.name).filter(has);
    return [`CLO ${idx + 1}. ${has(clo.text) ? clo.text : '[To be completed]'}`, ploCells, names.length ? names : [cellPlaceholder('Assessment component')]];
  });
  if (!rows.length) rows.push([cellPlaceholder('Learning Outcomes'), DASH, DASH]);
  return table(S.columnWidths('matrix'), ['Course learning outcome (CLO)', 'Programme outcome (PLO)', 'Assessed by'], rows);
}

function summary(state, refs) {
  const sm = state.summary || {};
  const h = state.header || {};
  const out = [];
  out.push(heading2('Course Title'), textPara(h.courseTitle, 'Course Title'));
  out.push(heading2('Prerequisites'), textPara(sm.prerequisites?.text, 'Prerequisites'));
  out.push(heading2('Short Course Description'), textPara(sm.shortDescription?.text, 'Short Course Description'));
  out.push(heading2('Course Objectives'), ...bulletList(sm.objectives, 'Course Objectives'));

  out.push(heading2('Learning Outcomes'), para(run('By the end of this course, you will be able to:')));
  const clos = (state.outcomes || []).filter((o) => has(o.text));
  if (clos.length) clos.forEach((o) => out.push(numbered(run(clean(o.text)), 1)));
  else out.push(para(placeholder('Learning Outcomes')));
  out.push(matrixTable(state, refs), para([], { spacing: { after: 60 } }));

  out.push(heading2('Connection to Capstone Project'), textPara(sm.capstone?.text, 'Connection to Capstone Project'));
  const criteria = new Map((refs.capstone?.criteria || []).map((c) => [c.key, c.name]));
  const keys = sm.capstone?.criteriaKeys || [];
  if (keys.length) {
    out.push(para(run('Related Capstone criteria:', { bold: true })));
    keys.forEach((k) => out.push(bullet(run(criteria.get(k) || k))));
  }
  return out;
}

function instructorSection(state) {
  const out = [];
  const list = state.instructors || [];
  if (!list.length) return [para(placeholder('Instructor'))];
  list.forEach((ins) => {
    // Лише вбудовані JPEG: генератор не виконує мережевих запитів і не читає довільних шляхів.
    if (typeof ins.photo === 'string' && ins.photo.length < 200000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(ins.photo)) {
      const data = Buffer.from(ins.photo.split(',')[1], 'base64');
      if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
        out.push(para(new ImageRun({ type: 'jpg', data, transformation: { width: 96, height: 96 }, altText: { name: 'Instructor photo', title: ins.name || 'Instructor', description: 'Instructor profile photo' } })));
      }
    }
    out.push(table(S.columnWidths('instructor'), null, [
      ['Name', orPlaceholder(ins.name, 'Instructor name')],
      ['Position', orPlaceholder(ins.position, 'Position')],
      ['Email', orPlaceholder(ins.email, 'Email')],
      ['Office hours', orPlaceholder(ins.officeHours, 'Office hours')],
      ['Assistants', has(ins.assistants) ? ins.assistants : DASH],
    ], { labelFirst: true }));
    out.push(heading2('Areas of Expertise'), ...bulletList(ins.expertise, 'Areas of Expertise'));
    out.push(heading2('Education'), ...bulletList(ins.education, 'Education'));
    out.push(heading2('Professional Experience'), ...bulletList(ins.experience, 'Professional Experience'));
  });
  return out;
}

function scheduleSection(state) {
  const sessions = state.sessions || [];
  const out = [];
  const rows = sessions.map((s) => {
    const when = [fmtDate(s.date), has(s.time) ? s.time : null].filter(Boolean).join(', ');
    const sessionCell = [`Session ${s.n}`];
    if (when) sessionCell.push(when);
    if (s.hours != null) sessionCell.push(`(${hoursLabel(s.hours)})`);
    return [
      sessionCell,
      orPlaceholder(s.topic, 'Topic'),
      TYPE_LABELS[s.type] || DASH,
      FORMAT_LABELS[s.format] || DASH,
      has(s.guest) ? s.guest : DASH,
      has(s.additional) ? s.additional : DASH,
    ];
  });
  if (!rows.length) rows.push([cellPlaceholder('Sessions'), DASH, DASH, DASH, DASH, DASH]);
  out.push(table(S.columnWidths('schedule'), ['Session', 'Topic', 'Type', 'Format', 'Guest speaker', 'Additional information'], rows));

  out.push(heading2('Individual Work'));
  const iw = state.individualWork || [];
  const iwRows = iw.map((w) => [orPlaceholder(w.title, 'Activity'), w.hours != null ? `${fmtNum(w.hours)} hours` : DASH]);
  const total = state.header?.computed?.selfStudyHours;
  const sum = iw.reduce((a, w) => a + (w.hours || 0), 0);
  if (!iwRows.length) iwRows.push([cellPlaceholder('Individual Work'), DASH]);
  else iwRows.push([['Total'], `${fmtNum(total != null ? total : sum)} hours`]);
  const w = S.columnWidths('glance');
  out.push(table(w, ['Activity', 'Hours'], iwRows));
  return out;
}

function assessmentSection(state, refs) {
  const list = state.assessments || [];
  const out = [];
  const rows = list.map((a) => [
    orPlaceholder(a.name, 'Component'),
    a.weight != null ? fmtNum(a.weight) : cellPlaceholder('Weight'),
    orPlaceholder(a.criteria, 'Performance Criteria'),
    has(a.deadline) ? a.deadline : DASH,
  ]);
  const total = state.header?.computed?.assessmentTotal != null
    ? state.header.computed.assessmentTotal : list.reduce((x, a) => x + (a.weight || 0), 0);
  if (!rows.length) rows.push([cellPlaceholder('Assessment components'), DASH, DASH, DASH]);
  else rows.push([['Total'], fmtNum(total), '', '']);
  out.push(table(S.columnWidths('assessment'), ['Component', 'Weight (%)', 'Performance Criteria', 'Deadline'], rows));

  const items = state.compensation?.items || [];
  if (items.length) {
    out.push(heading2('Compensation Measures'));
    items.forEach((i) => out.push(bullet(has(i.text) ? run(clean(i.text)) : placeholder('Compensation measure'))));
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

function materialsSection(state) {
  const mat = state.materials || {};
  const block = (title, arr, label, required) => {
    const items = arr || [];
    return [heading2(title), ...(items.length ? items.map(materialItem) : [required ? para(placeholder(label)) : para(run(DASH))])];
  };
  return [...block('Required', mat.required, 'Required materials', true), ...block('Recommended', mat.recommended, 'Recommended materials', false)];
}

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
    if (b.mode === 'locked') { emit(title, has(p?.text) ? p.text : lockedText(b, state.language), title); continue; }
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
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE, spacing: { after: 240 },
      children: [new TextRun({ text: 'COURSE SYLLABUS · ' }), title ? new TextRun({ text: title }) : placeholder('Course Title')],
    }),
    ...atAGlance(state, refs, programLabel),
  ];
  // Нумерацію 1–6 рахує генератор за порядком розділів
  const sections = [
    ['Summary', () => summary(state, refs)],
    ['Instructor', () => instructorSection(state)],
    ['Course Structure & Schedule', () => scheduleSection(state)],
    ['Assessment and Grading', () => assessmentSection(state, refs)],
    ['Course Materials', () => materialsSection(state)],
    ['Course Policies', () => policiesSection(state, refs)],
  ];
  sections.forEach(([name, build], i) => children.push(heading1(`${i + 1}. ${name}`), ...build()));

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
