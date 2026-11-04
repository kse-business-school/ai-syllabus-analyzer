# API v5: силабус через діалог

Контракт між бекендом і фронтендом для v5 (ТЗ v2.1 «Силабус через діалог»; план — `docs/V5_PLAN.md`). Замінює `docs/api-v3.md`, коли v5 злито.

- **Мова.** Тексти UI, повідомлення AI в чаті, `message` помилок і зміст силабуса — англійською. Коментарі в коді — українською.
- **Помилки.** Форма `{ message, code?, retryable?, ...details }`, статус береться з `err.statusCode` (`utils/httpError.js`). Кожна помилка `/api/syllabus` і глобальних обробників `server.js` має англійський `message` і `code`: `INVALID_ID`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `ROUTE_NOT_FOUND`, `INVALID_JSON`, `FILE_TOO_LARGE`, `INVALID_UPLOAD`, `BODY_TOO_LARGE`, `RATE_LIMITED`, `REQUEST_TIMEOUT`, `DB_UNAVAILABLE`, `INTERNAL_ERROR` (5xx без внутрішніх деталей).
- **Доступ.** Читання — власник або admin. Мутації — тільки власник (`gateMutate`).
- **Чого більше немає.** Submit, email АД, PDF-виходи, PPTX.

## 1. Стан силабусу (`Syllabus.state`)

Єдине джерело правди. Схема лежить у `backend/services/syllabusState/schema.js` (`stateSchema`, `validateState`), реєстр слотів і пороги повноти — у `backend/services/syllabusState/slots.js`.

### Правила стану

- **Запис.** Стан пишеться лише через `syllabusState/store.mutate(syllabusId, expectedRevision, fn, ctx)`. Це атомарний `findOneAndUpdate({ _id, stateRevision }, { $set: { state }, $inc: { stateRevision: 1 } })`. Розбіжність ревізії → 409 `STATE_CONFLICT { revision }`.
- **Що робить `mutate` на кожен запис.**
  - Перераховує всі E-поля (`syllabusState/computed.js`).
  - Знімає `approved` з розділів, яких торкнулася зміна.
  - Пише `SlotChange { syllabusId, revision, path, before, after, source, suggestionId, by, at }`.
- **Провенанс.** Кожна сутність має `source` (`fixture | fixture_edited | instructor_directed | parsed | ai_draft | computed | crm`) і `evidenceBlockIds` (блоки вхідного файлу; для треку 1 — порожньо).
- **Політики.**
  - `state.policies` завжди містить усі 13 блоків довідника.
  - `locked` — текст фікстури.
  - `library` — `optionKey: null`, доки викладач не обрав. **Дефолту немає.**
  - Блок зараховано, якщо `optionKey` заповнений або `source ∈ {instructor_directed, fixture_edited}` (`slots.policyDecided`).
