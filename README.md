# KSE AI Syllabus Analyzer

AI-powered MBA syllabus review platform for Kyiv School of Economics. Instructors upload syllabi, the backend reviews them against a rubric built on the KSE MBA template and MBA-27 learning outcomes with OpenAI, and the workspace walks the instructor through concrete edit suggestions one card at a time. The result is the instructor's own document with Word tracked changes.

## Current Capabilities

- Upload DOCX, DOC (converted with LibreOffice) or PDF (text is split into paragraphs and a simple working DOCX is synthesized) syllabi. The original file is kept untouched.
- Parse the document into blocks with stable IDs (`services/document`).
- Review the syllabus against a rubric (KSE template, MBA-27 outcomes, assessment, practice, policies) with OpenAI (`services/ai/review`): deterministic checks → structure → per-group verdicts with evidence → verifier → rewrite into block operations (`replaceBlock` / `insertAfter` / `deleteBlock`).
- Walk through suggestions in chat: Accept / Reject (reason required for critical/high, reason chips) / Refine (comment or merge with already accepted changes) / Answer (for questions) / Reopen (single suggestion, no cascade). Free-text messages are answered, or turned into a Refine of the current card.
- Conflicting edits of the same paragraph are detected (409 `SUGGESTION_CONFLICT`) and can replace the previous suggestion.
- Download the result at any time: `*_tracked.docx` (real Word tracked changes + comments), `*_clean.docx`, `*_tracked.pdf` (LibreOffice).
- Submit to the Academic Director by email with tracked DOCX + PDF and a review report.
- Manage users, programs, syllabi, and resending failed submission emails through the cabinet.

## Tech Stack

- Backend: Node.js, Express, MongoDB/Mongoose, OpenAI Responses API, Nodemailer, jszip + @xmldom/xmldom (DOCX), diff/node-diff3 (word diff, 3-way merge), docx + pdf-parse (PDF → DOCX), LibreOffice (DOC → DOCX, DOCX → PDF).
- Frontend: React 18, React Router v6, MUI 5, Axios, react-markdown with GFM tables.

## Prerequisites

- Node.js 18+
- npm 8+
- MongoDB, local or Atlas
- OpenAI API key
- LibreOffice (`soffice`) for `.doc` uploads and the tracked PDF (`SOFFICE_PATH` if not on PATH)
- Gmail App Password or SMTP credentials if email delivery is needed

## Setup

Install dependencies separately for backend and frontend:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Create `backend/.env` from `backend/example.env` and fill in secrets:

```bash
cd backend
copy example.env .env
# macOS/Linux: cp example.env .env
```

Important backend env vars:

```env
MONGODB_URI=mongodb://localhost:27017/ai-syllabus-analyzer
JWT_SECRET=change_me_strong_password
LLM_PROVIDER=openai          # або anthropic
OPENAI_API_KEY=sk-your-key
ANTHROPIC_API_KEY=sk-ant-your-key
LLM_MODEL=gpt-5.4-mini       # для anthropic: claude-opus-5-5 або claude-sonnet-5-5
LLM_REASONING_EFFORT=medium
LLM_MAX_OUTPUT_TOKENS=12000
FRONTEND_URL=http://localhost:3000
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
```

Email can use either Gmail:

```env
GMAIL_USER=your@gmail.com
GMAIL_PASS=your_app_password
```

