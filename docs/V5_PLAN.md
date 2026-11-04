# План v5 — «Силабус через діалог» (ТЗ v2.1) поверх рефакторингу v4

## Context

ТЗ v2.1 змінює продукт. Замість «аналізатора, який правит файл викладача tracked changes і відправляє АД» буде «діалог, який заповнює структурований силабус за шаблоном KSE і віддає .docx». Шляхів два: трек 1 з нуля і трек 2 з завантаженого файлу. Обидва ведуть в один стан документа.

**ТЗ описує код до рефакторингу** (`analyzer.js`, `finalRender.js`/Puppeteer, `lineDoc.js`/`applyEdits.js`/`revisionMarkup.js`, `CATEGORY_TO_BLOCK`, `recomputeReadiness`). У v4 цих файлів уже немає, тому кожну вимогу треба перенести на поточну архітектуру. Відповідність:

| ТЗ (старий код) | Поточний код v4 | Що робимо |
|---|---|---|
| `constants.js` SYLLABUS_TEMPLATE / 9 LO | `services/ai/constants.js` (markdown + 9 MBA-27) | → БД за `programCode` |
| `analyzer.js` (hasX / missingParts) | `services/ai/review/*` (checks → structure → diagnose → verify → rewrite) | `structure.js` стає парсером у слоти, `checks.js` → `services/checks/`. diagnose/verify/rewrite замінює «Ревізор треку 2» |
| `chatReply.js` one-shot | `services/ai/chatReply.js` + `chat/freeChat.js` (classifyIntent) | → оркестратор із function calling |
| `recomputeReadiness` accepted/total | `services/chat/readiness.js` (зважені групи, reviewed/total, порожня група = 100) | → затверджені обов'язкові розділи / обов'язкові |
| `CATEGORY_TO_BLOCK`, `nextPendingIssue` | `Suggestion.group` + `order` (severity × confidence) | порядок: severity → `order` секції шаблону |
| `finalRender.js` HTML → PDF | `outputs.js`, `outputFormats.js`, `writers/docx.js` (tracked/clean), PDF/PPTX writers | → один `syllabus.docx` з `writers/templateDocx.js` |
| `lineDoc` / `applyEdits` / `revisionMarkup` («без змін») | `services/document` (blocks, apply, writers) | лишається тільки розбір входу (extract → blocks) |
| Submit / email АД / resend | `submission.js`, `emailService.sendSubmissionToAdEmail`, `/submit`, `resend-submission` | видалити |
| `StudentCluster` / `Survey` / `PracticalIdea` | у v4 уже немає | — |

**Ухвалені рішення.**
- Єдиний вихід — .docx, згенерований за шаблоном. Конвеєр tracked/annotated/PPTX і PDF-виходи видаляємо.
- `programCode` — це редакція в `Program.editions` (MBA → MBA27, MBA28).
- На вхід приймаємо docx/doc/pdf, pptx прибираємо.
- UI і чат англійською, тому оновлюємо CLAUDE.md. Коментарі в коді лишаються українською.
- Повний обсяг: усі 10 етапів, хвилями.

**Пакет даних** (`/home/ubuntu/professors-tutor-package.zip`, станом на 22.10.2026):
- `policies.library.json`: 13 блоків (3 locked, 10 library), v1.1.
- `learning-outcomes.json`: MBA27 — 20 ПРН, MBA28 — 17 ПРН, `mapping27to28`, `themeDraft`.
- `programme-courses.json`: core-курси, MBA27 — 14, MBA28 — 11, з ECTS.
- `capstone.criteria.json`: 6 критеріїв, 2 типи проєкту.
- Шаблон KSE і заповнений Risk Management v.2.
- 4 силабуси для калібрування, схеми `.mmd`, XLSX із ПРН.

