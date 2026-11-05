# CLAUDE.md

Контекст і правила для роботи з проєктом **KSE AI Syllabus Analyzer** (v5 «Силабус через діалог», ТЗ v2.1).

**Мови:**
- коментарі в коді й повідомлення комітів — українською;
- код та ідентифікатори — англійською;
- UI, повідомлення AI в чаті, `message` помилок API і зміст силабуса — **англійською**;
- промпти LLM — англійською.

**Документи:**
- контракт API — `docs/api-v5.md`;
- план v5 і відповідність ТЗ ↔ код — `docs/V5_PLAN.md`;
- аудит після W2 — `docs/AUDIT_W2.md`;
- доповнення до ТЗ від 29.10.2026 — `docs/TZ_ADDENDUM_2026-10-29.md`, прототипи — `docs/design/*.html` (джерело оформлення і кабінету).

## 0. Інваріанти (порушувати не можна)

- **Джерело правди — `Syllabus.state`** (`services/syllabusState/schema.js`), не файл викладача.
  - Пише його лише `services/syllabusState/store.js` (`mutate` / `initState` / `approve*` / `revertChange`) з умовою на `stateRevision`.
  - Кожен запис перераховує E-поля, знімає `approved` з торкнутих розділів і пише `SlotChange`.
  - Вхідний файл лише розбирається в слоти: `services/document` → blocks → `services/ai/parse`.
- **Реєстр слотів** — `services/syllabusState/slots.js`: тип A–E, `locked|library|free`, пороги повноти (ТЗ §8). Не дублювати ці правила в промптах чи маршрутах.
- **Нічого не прив'язувати до MBA в коді.**
  - Шаблон, ПРН, нормативні курси, Capstone, політики — це дані з `programCode` (`services/references`, фікстури `backend/fixtures/reference/`, ідемпотентний сід).
  - `courseKind` (core/elective) визначається за `programCode` + `courseCode`, ніколи за назвою: спершу призначення `CourseOffering` (`refs.offeringTypes`), без нього — перелік нормативних курсів програми.
- **Перевірки ТЗ §2 — код, не промпт** (`services/checks`, чисті функції).
  - LLM використовується лише в `checks/llm.js` і лише для суджень. Результат іде в чат, а не в Readiness.
  - Покриття ПРН (перевірка `plo.coverage`, матриця кабінету) рахує лише підтверджені зв'язки CLO → PLO (`confirmed: true`).
- **Політики.**
  - Текст береться лише з довідника (`Policy` `type: 'syllabus-policy'`) або за прямою вказівкою викладача.
  - AI ніколи не заповнює політику з власної ініціативи.
  - Library-блоки не мають дефолту.
  - Зміна тексту довідника → `modified: true`, `source: 'fixture_edited'`.
- **Факти від моделі** (числа, пороги, терміни, дати, назви) потрапляють у стан лише через `proposedValues` з окремим підтвердженням.
  - Сервер сам сканує кожну чернетку (`services/ai/facts.js`).
  - «Відомими» вважаються лише репліки самого викладача (`Message.origin: 'instructor'`), а не серверні повідомлення від його імені (`origin: 'server'` — «Confirmed: …», «Skip: …»).
  - Чернетку політики модель пропонує лише з цитатою останньої репліки викладача або після «Write my own» (`Conversation.writeOwnPolicyKey`).
- **Застосування змін.**
  - `apply_edit` ніколи не спрацьовує без явного Confirm поточної картки (`draftId === currentSuggestionId`, і картка — остання репліка AI перед підтвердженням).
  - Для `locked`-слотів і E-полів мутації заборонені.
- **Зовнішні URL** у чернетках допускаються лише перевірені сервером (`caseSources.verifyUrl`) або названі викладачем. Решта вирізаються.
- **Readiness** = затверджені обов'язкові розділи / обов'язкові.
  - Затверджено = пороги `slots.sectionGaps` пройдені **і** `approved`.
  - Відхилена порада Readiness не знижує.
  - Порожній силабус ≠ 100.
- **Вихід** — один `.docx` за шаблоном (`services/document/writers/templateDocx.js`), доступний будь-коли.
  - Submit, email АД, PDF-виходи і PPTX прибрано.
  - На вхід приймаються docx/doc/pdf.

## 1. Призначення

Викладач KSE GBS у діалозі отримує готовий `.docx` силабуса за шаблоном школи. Є два треки, які сходяться в один стан документа:

