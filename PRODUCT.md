# KSE AI Syllabus Studio — Product Specification

## Overview
KSE AI Syllabus Studio is a purpose-built workspace for Kyiv School of Economics (KSE) faculty and academic directors. It accelerates drafting, standardizing, reviewing, and approving course syllabi according to institutional academic standards and accreditation criteria.

## Target Personas & Roles

### 1. Course Instructor (`instructor`)
- **Primary Goals:**
  - Create or update syllabi for assigned courses quickly and without formatting friction.
  - Align course learning outcomes (CLOs) with programmatic learning outcomes (PLOs).
  - Clarify course-specific AI usage policies (`AI Prohibited`, `AI Permitted with Attribution`, `AI Required & Integrated`).
  - Receive actionable section-by-section suggestions from the AI Assistant.
  - Approve finalized sections and export standardized `.docx` syllabi.

### 2. Academic Director / Administrator (`admin`)
- **Primary Goals:**
  - Monitor syllabus readiness across academic programmes and cohorts.
  - Inspect any syllabus in read-only mode to verify curriculum integrity.
  - Maintain reference libraries (institutional course policies, programme outcomes, assessment structures).
  - Manage user permissions and programme configurations.

---

## Core Workspaces & Flows

### 1. Workspace (`/syllabus/:id`)
- **Three-Panel Layout:**
  - **Left Rail (Structure):** 8 logical syllabus sections with clear approval statuses, quick-jump navigation, and group progress.
  - **Center Panel (AI Assistant):** Conversational chat interface for collaborative drafting, structured suggestion cards, side-by-side diff previews, and clarification flows.
  - **Right Panel (Live Document):** Real-time formatted academic sheet rendering the current state of the syllabus with contextual approve and discuss actions.
- **Readiness Metric:**
  - Standardized `N of 8` grouped readiness calculation ensuring parity across Workspace and Cabinet views.

### 2. Cabinet (`/cabinet`)
- **Syllabi & Curriculum:**
  - `My syllabi`: Instructor's active courses, readiness indicators, last update timestamps, and quick actions.
  - `All syllabi`: Administrative overview of all institution syllabi with cohort and programme filters.
  - `PLO coverage`: Matrix of Course Learning Outcomes mapped against Programme Learning Outcomes with detail inspection.
  - `Courses & cohorts`: Curriculum catalog tracking course syllabus status per academic cohort.
- **Reference Library:**
  - Centrally managed course policies, academic integrity rules, and grading schema.

### 3. Account Settings (`/settings`)
- Consolidated hub for user academic profile, password management, and interface preferences (theme and branding presets).