**У пакеті немає:**
- `*_redesigned.docx` з At a Glance;
- брендованого шаблону .docx;
- переліків `comp_*` / `prereq_*` / `proof_*` / `retake_*` / `improve_*`;
- каталогу «AI in Your Course»;
- полів Lecturers CRM;
- Layout-референсу з Notion (токени, MUI-мапінг).

---

## Цільова архітектура

### Стан силабусу — `Syllabus.state` (єдине джерело правди)

Об'єкт пишеться цілком, атомарно й з умовою: `findOneAndUpdate({_id, stateRevision: r}, {$set:{state}, $inc:{stateRevision:1}})`. Кожна мутація — чиста функція `state → state`.

```
state: {
  schemaVersion, programCode, track: 'scratch'|'upload', language,
  header: { courseTitle, courseCode, department, ects, totalHours, studyMode, deliveryFormat, term{start,end},
            courseKind /* E: core|elective за ProgramCourse(programCode), не за назвою */,
            computed{ contactHours, selfStudyHours, assessmentTotal, deliveryModes } },
  summary: { prerequisites{fixtureRefs[], text}, shortDescription, objectives[{id,text}], capstone{criteriaKeys[], projectTypes[], text} },
  outcomes: [{ id, text, plo[{code, coverage:'full'|'partial'}], assessmentIds[] }],
  instructors: [{ crmId, name, position, email, officeHours, assistants, expertise[], education[], experience[] }],
  sessions: [{ id, n, topic, type:'lecture'|'practice'|'workshop', hours, format, guest, additional, date, time }],
  individualWork: [{ id, title, hours }],
  assessments: [{ id, name, fixtureRef, weight, criteria, deadline, isParticipation, outcomeIds[] }],
  compensation: { items[{ group:'comp'|'proof'|'retake'|'improve', fixtureRef, text, modified }] },
  materials: { required[{id,citation,url,verified}], recommended[...] },
  policies: [{ key:'policy.attendance', mode, optionKey, candidateOptionKey, text, fixtureRef{key,version}, modified, source }],
  sections: { [key]: { approved, approvedAt, approvedRevision, source } }
}
```

- **Провенанс.** Кожна сутність має `source` ∈ `fixture | fixture_edited | instructor_directed | parsed | ai_draft | computed | crm` і `evidenceBlockIds`. Значення `parsed` і `ai_draft` додаємо до трьох із ТЗ, бо без них звіт не розрізнить імпорт, прийняту AI-чернетку і текст викладача.
- **Нові поля Syllabus:** `programCode`, `track`, `stateRevision`, `baselineState` (знімок після парсингу — для тумблера diff), `downloads` (лічильник, метрика MVP замість Submit). Заготовку `plagiarismCheck.similarSyllabi` додаємо як `null`: у v4 її немає, а ТЗ просить зберегти.
- **`status`:** `analyzing | in_progress | error`. Статус `submitted` прибираємо.
- **Журнал змін.** Колекція `SlotChange` (append-only): `{syllabusId, revision, path, before, after, source, suggestionId, by, at}`. Потрібна для аудиту, reopen і diff.
- **Реєстр слотів у коді** — `services/syllabusState/slots.js`. Для кожного слота задає `{key, section, slotType A–E, editability locked|library|free, required, complete(state), questionHint}`. Це єдине місце, з якого інструменти чату дізнаються, що можна чіпати.

### Довідники (усі за `programCode`; null = для всіх програм)