- **Трек 1 «з нуля».** Інтерв'юер ставить по одному питанню (ціль — близько 8 змістовних питань). З відповідей Формулювальник готує чернетки, а викладач їх підтверджує.
- **Трек 2 «маю чернетку».** Upload docx/doc/pdf → парсер розкладає файл по слотах → детерміновані перевірки + Ревізор формулювань → картки → «Approve all» для розділів без зауважень.

Інтерфейс складається з трьох зон: ліворуч структура розділів (empty / draft / approved), у центрі чат, праворуч живий документ з тумблером Diff і кнопкою **Download .docx**.

## 2. Стек

- **Backend:**
  - Node.js, Express 4, MongoDB/Mongoose, OpenAI Responses API (strict `json_schema` і strict function tools), Nodemailer (лише листи акаунтів), JWT;
  - документи: jszip + @xmldom/xmldom (DOCX), `pdfjs-dist` у worker thread (текст PDF), `docx` (генерація силабуса), `diff` (word diff), LibreOffice `soffice` (лише DOC → DOCX).
- **Frontend:** React 18 (CRA), React Router 6, MUI 5, Axios, react-markdown. Proxy на `http://localhost:5000`. Моки: `REACT_APP_USE_MOCKS=1`, сторінка `/dev/cards`.
- **Тести (backend):** Jest + supertest + mongodb-memory-server (системний `/usr/bin/mongod`).
  - Каталог `backend/test/`, запуск `cd backend && npm test`.
  - LLM завжди мокається, мережі немає.
  - Еталонний стан для тестів — `test/fixtures/state/riskManagement.js`.
- **Пам'ять.** На сервері ≈ 8 ГБ, тож паралельні повні прогони дають хибні таймаути. Підмножини запускати через `npx jest -w 1 <files>`. Перед повним прогоном перевірити, що немає завислих процесів jest.

## 3. Структура

```
backend/
  server.js                 Express: fail-fast env, CORS, rate limits, таймаути (LONG_RUNNING_PATHS), DB-guard, сід (admin, програми, політики, довідники), sweepers
  fixtures/reference/       довідники: programs (програми й набори першого запуску), policies.library (13 блоків), learning-outcomes (ПРН за наборами + mappings), programme-courses, capstone.criteria (programCodes),
                            template.sections, ai-tools (57 прикладів); stub-каталоги assessment-components, prerequisites, compensation
  models/                   User (+lecturerProfile), Program (+editions), Syllabus (state, stateRevision, baselineState, programCode, track),
                            Suggestion (v5: target, draft, proposedValues), Conversation, Message, SlotChange, Policy (+syllabus-policy),
                            TemplateSection, ProgramOutcome, OutcomeMapping, ProgramCourse, CapstoneGuide, ReferenceOverride (довідник набору змінено в кабінеті — сід не чіпає),
                            CourseOffering (курс × набір: type, lecturerId, deadline)
  routes/                   auth, syllabus (create/upload/status/analyze), chat (View, рішення, розділи, політики, документ, outputs), cabinet,
                            users (+profile/lecturer), policies, references
  services/
    syllabusState/          schema, slots (реєстр), empty, computed (E-поля), paths, store (єдиний запис), readiness, render, diff
    checks/                 детерміновані перевірки ТЗ §2 (glance, assessment, workload, regulations, outcomes, plo) + llm.js (судження)
    references/             getRefs(programCode), courseKind, normalizePloCode, seed, editor (ПРН, нормативні курси, Capstone набору з кабінету), policies, fixtureRefs
    programs.js, offerings.js   набори програм (editions, copyFrom) і призначення курс × набір
    ai/
      client.js             єдина обгортка OpenAI (createResponse)
      facts.js              сканер фактів → proposedValues; toTemplate/renderTemplate («Change the value»)
      parse/                трек 2: extractSlots (LLM-витяг), toState, policyMatch (лише кандидат, без вибору), cards
      prompts/              preamble (EDIT_PROTOCOL), interviewer, formulator, reviewer, loMapping, readings, aiTools, orchestrator
      tools/                function calling чату: definitions, handlers (правила безпеки в коді), runner
      interviewPlan.js      порядок і зв'язки питань треку 1
      orchestrator.js       analyzeSyllabus: parse → initState (lease) → checks → картки (перевірки, політики, ревізор, профіль)
      review/               caseSources (веб-пошук + verifyUrl), common (requestJSON)
    chat/                   view, flow (старт, наступний крок, питання), decisions (accept/values/reject/refine/answer/reopen),
                            sections, policies, freeChat, draftSuggestions, slotWrite, known, state
    document/               loadDocument (docx/doc/pdf → blocks), extractors, convert (docToDocx), writers/templateDocx + templateStyles
    plo/                    coverage (матриця покриття ПРН набору, чиста функція)
    lecturers/              profile (CRM → збережений профіль → розділ 2 попереднього силабуса автора), crm (заглушка Lecturers CRM), cards
    outputs.js, outputFormats.js   syllabus.docx (кеш за stateRevision)
    analysisRunner.js, analysisLease.js   фоновий аналіз з lease
    syllabusCleanup.js, emailService.js, userService.js
scripts/                    міграції (idempotent, --dry-run): migrate-v5-policies, migrate-v5-references, migrate-v5-state, migrate-v5-offerings (+ історичні v2–v4)
frontend/src/
  pages/ProfessorTutorWorkspace.js   три зони
  components/Workspace/     SyllabusStructurePanel, LiveDocumentPanel, EmptyState (два входи), messages/*, suggestions/* (DraftCard,
                            PolicyChoiceCard, ApproveAllCard, ChoiceCard, QuestionCard…)
  hooks/useWorkspace.js, services/api.js, strings.js, mocks/chatV5.js, pages/Cabinet/*, components/PolicyReader.js
```

