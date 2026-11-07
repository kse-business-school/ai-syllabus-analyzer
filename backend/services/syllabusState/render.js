// Текстове подання стану за розділами шаблону: для промптів LLM і правої панелі (з diff проти baselineState).
// Не є .docx (його будує services/document/writers/templateDocx.js), але порядок і назви розділів ті самі.
// Порожні вільні розділи не мають блоків; таблиця At a Glance завжди повна (порожні значення — '—').
const { SECTION_KEYS } = require('./schema');
const { blockTitle, lockedText, optionText } = require('../references/policyText');
const { labelsFor, sectionTitleOf, docTitleOf, sessionNumbers } = require('../document/labels');

const CHOOSE_OPTION = '[Choose an option]';
// Текст library-політики з файлу, поки викладач не обрав варіант і не залишив свій текст
const FROM_FILE_NOTE = '(from your file — choose an option or keep your text)';
const EMPTY = '—';
const CHOOSE_OPTION_UK = '[Оберіть варіант]';
const FROM_FILE_NOTE_UK = '(з вашого файлу — оберіть варіант або залиште свій текст)';

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
// Вага у відсотках або бали (B-6.3): «30%» / «30 балів (7 × 2)»
const weightText = (a, L) => {
  if (filled(a.maxPoints)) return `${a.maxPoints} ${L.points}${filled(a.unitCount) && a.rubric?.length ? ` (${a.unitCount} × ${Math.max(...a.rubric.map((r) => r.points))})` : ''}${filled(a.weight) ? ` · ${a.weight}%` : ''}`;
  return filled(a.weight) ? `${a.weight}%` : EMPTY;
};

/** Текст рівня програми з профілю шаблону (pedagogical_approach.fixedText) мовою документа. */
function fixedTextOf(refs, language) {
  const t = (refs?.template || []).find((x) => x.key === 'pedagogical_approach')?.fixedText;
  if (!t) return [];
  return (language === 'uk' ? t.uk : t.en) || t.en || t.uk || [];
}

/** Підтверджені зв'язки CLO → ПРН: ПРН програми з номерами результатів курсу, що його формують (B-9.1). */
function ploCoverage(s, refs) {
  const byCode = new Map((refs?.outcomes || []).map((o) => [o.code, o]));
  const rows = new Map();
  (s.outcomes || []).filter((o) => filled(o.text)).forEach((o, i) => {
    for (const p of o.plo || []) {
      if (p.confirmed !== true || !byCode.has(p.code)) continue;
      if (!rows.has(p.code)) rows.set(p.code, { plo: byCode.get(p.code), clos: [] });
      rows.get(p.code).clos.push(`LO${i + 1}`);
    }
  });
  return [...rows.values()].sort((a, b) => (refs.outcomes.indexOf(a.plo) - refs.outcomes.indexOf(b.plo)));
}

/**
 * Текст блоку політики: обраний варіант довідника, власний текст викладача або плейсхолдер.
 * Текст з файлу без обраного варіанта (source: 'parsed') — ще не рішення: показується текст файлу з позначкою
 * FROM_FILE_NOTE; плейсхолдер лише тоді, коли тексту немає.
 */
function policyText(p, block, language) {
  if (p.mode === 'locked') return p.text || lockedText(block, language) || '';
  const own = ['instructor_directed', 'fixture_edited'].includes(p.source) || p.modified;
  // Плейсхолдер і позначка «з файлу» — мовою документа
  const choose = language === 'uk' ? CHOOSE_OPTION_UK : CHOOSE_OPTION;
  if (own && filled(p.text)) return p.text;
  if (filled(p.optionKey)) return optionText(block?.options?.find((o) => o.key === p.optionKey), language) || p.text || choose;
  if (filled(p.text)) return `${p.text.trim()} ${language === 'uk' ? FROM_FILE_NOTE_UK : FROM_FILE_NOTE}`;
  return choose;
}