- `TemplateSection { programCode, key, order, number, title, required, nature: free|fixed, slotType, question, fixtureRef, computeFrom }`. Сідимо з `template.sections.json`, який складаємо з ТЗ §1/§4 і шаблону KSE.
- `ProgramOutcome { programCode, code, text, themeDraft, order }` — унікальний `(programCode, code)`. Коди нормалізуємо (NFC; кирилична «Р» проти латинської «P»). Окремо `OutcomeMapping` 27→28.
- `ProgramCourse { programCode, code, uk, en, ects }`. Звідси беруться `courseKind` і ECTS (слот A) для core-курсів.
- `CapstoneGuide { programCode, version, projectTypes, structure, criteria, deliverables, plagiarismThreshold }`. Поки що MBA27 і MBA28 отримують однаковий вміст із MBA28-гайдлайнів.
- **Політики — розширений `Policy`**, як просить ТЗ:
  - новий `type: 'syllabus-policy'`;
  - поля `key` (unique sparse), `order`, `mode`, `blockRequired`, `rationale`, `options[{key,label,text}]`, `libraryVersion`;
  - `content` генеруємо як markdown з усіма варіантами, тож Documents і `PolicyReader` показують довідник без нового UI;
  - `isRequired:false`, щоб не вимагати acknowledge.
  - Читання йде лише через `services/references/policies.js`.
- **Порожні stub-каталоги** `assessment-components`, `prerequisites`, `compensation`, `ai-tools`. Поки вони порожні, відповідні B-слоти деградують до C (питання), а промпт AI-інструментів вимкнений.
- `Program.editions [{code, label}]`. Сід: MBA → MBA27, MBA28.
- Фікстури копіюємо з пакета в `backend/fixtures/reference/`. Сід ідемпотентний (`services/references/seed.js`), запускається на старті поруч із `Program.seedDefaults` і окремим скриптом.

### Suggestion — картка правки слота

- **Прибираємо:** `ops`, `options[].ops`, `docVersion`, `supersedes`.
- **Додаємо:**
  - `origin: reviewer|check|orchestrator|interviewer`, `checkId`;
  - `target{section, path, entityId}`;
  - `draft{ template /* текст з {{v1}} */, value, proposedValues[{id,label,value,path,confirmed}], basisHash }`;
  - `options[{id,label,value,optionKey}]` для вибору варіанта політики;
  - `stale`.
- **Лишаємо:** `kind edit|choice|question`, `status`, атомарні переходи `findOneAndUpdate`, обов'язкову причину для critical/high (audit reason), `rejectTag`, `decisionHistory`, `versions`, `sources`.
- **Семантика:**
  - accept = Confirm;
  - reject = Cancel;
  - refine = Reword;
  - новий `values` = «Change the value»: перерендер шаблону чернетки без LLM;
  - reopen = відкат через `SlotChange`, лише якщо поточне значення ще дорівнює `after`, інакше 409 `REOPEN_CONFLICT`.
- **Застаріла чернетка.** Accept з `hash(поточного значення) ≠ basisHash` → 409 `STALE_DRAFT`. Інші pending-чернетки на той самий шлях отримують `stale`.

### Модулі

- **Нове:**
  - `utils/jsonSchema.js` — `validateSchema` з `review/schemas.js`.
  - `services/references/` (`index.js`, `seed.js`, `policies.js`).
  - `services/syllabusState/`: `schema.js`, `slots.js`, `empty.js` (locked-політики з фікстури, library `optionKey:null` без дефолту), `computed.js` (усі E-поля), `store.js`, `readiness.js`, `render.js` (state → текст для промптів і правої панелі), `diff.js` (`diffBlock` переносимо з `document/apply.js`).
  - `services/checks/`: `glance.js`, `assessment.js`, `workload.js`, `regulations.js`, `outcomes.js`, `plo.js`, `index.js` — чисті синхронні функції. `llm.js` — м'які перевірки (компонент ↔ заняття, компонент ↔ заборони ШІ), кеш за hash стану.
  - `services/ai/prompts/`:
    - `preamble.js` — з `TemplateSection[]` програми, `EDIT_PROTOCOL` і переліку ПРН;
    - `interviewer.js`, `formulator.js`, `reviewer.js`, `loMapping.js`;
    - `aiTools.js` — вимкнений, доки немає каталогу;
    - `readings.js` — обгортка над наявним `review/caseSources.js` (web_search_preview + verifyUrl);
    - `orchestrator.js`.
  - `services/ai/tools/` (`definitions.js`, `handlers.js`, `runner.js`).
  - `services/ai/parse/` (`extractSlots.js`, `toState.js`, `policyMatch.js`).
  - `services/document/writers/templateDocx.js` на бібліотеці `docx` (вона вже в залежностях, `extractors/pdfToDocx.js` показує патерн).