## 4. Потік даних

1. **Створення.**
   - Трек 1 — `POST /api/syllabus`: `createEmptyState` → профіль викладача (A) → `initState`.
   - Трек 2 — `POST /api/syllabus/upload` (поле `syllabus`, `programCode` з `Program.editions`). Далі все йде у фоні (`analysisRunner`, lease).
2. **Аналіз треку 2.** Етапи `extract → parse → checks → review → done`.
   - **parse:** strict-витяг слотів з `blockIds` → `toState` (`source: 'parsed'`) → `initState` з `baselineState` під умовою lease.
   - **Картки:** з перевірок (`origin: 'check'`), вибору політик (`choice` з `candidateOptionKey`, без автовибору), Ревізора (лише вільні розділи), профілю викладача.
3. **Чат.** View: `state`, `revision`, `sections`, `readiness`, `checks`, `suggestions`, `messages`.
   - Картки йдуть по одній за `order`: severity × 100 + `TemplateSection.order`.
   - Рішення: Confirm (`accept`), Change the value (`values`), Cancel (`reject`), Reword (`refine`), `answer`, `reopen` (через `SlotChange`).
   - Вільне повідомлення → `runOrchestratorTurn`: інструменти `get_slot`, `set_slot`, `propose_draft`, `propose_items` (списки: заняття, самостійна робота, оцінювання, компенсація, матеріали), `propose_instructor`, `apply_edit`, `run_checks`, `suggest_plo`, `suggest_readings`, `suggest_ai_tools`.
   - `answer` на картку-питання: політика → `choice`; наратив → формулювальник; решта → хід оркестратора з контекстом картки, чернетка переноситься в саму картку.
   - Трек 1: після кожного кроку — наступне питання інтерв'юера, лише коли немає непоказаних карток з попередньої відповіді.
4. **Розділи.** Approve / unapprove, Approve all (лише розділи без відкритих карток і непройдених перевірок ≥ warning, з пройденими порогами).
5. **Вихід.** `GET /api/chat/:id/outputs/syllabus.docx` будь-коли: `renderSyllabusDocx(state, refs)`, нумерація 1–6 від генератора, `downloads += 1`.

## 5. Бізнес-правила

**Доступ**
- **Чат.**
  - Читання — власник або manager / director / admin (`gateRead`).
  - **Мутації — тільки власник** (`gateMutate`); admin лише читає.
  - v4-силабуси без `state` (`needsRebuild`) лише читаються. Мутації → 409 `NEEDS_REBUILD`, перебудова — через `POST /api/syllabus/:id/analyze`.
- **Силабус.**
  - `GET /:id` і `/status` — власник або manager / director / admin; `delete` — лише власник або admin; `analyze` і `PUT /:id` — лише власник.
  - Пара курс × набір (`CourseOffering`) має один силабус: create/upload знаходять призначення за `offeringId` або `programCode` + `courseCode`; чуже → 403, зайняте → 409 `OFFERING_TAKEN`.
  - `GET /:id` не віддає `state` і шляхи.