const RENDERERS = {
  at_a_glance: (s, refs) => {
    const h = s.header || {};
    const c = h.computed || {};
    const L = labelsFor(s.language);
    return [
      row(L.program, val(s.programCode)),
      // Корпус і блок — лише для програм із закритим списком блоків (B-8.6)
      ...((refs?.programBlocks || []).length ? [row(L.programBlock, val(h.programBlock))] : []),
      row(L.courseType, val(h.courseKind ? L[h.courseKind] || capitalize(h.courseKind) : null)),
      row(L.term, val(range(h.term) || range(c.termFromSchedule))),
      row(L.deliveryMode, val(h.deliveryFormat ? L.formats?.[h.deliveryFormat] || h.deliveryFormat : null)),
      row(L.credits, val(h.ects)),
      row(L.totalHours, val(h.totalHours)),
      row(L.contactHours, val(c.contactHours)),
      row(L.selfStudyHours, val(c.selfStudyHours)),
      row(L.department, val(h.department)),
      row(L.language, val(h.language)),
      row(L.studyMode, val(h.studyMode)),
      row(L.instructor, val((s.instructors || []).map((i) => i.name).filter(filled).join(', '))),
    ];
  },
  course_info: (s) => {
    const L = labelsFor(s.language);
    const pr = s.summary?.prerequisites || {};
    const prereq = [pr.text, ...(pr.fixtureRefs || [])].filter(filled).join('; ');
    return [
      row(L.courseTitle, val(s.header?.courseTitle)),
      ...(filled(s.header?.courseCode) ? [row(L.courseCode, s.header.courseCode)] : []),
      row(L.prerequisites, val(prereq)),
    ];
  },
  short_description: (s) => textBlocks(s.summary?.shortDescription?.text),
  course_objectives: (s) => (s.summary?.objectives || []).filter((o) => filled(o.text)).map((o) => item(o.text.trim())),
  // MMM, розділ 1: ПРН програми, які курс підсилює, і результати курсу, що їх формують (лише підтверджені зв'язки)
  programme_outcomes: (s, refs) => ploCoverage(s, refs).map(({ plo, clos }) => item(`${plo.code}. ${plo.text}${clos.length ? ` — ${clos.join(', ')}` : ''}`)),
  learning_outcomes: (s) => {
    const L = labelsFor(s.language);
    return (s.outcomes || []).filter((o) => filled(o.text)).map((o, i) => {
      const plo = (o.plo || []).map((p) => (p.coverage === 'partial' ? `${p.code} (${L.partial})` : p.code));
      return item(`LO${i + 1}. ${o.text.trim()}${plo.length ? ` [PLO: ${plo.join(', ')}]` : ''}`);
    });
  },
  practical_application: (s) => textBlocks(s.summary?.practicalApplication?.text),
  connection_to_capstone: (s) => textBlocks(s.summary?.capstone?.text),
  instructor: (s) => {
    const L = labelsFor(s.language);
    return (s.instructors || []).flatMap((i) => [
      heading(val(i.name)),
      ...(filled(i.position) ? [paragraph(i.position)] : []),
      ...[[L.email, i.email], [L.officeHours, i.officeHours], [L.assistants, i.assistants]]
        .filter(([, v]) => filled(v)).map(([k, v]) => row(k, v)),
      ...list(L.expertise, i.expertise),
      ...list(L.education, i.education),
      ...list(L.experience, i.experience),
    ]);
  },
  schedule: (s) => {
    const L = labelsFor(s.language);
    const modules = [...(s.modules || [])].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
    const guests = new Map((s.guests || []).map((g) => [g.id, g]));
    const out = [];
    let currentModule = null;
    for (const { session: x, label, module } of sessionNumbers(s)) {
      if (module && module !== currentModule) {
        currentModule = module;
        out.push(heading(`${L.module} ${module}. ${val(modules[module - 1]?.title)}`));
      }
      const when = [x.date, x.time].filter(filled).join(' ');
      const guest = x.guestId ? guests.get(x.guestId)?.name : x.guest;
      const extra = [filled(guest) && `${L.guest}: ${guest}`, filled(x.additional) && x.additional,
        filled(x.prep) && `${L.prep}: ${x.prep}`, filled(x.deadline) && `${L.deadline}: ${x.deadline}`].filter(Boolean).join('; ');
      out.push(row(label, val(x.topic), val(x.type), hours(x.hours), val(x.format), val(when), val(extra)));
    }
    const work = (s.individualWork || []).map((w) => row(val(w.title), hours(w.hours)));
    return [...out, ...(work.length ? [heading(L.individualWork), ...work] : [])];
  },
  guest_speakers: (s) => {
    const L = labelsFor(s.language);
    return (s.guests || []).map((g) => row([g.name, g.company].filter(filled).join(', ') || EMPTY,
      [g.topic, g.format].filter(filled).join(' — ') || EMPTY, g.status ? L.status[g.status] : EMPTY));
  },
  assessment: (s) => {
    const L = labelsFor(s.language);
    const items = (s.assessments || []).flatMap((a) => [
      row(val(a.name), weightText(a, L), val(a.deadline), val(a.criteria)),
      ...(a.rubric || []).map((r) => item(`${L.rubric}: ${r.points} — ${r.descriptor}`)),
    ]);
    const total = s.header?.computed?.assessmentTotal;
    const comp = (s.compensation?.items || []).filter((c) => filled(c.text)).map((c) => item(c.text.trim()));
    return [
      ...items,
      ...(items.length ? [row(L.total, filled(total) ? `${total}%` : EMPTY)] : []),
      ...(comp.length ? [heading(L.compensation), ...comp] : []),
    ];
  },
  // Текст рівня програми (B-6.4): той самий у кожному силабусі програми, мовою документа
  pedagogical_approach: (s, refs) => fixedTextOf(refs, s.language).flatMap((p) => [heading(p.title), paragraph(p.text)]),
  materials: (s) => {
    const L = labelsFor(s.language);
    const cite = (m) => item([m.citation, m.url].filter(filled).join(' — '));
    const req = (s.materials?.required || []).filter((m) => filled(m.citation)).map(cite);
    const rec = (s.materials?.recommended || []).filter((m) => filled(m.citation)).map(cite);
    const labels = new Map(sessionNumbers(s).map(({ session, label }) => [session.id, label]));
    const per = (s.materials?.bySession || []).filter((m) => filled(m.citation))
      .map((m) => item(`${L.before(labels.get(m.sessionId) || '?')} — ${[m.citation, m.url].filter(filled).join(' — ')}`));
    return [...(req.length ? [heading(L.required), ...req] : []), ...(rec.length ? [heading(L.recommended), ...rec] : []),
      ...(per.length ? [heading(L.bySession), ...per] : [])];
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
      // Назви розділу й групи — мовою документа (titleUk / docTitleUk)
      title: sectionTitleOf(t, s.language),
      docTitle: docTitleOf(t, s.language) || null,
      locked: t.nature === 'locked' || undefined,
      blocks: RENDERERS[t.key](s, refs),
    })),
  };
}

/** Плоский текст подання (для промптів): заголовки розділів і блоки по рядку. */
function renderText(rendered) {
  return rendered.sections.map((sec) => [
    `## ${sec.docNumber != null ? `${sec.docNumber}. ` : ''}${sec.title}`,
    ...sec.blocks.map((b) => (b.kind === 'heading' ? `### ${b.text}` : b.kind === 'list-item' ? `- ${b.text}` : b.text)),
  ].join('\n')).join('\n\n');
}

module.exports = { renderState, renderText, policyText, ploCoverage, fixedTextOf, weightText, CHOOSE_OPTION, FROM_FILE_NOTE };