- **Переписуємо:**
  - `services/ai/orchestrator.js`: parse → checks → reviewer.
  - `analysisRunner.js`: етапи `extract | parse | checks | review | done`; lease лишається.
  - `chat/decisions.js`, `chat/view.js`, `chat/flow.js` (наступний крок = верхній issue, інакше питання інтерв'юера), `chat/freeChat.js` (хід оркестратора), `chat/state.js` (без submitted і docVersion).
  - `outputs.js` і `outputFormats.js`: один ключ `syllabus.docx`, кеш за `stateRevision`.
  - `suggestionBuilder.js`; `routes/chat.js`, `routes/syllabus.js`.
- **Видаляємо:**
  - `document/writers/{docx,pptx,pdfAnnotations}.js`, `pdfMapping.js`, `preview.js`, `extractors/pptx.js`, `pptxXml.js`, `extractors/pdfToDocx.js`;
  - `apply.js` разом із `merge3`/`findConflicts` — після переносу `diffBlock`;
  - `convert.toPdf` (лишається `docToDocx`);
  - `chat/slides.js`, `submission.js`, `emailService.sendSubmissionToAdEmail`, cabinet `resend-submission`;
  - `syllabusCleanup.releaseStuckSubmits` / `sweepOldPdfs`;
  - `review/{diagnose,verify,rewrite,checks}.js`, `rubric/standardClauses.js`;
  - `services/ai/constants.js` — після переносу в БД;
  - залежності `@cantoo/pdf-lib`, `node-diff3`;
  - фронт: `SubmitDialog`, `SubmissionCta`, `SlidesSection`, `ConflictDialog`, `DocumentPreviewDialog`, `utils/download.js` (перелік із 6 форматів).
  - **Тести:** видалити або обрізати `wave5.test.js` (лишити кейс «pptx → 400»), `document/{pptx,pdfToDocx,writer,apply}.test.js`, `review/{rewrite,pipeline,degradation,checks}.test.js`, `fixtures/pptx/`. Переписати `chat.test.js` і розділи analyze у `syllabus.test.js`. `eval/` переорієнтувати на точність парсингу й перевірок.

### Чат з інструментами (`services/ai/tools/runner.js`)

1. Виклик `createResponse({ input, tools: [function…, strict], parallel_tool_calls: false })`. `client.js` уже прокидає параметри, нового клієнта не робимо.
2. Цикл `function_call` → handler → `function_call_output`: максимум 6 кроків і не більше одного запису стану за хід.
3. Web search — лише всередині `readings.js`.

**Правила безпеки в коді (`handlers.js`), не в промпті:**
- `locked` → усі мутуючі інструменти повертають `LOCKED`.
- `set_slot`:
  - тільки для `free`-слотів типу A/C;
  - тільки для скалярів;
  - тільки якщо значення буквально є в останньому повідомленні викладача;
  - для policy, library і E — заборонено.
- `propose_draft(key, text, instruction?)`:
  - створює pending Suggestion;
  - сервер сам сканує чернетку на числа, дати, години й назви в лапках. Усе, чого немає в репліках викладача і в довідниках, потрапляє в `proposed_values`, навіть якщо модель цього не вказала;
  - для політик потрібна `instruction` — підрядок репліки викладача, `source = fixture_edited | instructor_directed`.
- `apply_edit(draftId)`:
  - лише для чернетки, яка очікує підтвердження;
  - усі `proposed_values` мають бути підтверджені;
  - основний шлях — кнопка Confirm (`accept`).
- `run_checks` — читання. `get_slot` — читання; текст документа в tool output позначається як недовірені дані.
- Будь-який запис іде через `store.mutate(expectedRevision)`. На конфлікт — 409 і один повтор.

### Трек 2 — парсинг

1. Extract без змін: `loadDocument` → `blocks` для docx/doc/pdf. pptx на upload → 400.
2. `extractSlots` (патерн `review/structure.js`: `requestJSON` + validate + коригувальний повтор):
   - розширена strict-схема: header, summary, outcomes з `ploCodes` (enum ПРН своєї програми), sessions, individual work, assessments, materials, instructors, `policySegments`;
   - кожен елемент має `blockIds`;
   - текст копіюється дослівно, числа — лише явні, інакше `null`.
3. `toState` — детермінований: `source:'parsed'`, перерахунок E, `baselineState`.
4. **Політики (`policyMatch.js`)** — AI не пише текст і не обирає варіант:
   - LLM лише класифікує `{blockKey, optionKey|null, match}` (strict enum з довідника), далі йде детермінована схожість із варіантами;
   - library-блок: текст викладача зберігається як `parsed`, плюс `candidateOptionKey`. Картка `choice` пропонує «Use option X» або «Keep my text». Блок зараховується лише після явного вибору;
   - locked-блок: завжди текст фікстури; розбіжність → `info`-issue.
5. Ревізор: `render(state)` + результати перевірок → картки з before/after.
6. Окрема картка «N sections need no changes → Approve all» — лише для розділів без issue з пройденими порогами.

### Перевірки (`services/checks`, лише код)

Детерміновані перевірки повертають `[{id, severity, section, path, message, details}]`. Набір — точно за ТЗ §2:
- At a Glance ↔ тіло: Assessment, Contact hours, Self-study, Delivery mode, Term, Instructor.
- Бали:
  - сума ваг = 100 (critical);
  - консистентність ваг: §4 ↔ політики ↔ опис занять (згадки в тексті шукаємо regex);
  - повнота рядка: Weight, Criteria, Deadline.
- Три правила шаблону:
  - кількість компонентів 2/3 за `contactHours <= 30` (critical);
  - participation ≤ 30 (warning + питання про обґрунтування в Criteria);
  - self-study ≈ 2× contact, межі 50–150% (warning).
- Положення та Політика ШІ:
  - critical: альтернативні завдання; поріг 60; дозвіл ШІ без заборон — лише для режимів, що дозволяють ШІ, а звірку компонент ↔ категорія робить LLM у `checks/llm.js`;
  - high: retake (умовно), відвідування;
  - medium: bonus/penalty (умовно), не суперечить обов'язковості контрольних;
  - warning: правила ШІ є в силабусі або `ai_place = assignments`;
  - info: мова uk/en.
- CLO без компонента — warning.
- Покриття PLO: core — щонайменше 1, partial = 0.5 (high); elective — info.
- Дедлайни в межах терму, якщо є дати.

### Readiness

- Формула: `approved_required / required × 100`.
- Розділ затверджено = `complete(state)` (пороги ТЗ §8) **і** `approved:true`.
- Будь-яка мутація розділу знімає `approved`.
- Відхилена порада Readiness не знижує.
- `Conversation.readiness` → `{score, sections{key:{status: empty|draft|approved}}, counts}`.
- Кабінет рахує наживо з `state`.

### Вихід .docx (`writers/templateDocx.js`)

- Порядок: Title → At a Glance (таблиця) → 1 Summary (з матрицею CLO → PLO → компонент) → 2 Instructor (картка) → 3 Schedule (таблиця + Individual work) → 4 Assessment (таблиця + Compensation) → 5 Materials → 6 Policies (+ Academic Integrity + Use of AI).
- Нумерацію ставить генератор.
- Стилі винесені в `templateStyles.js`. Коли надійде брендований шаблон, замінимо стилі або перейдемо на заповнення шаблону через jszip.
- Порожні слоти показуються видимими плейсхолдерами.
- Завантажити можна на будь-якому етапі. Кеш у `uploads/outputs/<id>/syllabus.docx` за `stateRevision`.

### API (контракт `docs/api-v5.md` замість `api-v3.md`)

| Endpoint | Призначення |
|---|---|
| `POST /api/syllabus` | Трек 1: `{title, programId, programCode, courseCode?}` |
| `POST /api/syllabus/upload` | Тепер вимагає `programCode` з `Program.editions` |
| `GET /api/chat/:id` | View: `state`, `revision`, `sections` (статуси для лівої панелі), `issues`, `readiness`, `suggestions`, `messages` |
| `GET /api/chat/:id/document?diff=1` | Права панель: секції з `render`, опційний diff проти `baselineState` |
| `POST /api/chat/:id/policies/:key/choose` | `{optionKey}`; «Write my own» → `{writeOwn:true}` переводить розмову на слот, порожнього поля немає |
| `POST /api/chat/:id/sections/:key/approve`, `DELETE` той самий шлях | Затвердити / зняти затвердження |
| `POST /api/chat/:id/sections/approve-all` | `{approved, skipped[{key, reason}]}` |
| `POST /api/chat/:id/suggestions/:sid/{accept,reject,refine,reopen,answer,values}` | Рішення по картці |
| `POST /api/chat/:id/message` | Хід оркестратора |
| `POST /api/chat/:id/skip` | Пропустити слот |
| `GET /api/chat/:id/outputs/syllabus.docx` | Завантаження (інкрементує `downloads`) |
| `GET /api/references/:programCode/{outcomes,courses,capstone,template}` | Довідники |
| `GET /api/policies?type=syllabus-policy` | Довідник політик |
| `GET/PUT /api/users/profile/lecturer` | Профіль викладача до появи CRM |

- **Видаляємо:** `/submit`, `/slides`, `/document/preview` (старий), `resend-submission`.
- Нові LLM-маршрути додаємо в `LONG_RUNNING_PATHS` у `server.js`.

### Міграції (`scripts/`, idempotent, `--dry-run`, кожна з тестом у `backend/test/`)

- `migrate-v5-policies.js` (етап 2): поля `Policy` + upsert 13 блоків.
- `migrate-v5-references.js`: довідники + `Program.editions`.
- `migrate-v5-state.js`:
  - `programCode` для MBA-силабусів = MBA28 за замовчуванням (параметр `--default-edition`);
  - `submitted` → `in_progress`;
  - `$unset` полів submit, outputs і pdf, видалення файлів outputs;
  - видалення Suggestion з `ops`;
  - `submission-cta` → `text`;
  - `needsRebuild:true`. Такий силабус показує «Rebuild in the new format» (`POST /analyze` = парсинг з `document.blocks`).
  - Pre-v4 legacy лишаються read-only.
  - На проді лише 2 тестові силабуси, тож збереження прийнятих v4-правок не робимо.

### Фронтенд (англійською)

- `ProfessorTutorWorkspace` у три зони:
  - **ліворуч `SyllabusStructurePanel`** замість `SuggestionsList`: розділи зі статусом empty/draft/approved, «4 of 8 sections approved», позначки перевірок, стрибок у розділ;
  - **центр:** чат;
  - **праворуч `LiveDocumentPanel`:** чистий документ, тумблер diff, головна кнопка **Download .docx**.
- Картки в `components/Workspace/suggestions`:
  - `DraftCard` — Before/After, підсвічені `proposed_values`, «Confirm · including 48 hours», «Change the value», Reword, Cancel;
  - `PolicyChoiceCard` — варіанти + «Write my own»;
  - `ApproveAllCard`.
- `EmptyState`: два входи — «Start from scratch» і «I have a draft». Вибір програми + редакції.
- `ThemeContext`: радіуси 12/16/20/pill, три кольори (точні токени — з Layout-референсу Notion).
- Тексти UI переводимо англійською. Ключові рядки виносимо в `frontend/src/strings.js`.
- Прибрати: Submit, PDF/preview, перелік 6 форматів, resend у кабінеті.
- Кабінет: прибрати Submitted, додати Downloads і «100% ready».

---

## Хвилі виконання (агенти Paseo у worktree, етапи ТЗ у дужках)

**W0 — один агент, блокує решту:**
- `docs/api-v5.md`;
- `syllabusState/schema.js` + `slots.js`;
- `utils/jsonSchema.js`;
- фікстури в `backend/fixtures/reference/` + `template.sections.json`;
- порожні route-файли, зареєстровані в `server.js`;
- оновлення CLAUDE.md (правила v5, мова UI англійська).

**W1 — паралельно:**
- **A (ет. 2, першим у календарі):** `Policy` + сід + `migrate-v5-policies` + Documents page. Це прибирає вигадані політики.
- **B (ет. 1):** моделі довідників, `services/references`, `routes/references.js`, `Program.editions`, `programCode` на upload.
- **C (ет. 1, 7):** `syllabusState` store/computed/readiness, `SlotChange`.
- **D (ет. 3):** `services/checks` + тести на JSON-фікстурах стану (включно з Risk Management: participation 35% → warning).
- **E (ет. 4):** `templateDocx` + тести (unzip → XML: таблиці, нумерація 1–6, суми).

**W2 — паралельно:**
- **F (ет. 8):** tools runner/handlers + `propose_draft`/`proposed_values` + промпти formulator, orchestrator, loMapping, readings. Залежить від C.
- **G (ет. 1 — парсер):** `parse/*` + `policyMatch` + `analysisRunner`/`orchestrator`. Залежить від A, B, C. Калібрувати на 4 силабусах із пакета.
- **H (ет. 4, 7):** Suggestion v5, `decisions`/`view`/`flow`, routes, outputs, `migrate-v5-state`, видалення submit/email/PDF.
- **I (ет. 5, 9 — UI):** фронт у три зони на моках (`frontend/src/mocks`) за `api-v5`.

**W3:**
- **J:** видалення мертвого коду й залежностей, чистка тестів, `eval/`.
- **K (ет. 9):** інтерв'юер (трек 1) + `POST /api/syllabus` + skip; I переходить з моків на API.
- **L (ет. 6):** профіль викладача — локальний `User.lecturerProfile` + адаптер CRM-заглушка. Сценарій «Ось ваш профіль. Актуально?» → Так / Оновити.
- **M (ет. 10):** промпт AI-інструментів — каркас за каталогом. Вимкнений, доки каталог порожній.

Кожна хвиля закривається злиттям у гілку v5, `npm test` і `npm run build`. Між хвилями — `/code-review`.

---

## Відкриті питання / вхідні дані (не блокують W0–W1)

1. Від Аліни:
   - брендований шаблон .docx;
   - `*_redesigned.docx` з At a Glance;
   - Layout-референс;
   - переліки `comp_*` / `prereq_*` / `proof_*` / `retake_*` / `improve_*` (поки C-питання);
   - каталог AI in Your Course (етап 10);
   - поля Lecturers CRM (етап 6).
2. Без відповіді ТЗ §12 приймаємо такі дефолти:
   - ECTS: з `ProgramCourse` для core, інакше питаємо;
   - тривалість заняття — обов'язкова: без неї Contact hours порожні, і два правила шаблону не працюють. Позначаємо це info;
   - `themeDraft` імпортуємо, але показуємо лише в промпті мапінгу;
   - `TemplateSection` має `programCode: null` (спільний набір) з можливістю перевизначення на програму;
   - перевірки «теорія/практика» немає.
3. «Дев'ять вимог п. 2.5.2» — перелік потрібен, щоб додати як детерміновані перевірки (окрема задача).
4. Ризики:
   - втрата виходу «той самий файл з правками» — свідома регресія для треку 2; у UI це пояснюємо;
   - парсинг губить форматування оригіналу;
   - латентність багатокрокових tool-ходів (30–60 с) — SSE пізніше;
   - `proposed_values` може пропустити числа, написані словами — сканер покриває й прописні числа.

---

## Верифікація

- `cd backend && npm test` після кожної хвилі.
- Нові юніт-тести:
  - `checks/*` — табличні кейси з ТЗ §2, включно з межами 30 год, 30% і 50/150%;
  - `syllabusState` — mutate/revision/approve-скидання, readiness: відхилена порада не знижує, порожній документ ≠ 100%;
  - `templateDocx` — XML-асерти;
  - `tools/handlers` — locked → LOCKED; `set_slot` на політику → відмова; `apply_edit` без Confirm → відмова; `proposed_values` знаходить «48 hours»;
  - `policyMatch` — без дефолту, Risk Management v.2 → `candidateOptionKey = attendance_std`;
  - міграції `--dry-run` + повторний запуск без змін.
- HTTP-тести (supertest, AI замоканий):
  - трек 2 upload → parse → checks → картки → accept → download .docx;
  - трек 1 create → interviewer → `propose_draft` → confirm;
  - `submit` / `slides` → 404;
  - pptx upload → 400.
- `node -c` для змінених файлів, `cd frontend && npm run build`.
- Наскрізно вручну (`npm run dev` + `npm start`, skill `run`):
  - завантажити `Risk_Management v.2` і EIDA;
  - переконатися, що ліва панель показує статуси, participation 35% дає warning, політики вимагають вибору, а .docx відкривається в Word/LibreOffice з At a Glance і нумерацією 1–6.


---

## Статус виконання (2026-10-28)

| Хвиля | Зміст | Стан |
|---|---|---|
| W0 | Контракт `api-v5`, схема стану, реєстр слотів, фікстури | ✅ |
| W1 | A політики, B довідники, C стан і Readiness, D перевірки, E генератор `.docx` | ✅ |
| W2 | F чат з інструментами, G трек 2, H1 шар чату, H2 маршрути і міграція, I фронтенд у три зони | ✅ |
| Аудит | `docs/AUDIT_W2.md`: 4 major, 14 minor, усі виправлено (W3-FIX) | ✅ |
| W3 | K інтерв'юер треку 1, L профіль викладача, J видалення коду v4 + промпт AI-інструментів, CLAUDE.md | ✅ |

| Доповнення 29.10 | CourseOffering, ролі manager/director, каркас кабінету, Courses & cohorts, PLO coverage, перенесення розділу 2 між силабусами | Частково: PR #10–15 злиті; залишок нижче |

- **Перевірки:** бекенд — 46 наборів, 549 тестів; збірка фронтенду проходить.
- **Ще не зроблено:**
  - калібрування з живим LLM (поточний провайдер — Anthropic Haiku 5.5);
  - візуальна перевірка UI в браузері;
  - вхідні дані, яких бракує (див. CLAUDE.md §8);
  - розгортання з міграціями `migrate-v5-*`.

## Частковий етап станом на 04.11.2026

Злиті матеріали W4: доповнення й прототипи, логотипи, каталог AI in Your Course (57 прикладів), мітки ПРН у фікстурах. Мітки ще не підключені до БД та UI. Незавершені альтернативні гілки W4-A/B/C залишені окремо: їх API й моделі розходяться з новішим `main`.

Залишок: фото акаунта, брендований DOCX з логотипом і фото, завершення Reference Library, відповідність прототипам, перевірка живого Haiku й ручне приймання. Деталі, стан кожного підагента та кроки деплою — `docs/PARTIAL_RELEASE_2026-11-04.md`. Лічильники тестів вище належать попередньому етапу.