- **Cabinet.**
  - Програми, користувачі й cleanup uploads доступні лише admin.
  - За замовчуванням `/cabinet/syllabi` і `/cabinet/metrics` віддають лише власні силабуси; `?scope=all` — manager / director / admin (інакше 403). Readiness рахується наживо зі `state`.
  - `/cabinet/offerings` (призначення курс × набір): читання — manager / director / admin бачать усі, викладач лише свої; запис — manager / director / admin.
  - `/cabinet/plo-coverage?programCode=` (матриця ПРН × курси набору зі `state` силабусів, `services/plo/coverage.js`) і `/cabinet/lecturers` — manager / director / admin.
  - Метрики: `total`, `inProgress`, `downloads`, `ready100`.
- **Адміни.** 409, якщо зміна лишає систему без активного адміна. Видалення програми з силабусами → 409.
- **Роль** береться з БД на кожен запит. Ролі: `instructor`, `manager`, `director`, `admin` (`services/roles.js`). `manager` / `director` бачать усі силабуси (лише читання), призначають курси до наборів (`CourseOffering`) і правлять довідники; мутації в чаті — лише власник.
- **Rate limits:**
  - суворий per-IP на login / forgot / reset (`LOGIN_RATE_LIMIT_*`);
  - загальні per-IP на сайт і на `/api`;
  - per-user `CHAT_MESSAGE_RATE_LIMIT` на `message`, `refine`, `answer`.
- **Policies.**
  - CRUD — admin. Блоки довідника `syllabus-policy` створює лише сід: POST → 400, DELETE → 409 (вимикаються через `isActive`).
  - Адмінська правка ставить `adminModified`, і сід такі блоки не перезаписує.

**Рішення в чаті**
- Кожна зміна статусу Suggestion — атомарний `findOneAndUpdate` з умовою на статус. Повторне рішення → 409 `NOT_PENDING`.
- **`accept`:**
  - непідтверджені `proposedValues` → 409 `UNCONFIRMED_VALUES`;
  - слот змінився з моменту чернетки → 409 `STALE_DRAFT`;
  - `kind=question` → 409 `ANSWER_REQUIRED`;
  - `locked` → 409 `LOCKED`;
  - решта pending на той самий шлях стають `stale`.
- **`reject`:** для critical/high причина обов'язкова (400 `REASON_REQUIRED`), `rejectTag` з enum.
- **`reopen`:** відкат через `SlotChange`. Якщо слот змінено пізніше → 409 `REOPEN_CONFLICT`.
- **Approve:** розділ без пройдених порогів → 409 `SECTION_INCOMPLETE { gaps }`.
- **Збої LLM** → 503 retryable, `consecutiveAiFailures`.

**Файли**
- Upload до 10 MB (`MAX_FILE_SIZE`, 413). Приймаються `.docx`, `.doc`, `.pdf`; вміст має відповідати розширенню. `.pptx` → 400 `UNSUPPORTED_FORMAT`.
- Помилки розбору → `status: 'error'` з англійським `analysisError`.
- Де лежать файли: `uploads/syllabi/` (оригінал), `uploads/outputs/<syllabusId>/syllabus*.docx` (кеш).
- **Фонові задачі:** `analyzing` з простроченим lease → перезапуск (до 2 спроб) або `error`. `cleanup-uploads` не чіпає файли, молодші 10 хв, і файли живих силабусів.

## 6. Правила змін у коді

- **LLM-виклики** — лише через `services/ai/client.js` (`createResponse`), strict `json_schema` або strict function tools.
  - Новий OpenAI-клієнт не створювати.
  - Провайдер — `LLM_PROVIDER` (`openai` | `anthropic`); адаптер Anthropic — `services/ai/anthropicAdapter.js`, виклики лишаються в стилі Responses API.
  - Модель задається `LLM_MODEL` і має починатися з `gpt-` (openai) або `claude-` (anthropic).
  - Текст документа в промптах обгортати `untrusted()` (`prompts/preamble.js`).
- **Кожна чернетка моделі** проходить через `services/chat/draftSuggestions.js` (сканер фактів, вирізання неперевірених URL, `basisHash`). У стан чернетки потрапляють лише через accept.
- **Нові слоти чи розділи** спершу йдуть у `schema.js`, `slots.js` і `template.sections.json`, а вже потім у промпти, перевірки, рендер і `templateDocx`.
- **Нова програма чи новий набір** — лише дані. Правки логіки не потрібні.
  - Набір (MBA29, EMBA25…) додає admin у кабінеті (Programmes → Cohorts) або `PUT /api/cabinet/programs/:id { editions }`; `copyFrom` копіює ПРН, нормативні курси й Capstone з наявного набору.
  - Перший запуск — `fixtures/reference/programs.json`; коди наборів у коді (сід, міграції, фронт) не зашивати, за замовчуванням — найновіший набір програми.
  - ПРН, нормативні курси й Capstone набору правлять manager / director / admin у Library (`PUT /api/references/:programCode/{outcomes|courses|capstone}`); після правки сід цей довідник набору не перезаписує (`ReferenceOverride`).
