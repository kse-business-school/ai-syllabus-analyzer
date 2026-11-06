// Текстове подання стану за розділами шаблону: для промптів LLM і правої панелі (з diff проти baselineState).
// Не є .docx (його будує services/document/writers/templateDocx.js), але порядок і назви розділів ті самі.
// Порожні вільні розділи не мають блоків; таблиця At a Glance завжди повна (порожні значення — '—').
const { SECTION_KEYS } = require('./schema');
const { blockTitle, lockedText, optionText } = require('../references/policyText');

const CHOOSE_OPTION = '[Choose an option]';
// Текст library-політики з файлу, поки викладач не обрав варіант і не залишив свій текст
const FROM_FILE_NOTE = '(from your file — choose an option or keep your text)';
const EMPTY = '—';

const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const val = (v) => (filled(v) ? String(v).trim() : EMPTY);
const heading = (text) => ({ kind: 'heading', text });
const paragraph = (text) => ({ kind: 'paragraph', text });
const item = (text) => ({ kind: 'list-item', text });
const row = (...cells) => ({ kind: 'table-row', text: cells.join(' | ') });
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hours = (h) => (filled(h) ? `${h} h` : EMPTY);
const range = (t) => (t && (t.start || t.end) ? `${t.start || '?'} – ${t.end || '?'}` : null);
const textBlocks = (text) => String(text || '').split(/\n+/).map((t) => t.trim()).filter(Boolean).map(paragraph);
const list = (title, values) => (values?.length ? [heading(title), ...values.filter(filled).map(item)] : []);

/**
 * Текст блоку політики: обраний варіант довідника, власний текст викладача або плейсхолдер.
 * Текст з файлу без обраного варіанта (source: 'parsed') — ще не рішення: показується текст файлу з позначкою
 * FROM_FILE_NOTE; плейсхолдер лише тоді, коли тексту немає.
 */
function policyText(p, block, language) {
  if (p.mode === 'locked') return p.text || lockedText(block, language) || '';
  const own = ['instructor_directed', 'fixture_edited'].includes(p.source) || p.modified;
  if (own && filled(p.text)) return p.text;
  if (filled(p.optionKey)) return optionText(block?.options?.find((o) => o.key === p.optionKey), language) || p.text || CHOOSE_OPTION;
  if (filled(p.text)) return `${p.text.trim()} ${FROM_FILE_NOTE}`;
  return CHOOSE_OPTION;
}

