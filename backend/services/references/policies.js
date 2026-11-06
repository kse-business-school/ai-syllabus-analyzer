// Довідник політик розділу Course Policies — єдина точка читання (БД з фолбеком на фікстуру).
// Формат блока = fixtures/reference/policies.library.json: { order, key, title, titleUk, mode, required, rationale, options | text }.
// Двомовність (B-1.4, v2): textUk і status.uk у locked-блоці, labelUk / textUk / status.uk у варіантах.
const Policy = require('../../models/Policy');
const { readFixture } = require('./fixtureRefs');

const TYPE = 'syllabus-policy';

function fixtureLibrary() {
  const { version, blocks } = readFixture('policies.library.json');
  return { version, blocks };
}

// Порівняння версій виду "1.1" / "2": true, якщо a >= b
function versionGte(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return true;
}

// Markdown для сторінки Documents і PolicyReader: усі варіанти (library) або текст (locked)
function policyMarkdown(block) {
  const lines = [];
  if (block.rationale) lines.push(`*${block.rationale}*`, '');
  if (block.mode === 'locked') {
    lines.push(block.text || '');
  } else {
    lines.push('Choose one option:', '');
    for (const o of block.options || []) lines.push(`- **${o.label}** — ${o.text}`);
  }
  return lines.join('\n').trim();
}

/** Українські поля (лише присутні): textUk, labelUk, status.uk. */
function ukFields(src) {
  const out = {};
  if (src.labelUk) out.labelUk = src.labelUk;
  if (src.textUk) out.textUk = src.textUk;
  if (src.status?.uk) out.status = { uk: src.status.uk };
  return out;
}

const optionFields = (o) => ({ key: o.key, label: o.label, text: o.text, ...ukFields(o) });

function toBlock(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  const block = {
    order: d.order,
    key: d.key,
    title: d.title,
    titleUk: d.titleUk,
    mode: d.mode,
    required: d.blockRequired !== false,
    rationale: d.rationale,
  };
  if (d.mode === 'locked') Object.assign(block, { text: d.text }, ukFields(d));
  else block.options = (d.options || []).map(optionFields);
  return block;
}

function blockFields(block, version) {
  const fields = {
    type: TYPE,
    key: block.key,
    order: block.order,
    title: block.title,
    titleUk: block.titleUk,
    mode: block.mode,
    blockRequired: block.required !== false,
    rationale: block.rationale,
    isRequired: false, // acknowledge не потрібен
    contentType: 'markdown',
    content: policyMarkdown(block),
    libraryVersion: version,
  };
  if (block.mode === 'locked') {
    Object.assign(fields, { text: block.text, textUk: undefined, status: undefined }, ukFields(block));
    fields.options = [];
  } else {
    fields.options = block.options.map(optionFields);
  }
  return fields;
}

// Ідемпотентний upsert за key. Блок із libraryVersion >= версії фікстури не чіпаємо (адмін міг правити).
// Блок з adminModified не перезаписуємо навіть при новій версії фікстури: він іде в stats.conflicts
// ({ key, libraryVersion, fixtureVersion }), щоб адмін вирішив, чи брати фікстуру.
async function seedPolicyLibrary(library = fixtureLibrary(), { dryRun = false } = {}) {
  const stats = { created: 0, updated: 0, skipped: 0, conflicts: [] };
  for (const block of library.blocks) {
    const existing = await Policy.findOne({ key: block.key });
    if (!existing) {
      if (!dryRun) await Policy.create(blockFields(block, library.version));
      stats.created += 1;
    } else if (existing.type === TYPE && versionGte(existing.libraryVersion, library.version)) {
      stats.skipped += 1;
    } else if (existing.adminModified) {
      stats.conflicts.push({ key: block.key, libraryVersion: existing.libraryVersion || null, fixtureVersion: library.version });
    } else {
      if (!dryRun) {
        const { key, ...fields } = blockFields(block, library.version);
        existing.set(fields);
        existing.version = (existing.version || 1) + 1;
        await existing.save();
      }
      stats.updated += 1;
    }
  }
  return stats;
}

async function getPolicyLibrary() {
  const docs = await Policy.find({ type: TYPE, isActive: true }).sort({ order: 1 });
  if (!docs.length) return fixtureLibrary();
  const version = docs.map((d) => d.libraryVersion).filter(Boolean)
    .reduce((max, v) => (versionGte(v, max) ? v : max), '0');
  return { version: version === '0' ? fixtureLibrary().version : version, blocks: docs.map(toBlock) };
}

async function getPolicyBlock(key) {
  const { blocks } = await getPolicyLibrary();
  return blocks.find((b) => b.key === key) || null;
}

module.exports = { seedPolicyLibrary, getPolicyLibrary, getPolicyBlock, policyMarkdown, POLICY_TYPE: TYPE };