- **Аналіз:** записи лише з фільтром `ownedAnalysis(id, leaseToken)`; запуск лише через `runAnalysis` / `runAnalysisInBackground`.
- **Помилки:** сервіси кидають `httpError(statusCode, message, { code, retryable, details })`, маршрути віддають через `sendError`. `message` — англійською.
- **Перелік вихідних файлів** — лише `services/outputFormats.js`.
- **Міграції даних** — окремий скрипт у `scripts/` (idempotent, `--dry-run`) з тестом у `backend/test/`.
- **Секрети:** не комітити `.env`, ключі й паролі. Шаблон — `backend/example.env`.
- **Не комітити:** `frontend/build/` і файли з пакета ТЗ (там реальні дані викладачів).
- **Перевірки перед закриттям задачі:** `cd backend && npm test`, `node -c` для змінених backend-файлів, `cd frontend && npm run build`.

## 7. Конфігурація (ключові env)

- **Backend.** Без `MONGODB_URI`, `JWT_SECRET` і ключа активного провайдера (`OPENAI_API_KEY` або `ANTHROPIC_API_KEY`) сервер не стартує.

| Змінна | Значення за замовчуванням / призначення |
|---|---|
| `LLM_PROVIDER` | `openai`; без нього `anthropic`, якщо задано лише `ANTHROPIC_API_KEY` |
| `LLM_MODEL` | `gpt-5.4-mini` (openai), `claude-haiku-5-5` (anthropic) |
| `ANTHROPIC_REFUSAL_FALLBACK` | `1`; `0` вимикає серверний fallback за відмови класифікаторів безпеки |
| `LLM_REASONING_EFFORT` | `medium` |
| `LLM_MAX_OUTPUT_TOKENS` | — |
| `REQUEST_TIMEOUT_MS` | 20000 |
| `AI_REQUEST_TIMEOUT_MS` | 130000 |
| `CHAT_MESSAGE_RATE_LIMIT` | 30 |
| `ANALYSIS_LEASE_MS` | 60000 |
| `PDF_EXTRACT_TIMEOUT_MS` | 120000 |
| `SOFFICE_PATH`, `SOFFICE_CONCURRENCY` (1), `SOFFICE_TIMEOUT_MS` | LibreOffice для `.doc` |
| `CASE_WEB_SEARCH` | `1` — веб-пошук кейсів і рідінгів |
| `LECTURERS_CRM_URL` | зарезервовано, CRM ще не підключено |
| `GMAIL_USER` / `GMAIL_PASS` або `SMTP_*` | листи акаунтів |
| `FRONTEND_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `LOGIN_RATE_LIMIT_*` | — |

- **Frontend:** `REACT_APP_API_URL` (за замовчуванням `http://localhost:5000/api`), `REACT_APP_USE_MOCKS`.
- **Запуск:** `cd backend && npm run dev` (порт 5000), `cd frontend && npm start` (порт 3000).
- **Розгортання v5:** `scripts/migrate-v5-policies.js`, `migrate-v5-references.js`, `migrate-v5-state.js`, `migrate-v5-offerings.js` (спершу з `--dry-run`).

## 8. Відомі прогалини

- **Вхідні матеріали та їхній стан:**
  - брендований шаблон `.docx` — стилі ізольовано в `templateStyles.js`;
  - каталоги `comp_*`, `prereq_*`, `proof_*`, `retake_*`, `improve_*` — відповідні B-слоти поки деградують до питань;
  - каталог «AI in Your Course» вже додано: 57 прикладів, `suggest_ai_tools` працює з нього;
  - Lecturers CRM не потрібна за доповненням §6; використовується збережений профіль або розділ 2 попереднього силабуса;
  - Layout-референс, walkthrough і кабінет уже збережені в `docs/design/`; точну відповідність UI ще не перевірено.
- **Живий LLM не калібровано:** парсер і промпти перевірено лише на моках і детермінованих частинах.
- **PDF:** скани без текстового шару не підтримуються, евристики абзаців pdf.js можуть зливати колонки.
- **Аналіз** після рестарту починається з початку.
- **Метрики:** Submit немає, тож замість «подано через платформу» рахуються `downloads` і `ready100`.
- **Відкриті питання ТЗ §12:** тривалість заняття, «дев'ять вимог п. 2.5.2», `themeDraft`, теорія / практика.