const RENDERERS = {
  at_a_glance: (s) => {
    const h = s.header || {};
    const c = h.computed || {};
    return [
      row('Program', val(s.programCode)),
      row('Course type', val(capitalize(h.courseKind))),
      row('Term', val(range(h.term) || range(c.termFromSchedule))),
      row('Delivery mode', val(h.deliveryFormat)),
      row('Credits (ECTS)', val(h.ects)),
      row('Total hours', val(h.totalHours)),
      row('Contact hours', val(c.contactHours)),
      row('Self-study hours', val(c.selfStudyHours)),
      row('Department', val(h.department)),
      row('Language', val(h.language)),
      row('Study mode', val(h.studyMode)),
      row('Instructor', val((s.instructors || []).map((i) => i.name).filter(filled).join(', '))),
    ];
  },
  course_info: (s) => {
    const pr = s.summary?.prerequisites || {};
    const prereq = [pr.text, ...(pr.fixtureRefs || [])].filter(filled).join('; ');
    return [
      row('Course Title', val(s.header?.courseTitle)),
      ...(filled(s.header?.courseCode) ? [row('Course Code', s.header.courseCode)] : []),
      row('Prerequisites', val(prereq)),
    ];
  },
  short_description: (s) => textBlocks(s.summary?.shortDescription?.text),
  course_objectives: (s) => (s.summary?.objectives || []).filter((o) => filled(o.text)).map((o) => item(o.text.trim())),
  learning_outcomes: (s) => (s.outcomes || []).filter((o) => filled(o.text)).map((o, i) => {
    const plo = (o.plo || []).map((p) => (p.coverage === 'partial' ? `${p.code} (partial)` : p.code));
    return item(`LO${i + 1}. ${o.text.trim()}${plo.length ? ` [PLO: ${plo.join(', ')}]` : ''}`);
  }),
  connection_to_capstone: (s) => textBlocks(s.summary?.capstone?.text),
  instructor: (s) => (s.instructors || []).flatMap((i) => [
    heading(val(i.name)),
    ...(filled(i.position) ? [paragraph(i.position)] : []),
    ...[['Email', i.email], ['Office hours', i.officeHours], ['Assistants', i.assistants]]
      .filter(([, v]) => filled(v)).map(([k, v]) => row(k, v)),
    ...list('Expertise', i.expertise),
    ...list('Education', i.education),
    ...list('Experience', i.experience),
  ]),
  schedule: (s) => {
    const sessions = (s.sessions || []).map((x, i) => {
      const when = [x.date, x.time].filter(filled).join(' ');
      const extra = [filled(x.guest) && `Guest: ${x.guest}`, filled(x.additional) && x.additional].filter(Boolean).join('; ');
      return row(x.n ?? i + 1, val(x.topic), val(x.type), hours(x.hours), val(x.format), val(when), val(extra));
    });
    const work = (s.individualWork || []).map((w) => row(val(w.title), hours(w.hours)));
    return [...sessions, ...(work.length ? [heading('Individual work'), ...work] : [])];
  },
  assessment: (s) => {
    const items = (s.assessments || []).map((a) => row(val(a.name), filled(a.weight) ? `${a.weight}%` : EMPTY, val(a.deadline), val(a.criteria)));
    const total = s.header?.computed?.assessmentTotal;
    const comp = (s.compensation?.items || []).filter((c) => filled(c.text)).map((c) => item(c.text.trim()));
    return [
      ...items,
      ...(items.length ? [row('Total', filled(total) ? `${total}%` : EMPTY)] : []),
      ...(comp.length ? [heading('Compensation and retakes'), ...comp] : []),
    ];
  },
  materials: (s) => {
    const cite = (m) => item([m.citation, m.url].filter(filled).join(' — '));
    const req = (s.materials?.required || []).filter((m) => filled(m.citation)).map(cite);
    const rec = (s.materials?.recommended || []).filter((m) => filled(m.citation)).map(cite);
    return [...(req.length ? [heading('Required'), ...req] : []), ...(rec.length ? [heading('Recommended'), ...rec] : [])];
  },
  policies: (s, refs) => {
    const blocks = new Map((refs?.policyLibrary?.blocks || []).map((b) => [b.key, b]));
    return (s.policies || []).flatMap((p) => {
      const block = blocks.get(p.key);
      return [heading(blockTitle(block, s.language) || p.key), ...textBlocks(policyText(p, block, s.language))];
    });
  },
};

/**
 * @param {object} state  Syllabus.state
 * @param {object} refs   довідники програми (template — порядок і назви розділів, policyLibrary — тексти варіантів)
 * @returns {{ sections: { key, docNumber, title, blocks: { kind: 'heading'|'paragraph'|'list-item'|'table-row', text }[] }[] }}
 */
function renderState(state, refs) {
  const s = state || {};
  const template = refs?.template?.length
    ? [...refs.template].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : SECTION_KEYS.map((key) => ({ key, docNumber: null, title: key }));
  return {
    sections: template.filter((t) => RENDERERS[t.key]).map((t) => ({
      key: t.key,
      docNumber: t.docNumber ?? null,
      title: t.title,
      blocks: RENDERERS[t.key](s, refs),
    })),
  };
}

/** Плоский текст подання (для промптів): заголовки розділів і блоки по рядку. */
function renderText(rendered) {
  return rendered.sections.map((sec) => [
    `## ${sec.docNumber ? `${sec.docNumber}. ` : ''}${sec.title}`,
    ...sec.blocks.map((b) => (b.kind === 'heading' ? `### ${b.text}` : b.kind === 'list-item' ? `- ${b.text}` : b.text)),
  ].join('\n')).join('\n\n');
}

module.exports = { renderState, renderText, policyText, CHOOSE_OPTION, FROM_FILE_NOTE };