or generic SMTP:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=user
SMTP_PASS=password
EMAIL_FROM=KSE AI Analyzer <no-reply@example.com>
```

LibreOffice (DOC conversion, tracked PDF):

```env
SOFFICE_PATH=/usr/bin/soffice
SOFFICE_CONCURRENCY=1
SOFFICE_TIMEOUT_MS=120000
```

## Running Locally

Backend runs on port `5000`:

```bash
cd backend
npm run dev
```

Frontend runs on port `3000` and proxies `/api/*` to `localhost:5000`:

```bash
cd frontend
npm start
```

Stop both common dev ports from the repo root:

```bash
npm run stop-ports
```

## Main Workflow

1. Start MongoDB, backend, and frontend.
2. Log in as the bootstrap admin or an invited instructor.
3. Create or confirm a program with an Academic Director email.
4. Upload a syllabus (DOCX recommended to keep the original formatting).
5. Wait for analysis (`GET /syllabus/:id/status` → `stage`: extract → structure → … → done).
6. Go through the suggestion cards in chat (accept / reject / refine / answer / reopen).
7. Download tracked/clean DOCX or the tracked PDF at any time.
8. Submit: allowed when no suggestion is pending; the Academic Director gets tracked DOCX + PDF and the report.

## Architecture (backend)

- `services/document/`: document model (blocks), DOCX extraction, PDF → DOCX synthesis, op validation, `applyAccepted` (idempotent, always from the original), conflicts, word diff, DOCX writer (clean / tracked), LibreOffice conversions. See its README.
- `services/ai/review/`: rubric review pipeline (`runReview`, `generateSuggestion`). See its README.
- `services/ai/orchestrator.js`: review → suggestion per finding (concurrency 3) → `Suggestion` documents.
- `services/analysisRunner.js`: background analysis with `analysisStage`.
- `services/chat/`: conversation view, card flow, decisions, free chat.
- `services/outputs.js`, `services/submission.js`: final files cache and submission email.
- `services/ai/client.js`: the only LLM wrapper (OpenAI or Anthropic via `LLM_PROVIDER`; Anthropic is translated by `anthropicAdapter.js`). Default model `gpt-5.4-mini`, `reasoning.effort=medium` (`LLM_MODEL`, `LLM_REASONING_EFFORT`, `LLM_MAX_OUTPUT_TOKENS`).

The full API contract for chat/suggestions is in `docs/api-v3.md`.

## Key API Endpoints

All endpoints are under `/api`.

Auth:

- `POST /auth/login`
- `GET /auth/profile`
- `PUT /auth/profile`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/logout`

Syllabus:

- `POST /syllabus/upload`
- `GET /syllabus/:id`
- `PUT /syllabus/:id`
- `DELETE /syllabus/:id`
- `POST /syllabus/:id/analyze`
- `GET /syllabus/:id/download`

Chat review (see `docs/api-v3.md`):

- `GET /chat/:syllabusId`
- `POST /chat/:syllabusId/start`
- `GET /chat/:syllabusId/suggestions/:sid/preview?optionId=`
- `POST /chat/:syllabusId/suggestions/:sid/accept` `{ optionId?, conflictResolution? }`
- `POST /chat/:syllabusId/suggestions/:sid/reject` `{ reason?, rejectTag? }`
- `POST /chat/:syllabusId/suggestions/:sid/refine` `{ feedback?, mergeWithAccepted? }`
- `POST /chat/:syllabusId/suggestions/:sid/answer` `{ answer }`
- `POST /chat/:syllabusId/suggestions/:sid/reopen`
- `POST /chat/:syllabusId/message` `{ text }`
- `GET /chat/:syllabusId/document/preview`
- `GET /chat/:syllabusId/outputs/:name` (`tracked.docx` | `clean.docx` | `tracked.pdf`)
- `POST /chat/:syllabusId/submit`

Cabinet:

- `GET /cabinet/syllabi`
- `GET /cabinet/metrics`
- `POST /cabinet/syllabi/:id/resend-submission`
- user and program management endpoints for admin flows

Policies:

- `GET /policies`
- `POST /policies`
- `PUT /policies/:id`
- `DELETE /policies/:id`
- `POST /policies/:id/acknowledge`

## Roles

- `instructor`: uploads and reviews their own syllabi.
- `admin`: manages users/programs and can view cabinet data.

Chat mutation is owner-only; admins are read-only for chat conversations.

## Development Checks

```bash
cd backend
npm test            # Jest + supertest + mongodb-memory-server (system /usr/bin/mongod)
node -c <changed file>

cd ../frontend
npm run build
```

Data migrations live in `scripts/` (idempotent, `--dry-run`); the latest is `scripts/migrate-v4-suggestions.js` (old syllabi become read-only `legacy`).

## Troubleshooting

- `Syllabus not found` after deleting a syllabus: the workspace should now clear stale local storage and return to the upload greeting. If it persists, clear browser local storage keys beginning with `pt.`.
- Long-running AI routes time out at `AI_REQUEST_TIMEOUT_MS`, default `130000`.
- General request timeout is `REQUEST_TIMEOUT_MS`, default `20000`.
- CORS errors usually mean `FRONTEND_URL` does not match the browser origin.
- Email submission is skipped if neither Gmail nor SMTP is configured.
- `SOFFICE_MISSING` (503) means LibreOffice is not installed or `SOFFICE_PATH` is wrong: `.doc` uploads and the tracked PDF need it (submission still sends the DOCX).
- Old syllabi (before v4) are `legacy`: the chat is read-only; upload the file again to continue.
- Markdown tables in chat require pipe-table syntax with a divider row, for example:

```markdown
| Week | Topic |
| --- | --- |
| 1 | Strategy |
```

## Security Notes

- Never commit real `.env` files or secrets.
- Use a strong `JWT_SECRET`.
- Use HTTPS in production.
- Restrict MongoDB and SMTP credentials by environment.

## License

MIT
