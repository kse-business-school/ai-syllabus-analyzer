// Фінальний файл силабусу: один syllabus.docx за шаблоном KSE (writers/templateDocx.js).
// Кеш — файл uploads/outputs/<id>/syllabus.r<stateRevision>.docx: нова ревізія стану дає нове ім'я,
// тож застарілий файл ніколи не віддається. Ревізії зберігаються до видалення силабусу:
// паралельне завантаження попередньої ревізії має встигнути відкрити свій файл.

const fs = require('fs').promises;
const path = require('path');
const Syllabus = require('../models/Syllabus');
const Program = require('../models/Program');
const { renderSyllabusDocx } = require('./document/writers/templateDocx');
const store = require('./syllabusState/store');
const references = require('./references');
const { httpError } = require('../utils/httpError');
const { OUTPUTS } = require('./outputFormats');

const OUTPUTS_DIR = path.join(__dirname, '../uploads/outputs');
const rendering = new Map();
const invalidated = new Set();

// Рішення без зміни стану теж скидає кеш; файл не видаляємо під час активного завантаження.
const invalidateOutputs = (syllabusId) => invalidated.add(String(syllabusId));

const outputDir = (syllabusId) => path.join(OUTPUTS_DIR, String(syllabusId));
const cachePath = (syllabusId, revision) => path.join(outputDir(syllabusId), `syllabus.kse-brand-1.r${revision}.docx`);

/** `<Course_Title>_syllabus.docx`: літери й цифри будь-якої мови, решта — підкреслення. */
function downloadName(syllabus, state) {
  const title = state?.header?.courseTitle || syllabus.title || '';
  const base = String(title).normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Syllabus';
  return `${base}${OUTPUTS['syllabus.docx'].suffix}`;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Атомарний запис: tmp + rename (паралельні запити не бачать напівзаписаний файл). */
async function writeAtomic(target, buffer) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, target);
}

/** Підпис програми в At a Glance: label редакції з Program.editions, інакше programCode. */
async function programLabelOf(syllabus) {
  const code = syllabus.programCode;
  if (!code) return null;
  const program = syllabus.programId ? await Program.findById(syllabus.programId).select('editions').lean() : null;
  return program?.editions?.find((e) => e.code === code)?.label || code;
}

/** Готовий файл для поточної ревізії стану: з кешу або рендер. */
async function ensureDocx(syllabusId) {
  const syllabus = await Syllabus.findById(syllabusId).select('title programCode programId needsRebuild legacy state status');
  if (!syllabus) throw httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
  // Стану ще немає (трек 2 до кінця розбору): причина — аналіз, а не стара версія
  if (!syllabus.legacy && !syllabus.needsRebuild && !syllabus.state) {
    if (syllabus.status === 'analyzing') {
      throw httpError(409, 'The file is still being analysed. The .docx will be available when the analysis finishes.', { code: 'ANALYSIS_IN_PROGRESS', retryable: true });
    }
    if (syllabus.status === 'error') {
      throw httpError(409, 'The analysis of this file failed. Run the analysis again to get the .docx.', { code: 'ANALYSIS_FAILED' });
    }
  }
  if (syllabus.legacy || syllabus.needsRebuild || !syllabus.state) {
    throw httpError(409, 'This syllabus was created in an older version. Rebuild in the new format to continue.', { code: 'NEEDS_REBUILD' });
  }
  const { state, revision } = await store.getState(syllabusId);
  const target = cachePath(syllabusId, revision);
  const refresh = invalidated.delete(String(syllabusId));
  if (refresh || !(await exists(target))) {
    if (!rendering.has(target)) {
      rendering.set(target, (async () => {
        const refs = await references.getRefs(syllabus.programCode);
        await writeAtomic(target, await renderSyllabusDocx(state, refs, { programLabel: await programLabelOf(syllabus) }));
      })().finally(() => rendering.delete(target)));
    }
    try {
      await rendering.get(target);
    } catch (err) {
      invalidateOutputs(syllabusId);
      throw err;
    }
  }
  return { path: target, filename: downloadName(syllabus, state), revision };
}

/** GET /outputs/:name → { path, filename, contentType }; збільшує лічильник завантажень. Старі імена → 404. */
async function getOutputFile(syllabusId, name) {
  const spec = Object.hasOwn(OUTPUTS, name) ? OUTPUTS[name] : null;
  if (!spec) {
    throw httpError(404, `File "${name}" is not available. Available: ${Object.keys(OUTPUTS).join(', ')}.`, { code: 'OUTPUT_NOT_AVAILABLE' });
  }
  const file = await ensureDocx(syllabusId);
  await Syllabus.updateOne({ _id: syllabusId }, { $inc: { downloads: 1 } });
  return { path: file.path, filename: file.filename, contentType: spec.contentType };
}

async function removeOutputDir(syllabusId) {
  invalidated.delete(String(syllabusId));
  await fs.rm(outputDir(syllabusId), { recursive: true, force: true }).catch(() => {});
}

module.exports = { OUTPUTS, OUTPUTS_DIR, ensureDocx, getOutputFile, downloadName, outputDir, removeOutputDir, invalidateOutputs };