- **`courseKind`.** `core`, якщо `header.courseCode` або назва курсу є серед `ProgramCourse` свого `programCode`, інакше `elective`. Збіг за назвою допустимий лише як підказка для автоматичної підстановки `courseCode`, і викладач її підтверджує.
- **`header.declared`** (необов'язкове). Значення таблиці At a Glance, розпізнані у вхідному файлі: `{ assessmentTotal, contactHours, selfStudyHours, deliveryMode, term, instructor }` (`term` — текст як у файлі або `{ start, end }` ISO). Для треку 1 — `null` або відсутнє. Тіло з ним не синхронізується; перевірки `glance.*` порівнюють `declared` з тілом.

### Syllabus (нові поля)

| Поле | Значення |
|---|---|
| `programCode` | Редакція програми, напр. `MBA27`, `MBA28`; береться з `Program.editions` |
| `track` | `scratch` або `upload` |
| `state`, `stateRevision` | Стан і його ревізія |
| `baselineState` | Знімок стану після парсингу (трек 2) або створення (трек 1); основа для diff у правій панелі |
| `downloads` | Лічильник завантажень `.docx` (метрика MVP) |
| `needsRebuild` | Силабус v4, ще не перебудований у v5 |
| `plagiarismCheck.similarSyllabi` | Заготовка, `null` |

`status`: `analyzing | in_progress | error`; `submitted` прибрано. Етапи `analysisStage`: `extract | parse | checks | review | done`.

## 2. Довідники (усі за `programCode`; `null` — для всіх програм)

| Модель | Звідки сідиться (`backend/fixtures/reference/`) |
|---|---|
| `TemplateSection { programCode, key, order, docNumber, docTitle, title, required, nature, slotTypes, question, fixtureRef, computeFrom }` | `template.sections.json` |
| `ProgramOutcome { programCode, code, text, themeDraft, order }` | `learning-outcomes.json` |
| `OutcomeMapping { from, to, pairs[{ from, to, change }] }` | `learning-outcomes.json.mapping27to28` |
| `ProgramCourse { programCode, code, uk, en, ects }` | `programme-courses.json` |
| `CapstoneGuide { programCode, version, projectTypes, structure, criteria, deliverables, plagiarismThreshold }` | `capstone.criteria.json` (поки однаковий для MBA27/MBA28) |
| `Policy` з `type: 'syllabus-policy'`: `key`, `order`, `mode`, `blockRequired`, `rationale`, `titleUk`, `options[{ key, label, text }]`, `text` (locked), `libraryVersion` | `policies.library.json`. `content` — markdown з усіма варіантами для сторінки Documents |
| Каталоги `assessment-components`, `prerequisites`, `compensation`, `ai-tools` | Поки порожні stub-и. Відповідні B-слоти деградують до C |

- `Program.editions: [{ code, label }]`. Сід: MBA → MBA27, MBA28.
- Читання довідників — лише через `services/references`, а політик — через `services/references/policies.js`. Сід ідемпотентний, на старті (`services/references/seed.js`).

## 3. Перевірки (`services/checks`)

Чисті синхронні функції: `runChecks(state, refs) → Check[]`.

```js
Check = { id, severity, section, path, message, details, passed }
// severity: critical | high | medium | warning | info
// section: TemplateSection.key
// message: англійською
// passed=false — проблема
```

- Порядок: `severity` (critical → info), далі `TemplateSection.order`.
- М'які LLM-перевірки (`checks/llm.js`) мають ту саму форму, але `source: 'llm'`; кешуються за hash стану.
- `id` унікальний у межах результату: `rule` або `rule:entityId` (базове правило — `details.rule`). Перелік правил — `backend/services/checks/README.md`.

## 4. Readiness

```js
readiness = {
  score,                                  // round(approvedRequired / required × 100)
  sections: { [key]: { status: 'empty'|'draft'|'approved', complete, approved, gaps: [String], checks: { critical, high, other } } },
  counts: { approved, required, pendingSuggestions }
}
```

- Розділ затверджено, коли `complete` (пороги `slots.sectionGaps`) **і** `approved`.
- `empty` — у розділі немає жодного заповненого слота; `draft` — решта.
- Відхилені поради на Readiness не впливають.

## 5. Suggestion v5

```js
{
  _id, syllabusId,
  origin: 'reviewer'|'check'|'orchestrator'|'interviewer', checkId?, criterionId?,
  section, severity,                     // critical|high|medium|warning|info
  kind: 'edit'|'choice'|'question',
  title, description, rationale,
  target: { section, path, entityId? },  // шлях у state, напр. 'summary.shortDescription', 'assessments', 'policy.late'
  draft: {                               // kind=edit
    value,                               // нове значення слота (рядок або об'єкт/масив сутностей)
    source: 'ai_draft'|'instructor_directed', // ai_draft за замовчуванням; явний провенанс прямої вказівки
    template?,                           // текст із плейсхолдерами {{v1}} для proposedValues
    proposedValues: [{ id, label, value, path?, confirmed }],
    basisHash,                           // hash значення слота, від якого будувалась чернетка
  },
  options: [{ id, label, value?, optionKey? }],  // kind=choice (варіант політики, «Keep my text», …)
  question?, answer?,                    // kind=question
  applicable, stale,
  status: 'pending'|'accepted'|'rejected', selectedOptionId,
  decisionReason, rejectTag, decisionHistory[], versions[], sources[], order, promptVersion
}
```

- **Атомарність.** Рішення — атомарний `findOneAndUpdate` з умовою на статус. Причина обов'язкова для critical/high.
- **Версії картки.** Умова рішення також перевіряє `__v`, щоб Reword у польоті не перезаписав щойно підтверджені значення. Попередня чернетка зберігається у `versions` з `action: values|refined|answered`. `acceptedRevision` посилається лише на зміни останнього Confirm; `null` — прийняття без зміни стану, яке не відкочує старі `SlotChange`.
- **`proposedValues`.** Факт (число, поріг, термін, дата, назва), якого не назвав викладач і немає в довіднику, стає `proposedValues` і потребує окремого підтвердження. Сервер сам сканує чернетку й доповнює список.
- **SuggestionView.** Містить `id` (також `_id`, `syllabusId`), `target`, `draft`, `options`, `before` (поточне значення слота) і `after` (значення чернетки), `stale`. Для текстового слота чи політики `before` — текст. `values` перерендерює текст без LLM, зберігаючи числовий тип і повні сутності у списках.
- **Застаріла чернетка.** `accept`, коли hash поточного значення ≠ `basisHash` → 409 `STALE_DRAFT`.

## 6. Ендпоінти

### Силабус (`/api/syllabus`)

| Метод | Шлях | Опис |
|---|---|---|
| POST | `/` | Трек 1. body `{ title, programId, programCode, courseCode? }`. Створює порожній стан і повертає `{ syllabus }` |
| POST | `/upload` | Трек 2. multipart `syllabus` (docx/doc/pdf; pptx → 400 `UNSUPPORTED_FORMAT`) + `courseName` (обов'язкова назва курсу: стає `title` силабусу й початковою `header.courseTitle`; порожня → 400 `VALIDATION_ERROR`), `programId`, `programCode` (має бути в `Program.editions`, інакше 400 `INVALID_PROGRAM_CODE`); необов'язкові `courseCode`, `credits` (1–10), `semester`, `year` (2020–2030). Відповідь 201 `{ message, syllabusId, status: 'analyzing' }` |
| GET | `/:id/status` | `{ status, stage, error }` |
| POST | `/:id/analyze` | Повторний парсинг або перебудова v4 → v5 (`needsRebuild`) |
| PUT | `/:id` | Метадані (лише власник): `title`, `courseName`, `courseCode`, `credits`, `semester`, `year`. Назва (`courseName`, інакше `title`) і `courseCode` пишуться в `state.header` через `store.mutate` (журнал `SlotChange`, зняття `approved`). Зміна `programId`/`programCode` → 400 `PROGRAM_CHANGE_NOT_ALLOWED`; під час аналізу → 409 `ANALYSIS_IN_PROGRESS` |
| DELETE | `/:id` | Видалення силабусу |

### Чат і стан (`/api/chat/:syllabusId`)

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/` | **View**: `{ syllabus: { id, title, status, track, programCode, canMutate, needsRebuild }, state, revision, sections: TemplateSection[], readiness, checks: Check[], suggestions: SuggestionView[], conversation, messages }` |
| POST | `/start` | Привітання: трек 1 — перше питання інтерв'юера; трек 2 — «Here's what I found…» + картка Approve all. Повертає View |
| GET | `/document?diff=0\|1` | Права панель: `{ sections: [{ key, docNumber, title, blocks: [{ kind, text, parts?: [{ type: 'eq'\|'del'\|'ins', text }] }] }] }`. `diff=1` порівнює з `baselineState` |
| POST | `/sections/:key/approve` | Затвердити розділ. 409 `SECTION_INCOMPLETE { gaps }`, якщо пороги не пройдені |
| DELETE | `/sections/:key/approve` | Зняти затвердження |
| POST | `/sections/approve-all` | Гуртове затвердження: лише розділи без відкритих Check/Suggestion і з пройденими порогами. body `{ sections?: [key], expectedRevision? }`: `sections` — лише розділи з картки `approve-all` (без нього — усі; невідомий ключ → 400 `UNKNOWN_SECTION`); блокери рахуються з того самого стану, що затверджується (застаріла ревізія → 409 `STATE_CONFLICT { revision }`). Повертає `{ approved: [key], skipped: [{ key, reason }] }` + View. Відкриті картки м'яких LLM-перевірок (`origin: 'check'`) теж блокують Approve all свого розділу (як і будь-яка pending-картка), хоча на score Readiness не впливають |
| POST | `/policies/:key/choose` | body `{ optionKey }` або `{ writeOwn: true }`. `writeOwn` не відкриває поле, а переводить розмову на слот («Tell me how it should be») |
| POST | `/suggestions/:sid/accept` | Confirm. body `{ optionId?, expectedRevision }`. Непідтверджені `proposedValues` → 409 `UNCONFIRMED_VALUES` |
| POST | `/suggestions/:sid/values` | «Change the value»: body `{ values: [{ id, value, confirmed }] }`; перерендер шаблону без LLM |
| POST | `/suggestions/:sid/reject` | Cancel. body `{ reason?, rejectTag? }` |
| POST | `/suggestions/:sid/refine` | Reword. body `{ feedback }` |
| POST | `/suggestions/:sid/answer` | body `{ answer }` для `kind=question` |
| POST | `/suggestions/:sid/reopen` | Відкат через `SlotChange`; поточне значення ≠ `after` → 409 `REOPEN_CONFLICT` |
| POST | `/message` | body `{ text }` — хід оркестратора з інструментами. Повертає View |
| POST | `/skip` | body `{ slotKey }` — пропустити слот (лишається порожнім і видно ліворуч) |
| GET | `/outputs/syllabus.docx` | Завантажити `.docx` на будь-якому етапі, щойно є стан; збільшує `downloads`. Кеш за `stateRevision`. Стану ще немає: аналіз триває → 409 `ANALYSIS_IN_PROGRESS` (`retryable`), аналіз упав → 409 `ANALYSIS_FAILED`. Фронтенд вмикає кнопку лише за наявності `state` |

Кожна мутація повертає View.

- Чат v4 (`legacy`, `needsRebuild` або немає `state`) доступний лише для читання: `canMutate: false`, `needsRebuild: true`, без v5-карток. Мутація → 409 `NEEDS_REBUILD`; незавершений аналіз → 409 `ANALYSIS_IN_PROGRESS`.
- `expectedRevision`, якщо переданий у Confirm, не замінюється поточною ревізією: конфлікт → 409 `STATE_CONFLICT { revision }`. Для клієнтів без цього поля використовується ревізія, прочитана на початку операції; перевірка `basisHash` залишається обов'язковою.
- `writeOwn: true` зберігає `Conversation.currentSlotKey` і `Conversation.writeOwnPolicyKey` (той самий ключ) і надсилає “Tell me in your own words how this policy should work.” Питання інтерв'юера чи картка `policy-choice` знімають `writeOwnPolicyKey`. Альтернатива `{ keepText: true }` явно залишає текст з файлу (`instructor_directed`, `modified: true`). Потрібна рівно одна дія з `optionKey`, `writeOwn`, `keepText`; locked-політика → 409 `LOCKED`.
- `start` треку scratch: привітання → картка курсу (`kind: text`, `payload.courseCard: true` — показана, не запитана) → питання інтерв'юера (`kind: question`, `payload { slotKey, question, why }`) → перша pending-картка за `order`, якщо є; поки є pending-картка, нового питання немає. `skip` додає ключ у `Conversation.skippedSlots` і (трек 1) лишає в чаті репліку «Skip: …».
- **Інтерв'ю (трек 1).** `nextQuestion({ state, refs, transcript, skipped, preferredSection })` → `{ slotKey, question, why } | null`. Код відбирає лише порожні не пропущені C/D-слоти з `editability: free` у порядку потоку (`services/ai/interviewPlan.js`); модель обирає серед них (enum у strict `json_schema`); збій LLM → шаблонне питання `TemplateSection.question`. Відповідь на питання про курс (`course.description|objectives|outcomes|capstone`) → `formulator.draftFromNarrative` → чотири pending-картки (`origin: interviewer`), у чаті — по одній; решта слотів → `runner.runOrchestratorTurn` з `currentSlotKey`. Після відповіді `Conversation.answeredSlots` закриває слоти (відхилення чернетки не повторює питання). Після підтвердження LO — картки мапінгу PLO (`loMapping.suggestPlo`); політики — картки `policy-choice`, не питання. Реплика «Let's work on <section>» (або «ask me about …») ставить `preferredSection`: наступне питання — про цей розділ. Трек 2 інтерв'юера не використовує.
- Confirm картки `outcomes[id].plo` встановлює `confirmed: true` для всіх зв'язків. `kind: question` → 409 `ANSWER_REQUIRED`; `applicable: false` приймається без зміни стану. Reject critical/high без причини → 400 `REASON_REQUIRED`; відхилена порада Readiness не знижує.
- `/message` передає `currentSlotKey` до runner і надає `deps.acceptSuggestion(id, { expectedRevision, userId })`, прив'язаний до поточного власника та силабусу. Решта залежностей — стандартні. Збій LLM/501 → 503 `retryable: true`; три збої поспіль встановлюють `Conversation.status: error`, успішний хід скидає лічильник.
- Бібліотечна політика з текстом з файлу до вибору показує текст із приміткою “(from your file — choose an option or keep your text)” у документі та `.docx`; без тексту — плейсхолдер.
- Єдиний вихід `syllabus.docx` доступний власнику й admin без вимоги затвердження. Файл `<Course_Title>_syllabus.docx`; кеш у `uploads/outputs/<id>/syllabus.r<stateRevision>.docx`, інвалідується зміною ревізії та після кожного рішення (без видалення файлу активного завантаження). Старі ревізії зберігаються до видалення силабусу для паралельних завантажень. Невідоме або старе ім'я → 404 `OUTPUT_NOT_AVAILABLE`.

### Довідники

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/api/references/programs` | `[{ id, code, name, editions }]` |
| GET | `/api/references/:programCode/template` | `TemplateSection[]` |
| GET | `/api/references/:programCode/outcomes` | `ProgramOutcome[]` |
| GET | `/api/references/:programCode/courses` | `ProgramCourse[]` |
| GET | `/api/references/:programCode/capstone` | `CapstoneGuide` |
| GET | `/api/policies?type=syllabus-policy` | Довідник політик (сторінка Documents) |
| GET/PUT | `/api/users/profile/lecturer` | Профіль викладача до інтеграції Lecturers CRM |

**Профіль викладача (`GET/PUT /api/users/profile/lecturer`, лише власний).** Відповідь `{ profile, source, warnings }` (PUT додає `message` і `crmWriteBack`). `profile`: `{ name, position, email, officeHours, assistants, expertise[], education[], experience[], updatedAt, crmId }`; `source`: `crm` (адаптер `services/lecturers/crm.js`, поки не налаштований) або `instructor_directed` (локальна копія в `User.lecturerProfile`; без неї — ім'я й email акаунта). PUT — часткове оновлення; списки — масиви рядків; `expertise` поза 3–6 дає `warnings`, не помилку; невідоме поле, не рядок/масив, поганий email → 400 `VALIDATION_ERROR`. Профіль префілить `instructors[0]` (трек 1 — перед `initState`; трек 2 — лише якщо у файлі інструктора немає) і створює картку `choice` (`origin: interviewer`, `target.path: instructors[]`): «Yes, it's up to date» / «Update» (або, якщо файл відрізняється від профілю, «Use my profile» / «Keep the details from my file» / «Update»). Варіант з `writeBack: false` не пише в профіль; «Update» (`value: null`) лише ставить `Conversation.currentSlotKey = 'instructor.profile'`. Будь-який Confirm, що змінює `instructors[0]`, оновлює `User.lecturerProfile` і викликає `crm.writeBack` (збій CRM Confirm не скасовує).

**Прибрано:** `POST /chat/:id/submit`, `GET …/slides`, `GET …/document/preview` (v3), `GET …/outputs/{tracked.docx,clean.docx,*.pdf,edited.pptx}`, `POST /cabinet/syllabi/:id/resend-submission`.

## 7. Повідомлення чату

`Message.kind`:
- `text`
- `suggestion` (`relatedSuggestionId`)
- `question` — питання інтерв'юера: `{ slotKey, question, why }`
- `approve-all` — `{ sections: [key] }`
- `policy-choice` — `{ policyKey }`

`submission-cta` прибрано.

`Message.origin` (лише для `role: 'user'`): `instructor` (за замовчуванням) — репліка самого викладача (вільне повідомлення, відгук Reword, відповідь на питання); `server` — репліка, яку сервер пише від його імені після кнопки (`Confirmed: …`, `Cancelled: …`, `Back to: …`, `Skip: …`). Серверні репліки показуються в чаті, але не потрапляють у жоден транскрипт для LLM (інтерв'юер, оркестратор, formulator) і в корпус «відомого» сканера фактів: заголовки карток пише модель.

Двох питань поспіль не буває (код, `flow.postNextStep`): якщо останнє повідомлення — питання AI (`question`/`policy-choice`), на яке викладач нічого не зробив (ні репліки, ні рішення після нього — `Conversation.lastDecisionAt`, ні Skip, ні відповіді), нове питання не ставиться, а попереднє лишається поточним.

## 8. Інструменти оркестратора (`services/ai/tools`)

| Інструмент | Дія | Обмеження в коді |
|---|---|---|
| `get_slot(key)` | Читає поточне значення | Текст документа повертається як недовірені дані |
| `set_slot(key, value)` | Записує відповідь | Лише `free`-слоти типу A/C, скаляр, значення має бути в останній репліці викладача. Число для `header.ects`/`header.totalHours` має стояти поруч (≤ 3 слова) з назвою поля («6 ECTS», «120 hours») або бути короткою відповіддю на питання саме про це поле, інакше `AMBIGUOUS_VALUE` (модель уточнює) |
| `propose_draft(key, text, instruction?)` | Створює pending Suggestion | Для політик `instruction` — дослівна цитата з **останньої** репліки викладача; без цитати — лише якщо розмову переведено на цю політику кнопкою «Write my own» (`currentSlotKey === writeOwnPolicyKey === key`), інакше `POLICY_NEEDS_INSTRUCTION` |
| `apply_edit(draftId)` | Застосовує чернетку | Лише підтверджена чернетка без непідтверджених `proposedValues`, і лише картка, яку зараз показано: `draftId === Conversation.currentSuggestionId` і саме вона — останнє повідомлення AI перед реплікою-підтвердженням. Інакше `NEEDS_CONFIRM` (`reason: not_current_card`): «yes» на «Shall I look for readings?» не застосовує іншу pending-картку |
| `run_checks()` | Повертає Check[] і Readiness | — |

Для `locked`-слотів усі мутуючі інструменти повертають `{ error: 'LOCKED' }`.

Реалізація (`services/ai/tools`): `definitions.js` (strict function tools, `buildTools(state)`), `handlers.js` (правила безпеки в коді), `runner.js` (`runOrchestratorTurn`: ≤ 6 викликів моделі, ≤ 1 запису стану за хід).

| Додатково | Дія |
|---|---|
| `propose_draft(key, text, instruction?, entity_id?, proposed_values[])` | `entity_id` — для `assessment.criteria` і `schedule.additional` |
| `suggest_plo(outcome_ids)` | Картки `outcomes[<id>].plo` через `prompts/loMapping.js` (`confirmed: false`) |
| `suggest_readings(query)` | Картка `materials.recommended[]` через `prompts/readings.js`; лише з перевіреним URL, інакше нічого |

Коди помилок інструментів: `LOCKED`, `UNKNOWN_SLOT`, `SLOT_NOT_WRITABLE`, `NOT_SCALAR`, `USE_PROPOSE_DRAFT`, `AMBIGUOUS_VALUE`, `POLICY_NEEDS_INSTRUCTION`, `SLOT_NOT_DRAFTABLE`, `UNKNOWN_ENTITY`, `UNVERIFIED_URL`, `NEEDS_CONFIRM`, `ONE_WRITE_PER_TURN` та коди `accept` (`STALE_DRAFT` тощо).

`runOrchestratorTurn(ctx)`: `ctx.deps = { mutate(syllabusId, expectedRevision, fn, ctx), getState(syllabusId), createDraftSuggestions(inputs, ctx), runChecks(state, refs), findSuggestion(id), acceptSuggestion(id, { expectedRevision, userId }) }`. Перші п'ять мають дефолти (`store.mutate`, `store.getState`, `draftSuggestions.createDraftSuggestions`, `checks.runChecks`, `Suggestion.findById`); `acceptSuggestion` реалізує сервіс рішень чату, без нього `apply_edit` повертає `NOT_CONFIGURED`.

## 9. Спільні модулі та інтерфейси (W2)

- **`services/ai/facts.js` — серверний сканер фактів.** `scanFacts(text, { known })`, `mergeProposedValues(modelValues, scanned)`, `toTemplate`, `renderTemplate`. Застосовується до **кожної** чернетки моделі; `known` = репліки викладача (лише `origin: instructor`) + тексти довідників + людський текст поточного значення слота (`chat/known.readableText`, без id, `blockIds` і провенансу). Числа рахуються лише як окремі слова: `clo3`, `b0012`, `obj2` чисел не дають.
- **`services/chat/draftSuggestions.js` — створення v5-карток.** `buildDraftSuggestion(input, { syllabusId, state, refs, known })` і `createDraftSuggestions(inputs, ctx)`; `hashValue(value)` дає `basisHash`. Порядок: severity (`SEVERITY_ORDER`) × 100 + `TemplateSection.order`.
  - **URL.** Будь-який URL у `text`/`value` чернетки (Reword, answer, Ревізор, formulator, оркестратор), якого немає в `known` чи в поточному значенні слота і який не перевірений (`sources[]` з `verified: true` — їх заздалегідь перевіряє `readings.js` через `caseSources.verifyUrl`), вирізається синхронно (`caseSources.stripUrls`); поле `url`, що спорожніло, стає `null` (`verified: false`), а до опису картки додається «Source not confirmed: an unverified link was removed from this draft.»
- **`target.path` — конкретний шлях стану.** Приклади: `summary.shortDescription`, `outcomes[]` (увесь масив), `assessments[as1].criteria`, `policies{policy.late}`.
  - Для політик `draft.value` — текст. Accept записує в блок `text`, `source` (`fixture_edited`, якщо був обраний варіант, інакше `instructor_directed`) і `modified: true` (якщо змінено текст довідника).
  - Вибір варіанта — картка `choice` з `options[{ id, label, optionKey }]`.
- **Спільні інтерфейси.** Formulator, runner і interviewer реалізовані. Інші заготовки кидають 501, доки їх не реалізовано:

| Модуль | Функції | Хто реалізує |
|---|---|---|
| `services/ai/prompts/formulator.js` | `draftFromNarrative`, `reword` | F |
| `services/ai/tools/runner.js` | `runOrchestratorTurn` | F |
| `services/ai/parse/index.js` | `parseToState` | G |
| `services/ai/prompts/reviewer.js` | `reviewState` | G |
| `services/ai/prompts/interviewer.js` | `nextQuestion` | K (W3) |

  Маршрути й сервіси чату (H) викликають лише ці сигнатури; у тестах H їх мокає через `jest.mock`.

## 10. Доповнення до ТЗ від 29.10.2026 (хвиля W4)

Джерела: `docs/TZ_ADDENDUM_2026-10-29.md` і прототипи в `docs/design/` (`layout-reference.html`, `instructor-walkthrough.html`, `cabinet.html`). Логотипи лежать у `frontend/public/brand/` і `backend/assets/brand/`.

### 10.1 Ролі

`User.role` ∈ `instructor | manager | director | admin`.
- `admin` — технічний суперкористувач: користувачі, програми, усе інше.
- `manager` і `director` — нові ролі (замість видаленої v4-ролі `manager`).

Права на екрани кабінету:

| Розділ | instructor | manager | director | admin |
|---|---|---|---|---|
| My syllabi, Account settings | ✓ | ✓ | ✓ | ✓ |
| All syllabi | — | ✓ | ✓ | ✓ |
| PLO coverage | — | читання | ✓ | ✓ |
| Courses & cohorts | — | ✓ | ✓ | ✓ |
| Library: course policies, programme outcomes, assessment components | читання | редагування | редагування | редагування |

- Мутації силабуса в чаті, як і раніше, лише для власника.
- Роль призначає адміністратор (`PATCH /cabinet/users/:id`).

### 10.2 Курси й набори (cohorts)

- **`Course`** `{ code (напр. «НД.4», унікальний разом із programmeFamily), title (en), titleUk, ects }`.
- **`CourseOffering`** `{ courseId, programCode (набір: MBA27 | MBA28 | …), type: core|elective|internship|final, lecturerId (User), deadline }` — унікальний `(courseId, programCode)`.
  - Тип курсу в наборі береться з offering.
  - Сід створює offerings core / internship / final з `programme-courses.json` (за кодом: НД → core, ПР → internship, АТ → final).
  - Вибіркові курси додає менеджер.
- **Силабус належить парі курс × набір:** `Syllabus.offeringId`.
  - `programCode`, `header.courseCode` і `courseKind` беруться з offering (core / internship / final → `courseKind: 'core'`, elective → `'elective'`).
  - Силабус без offering (старі дані) працює як раніше.
- **Ендпоінти** (manager, director, admin):
  - `GET/POST/PATCH/DELETE /api/cabinet/courses`;
  - `GET/POST/PATCH/DELETE /api/cabinet/offerings?programCode=`;
  - `GET /api/cabinet/offerings/mine` — offerings, де користувач — `lecturerId` (для входу «Start from scratch»).
- **Коди в матриці:** латинська літера типу: `C` core, `E` elective, `I` internship, `F` final project.

### 10.3 Кабінет

- **Вхід:** аватар у правому куті шапки відкриває меню: my syllabi, all syllabi, library, account settings, перемикач теми, вихід.
- **Ліва навігація згрупована:**
  - **My work:** my syllabi, account settings;
  - **Programme:** all syllabi, PLO coverage, courses & cohorts — лише для ролей із правами;
  - **Library:** course policies, programme outcomes, assessment components.
- **Перемикач набору (cohort):** один на застосунок, у контенті екранів All syllabi, PLO coverage, Programme outcomes.
- **Ендпоінти:**
  - `GET /api/cabinet/syllabi?scope=mine|all&programCode=` повертає рядки: курс, викладач, походження (`uploaded` | `scratch`), стан, readiness, `updatedAt`. `scope=all` — лише manager, director, admin.
  - `GET /api/cabinet/coverage?programCode=` повертає `{ plo: [{ code, label, text }], courses: [{ offeringId, code, letter, title, type, syllabusId|null }], cells: [{ ploCode, offeringId, weight: 1|0.5, cloId, cloText, assessment: [names] }], totals: { [ploCode]: Σ } }`.
    - Дані беруться з `state.outcomes[].plo` силабусів набору: `coverage` full = 1, partial = 0.5.
    - Доступ: director і admin повністю, manager — лише читання.
  - Library:
    - `GET /api/references/:programCode/outcomes` (є);
    - `PATCH /api/cabinet/outcomes/:id` (`label`, manager+) — офіційне `text` лишається українським і не редагується з UI;
    - `GET/PATCH /api/cabinet/assessment-components` — довідник компонентів оцінювання.
    - Довідник компонентів сідиться з шаблону школи: individual assignment, group project, case analysis, presentation, quiz, exam.

### 10.4 Account settings

- `GET/PUT /api/users/account`: `{ photoUrl, firstName, lastName, email, language: 'en', theme: 'light'|'dark'|'system' }`.
- Фото завантажується через `POST /api/users/account/photo` (png / jpg ≤ 2 MB) у `uploads/avatars/`.
- Пароль змінюється наявним маршрутом зміни пароля.
- Роль лише показується.

### 10.5 Розділ 2 силабуса без зовнішніх джерел

- Lecturers CRM не використовується (доповнення §6).
- У новому силабусі автора розділ 2 (`instructors[0]`) підставляється з **попереднього силабуса того самого автора** (останній за `updatedAt`, з непорожнім `instructors[0]`), а якщо такого немає — з `User.lecturerProfile`.
- Викладач лише підтверджує або править: картка «Is it up to date?» уже є.
- Фото викладача (`instructors[].photoUrl`) береться з account settings і йде в `.docx`.

### 10.6 Оформлення за брендбуком

- **Палітра:**
  - `#004641` — основний;
  - `#003632` — глибокий;
  - `#2EC195`, `#60BE98` — акценти;
  - `#94D4C1` — м'ята;
  - `#EDEFEE` — світле тло;
  - `#111112` — чорний;
  - `#62005F` — критичне (`--flag`; на темному тлі `#D79BD4`).
- **Шрифт:** Arial.
- **Радіуси:** 0. Круглими лишаються тільки статусні крапки й кільце вибору.
- **Межі площин:** лінія 1px.
- **Дві теми:** світла (біла шапка, зелений логотип) і темна (`#111112`, білий логотип).
- **Точні токени** — CSS-змінні в `docs/design/layout-reference.html`.
- **`.docx` теж за брендом:** Arial, кольори, логотип KSE Business School у верхньому колонтитулі, фото викладача в картці розділу 2.
