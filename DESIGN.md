# KSE AI Syllabus Studio — Design System

## Philosophy & Aesthetic Principles
The interface follows a clean, academic, high-density editorial aesthetic tailored for professional academic work:
- **No AI Slop:** Strictly avoid decorative neon glows, gratuitous gradients, and generic AI icons. Use clean, geometric, high-contrast typography and utilitarian surfaces.
- **Data Density & Restraint:** Maximum 4 key data points per summary card. Clear visual hierarchy with a maximum of 2 nested border levels.
- **Accessible Typography & Contrast:** High legibility on dense tables and academic prose; clear diff representation with typographic markers (`+`, `−`) in addition to color.

---

## Typography
System fonts with local fallbacks to avoid external CDN dependencies and latency:
- **Sans-serif (Primary):** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif`
- **Monospace (Code & Diff):** `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### Type Scale
- **H1 (Document / Screen Title):** `20px` (`1.25rem`), font-weight 600, line-height 1.3, letter-spacing `-0.015em`
- **H2 (Section Header / Card Title):** `15px` (`0.9375rem`), font-weight 600, line-height 1.4
- **Body (Prose & Chat):** `14px` (`0.875rem`), font-weight 400, line-height 1.55, max measure `65ch`
- **Meta (Badges, Timestamps, Table Cells):** `12px` (`0.75rem`), font-weight 500, line-height 1.4, tabular numbers

---

## Color Tokens & Surfaces

### Theme Modes
Tokens adapt seamlessly via `html[data-theme="light"]` and `html[data-theme="dark"]`.

#### Light Mode (Default)
- `--bg-canvas`: `#ffffff` (Document canvas and primary panels)
- `--bg-elevated`: `#f7f7f8` (Sidebar, headers, suggestion cards)
- `--bg-subtle`: `#eff1f3` (Row hovers, secondary buttons, active pills)
- `--text-primary`: `#1b1b1e`
- `--text-secondary`: `#5a5d64`
- `--text-muted`: `#8b8e96`
- `--border-subtle`: `#e4e6ea`
- `--border-strong`: `#cfd3da`

#### Dark Mode
- `--bg-canvas`: `#0f1115`
- `--bg-elevated`: `#161920`
- `--bg-subtle`: `#1e222b`
- `--text-primary`: `#f1f3f5`
- `--text-secondary`: `#9ba1ab`
- `--text-muted`: `#686f7a`
- `--border-subtle`: `#262a34`
- `--border-strong`: `#363c4a`

---

## Brand Accents & Semantic States

### Brand Palette Presets
1. **KSE Green Preset (`data-brand="kse-green"` - Brandbook Default):**
   - Primary Accent: `#004641` (Dark forest green)
   - Accent Hover: `#003632`
   - Dark mode contrast equivalent: `#2dd4bf`
2. **KSE Studio Preset (`data-brand="kse-studio"`):**
   - Primary Accent: `#0b57d0`
   - Accent Hover: `#0842a0`

### Semantic Status Colors
- **Approved / Success:** Text `#137333`, Bg `#e6f4ea`, Border `#ceead6` (Dark: Text `#81c995`, Bg `rgba(19, 115, 51, 0.18)`)
- **Needs Review / Warning:** Text `#b06000`, Bg `#fef7e0`, Border `#fde293` (Dark: Text `#fdd663`, Bg `rgba(176, 96, 0, 0.20)`)
- **Attention / Action Required:** Text `#c5221f`, Bg `#fce8e6`, Border `#fad2cf` (Dark: Text `#f28b82`, Bg `rgba(197, 34, 31, 0.20)`)
- **Draft in Chat / Info:** Text `#0b57d0`, Bg `#e8f0fe`, Border `#d2e3fc` (Dark: Text `#8ab4f8`, Bg `rgba(11, 87, 208, 0.20)`)

### Diff Highlighting
- **Deletion:** `--diff-del-bg: #fce8e6`, `--diff-del-fg: #a50e0e`, styled with strikethrough `<s>` and leading `−`
- **Insertion:** `--diff-add-bg: #e6f4ea`, `--diff-add-fg: #0d652d`, styled with underline `<ins>` and leading `+`
