---
name: Remediation Workspace
description: Precision instrument. A calm, exact work tool on warm-gray canvas where every ID, date and count lines up.
colors:
  canvas: "#F3F2EF"
  surface: "#FFFFFF"
  primary: "#16181D"
  on-primary: "#FFFFFF"
  text: "#16181D"
  text-muted: "#676B72"
  border: "#E3E1DC"
  accent: "#0E7A64"
  accent-tint: "#E7F2EF"
  info: "#2F5BD3"
  info-tint: "#EAF0FC"
  warning: "#B7791F"
  warning-tint: "#FBF3E4"
  error: "#BE402C"
  error-tint: "#FBEDEA"
  neutral-tint: "#EFEEEA"
  border-strong: "#D3D0C9"
  toggle-off: "#928B7B"
  warning-text: "#8A5A12"
  warning-border: "#EFDCB8"
  error-border: "#F1D1CA"
  info-border: "#D3DEF8"
typography:
  display:
    fontFamily: Satoshi
    fontWeight: 700
    fontSize: 2rem
    letterSpacing: -0.01em
  display-mobile:
    fontFamily: Satoshi
    fontWeight: 700
    fontSize: 1.625rem
    letterSpacing: -0.01em
  heading:
    fontFamily: Satoshi
    fontWeight: 700
    fontSize: 1.25rem
    letterSpacing: -0.005em
  body:
    fontFamily: Satoshi
    fontWeight: 400
    fontSize: 0.9375rem
    lineHeight: 1.5
  label:
    fontFamily: Satoshi
    fontWeight: 500
    fontSize: 0.8125rem
    letterSpacing: 0.01em
  title:
    fontFamily: Satoshi
    fontWeight: 700
    fontSize: 1.5rem
    letterSpacing: -0.01em
  subheading:
    fontFamily: Satoshi
    fontWeight: 700
    fontSize: 1rem
  caption-mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 0.75rem
    fontFeature: tnum
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 0.875rem
    fontFeature: tnum
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "#2A2D34"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
  nav-link-active:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent}"
  focus-ring:
    color: "{colors.accent}"
---

# Remediation Workspace

## Overview

**Creative North Star:** Precision instrument. Industrial/utilitarian, refined: data-dense but ordered, premium through exact details (aligned mono data, hairline borders, layered surfaces), never through decoration. It serves the one thing the panel should remember: *made with care, down to the smallest detail*.

**Product context:** Internal multi-tenant tool where managers assign security remediation work, members start and submit it, and managers review it. Peers: Linear, Vercel dashboard, Stripe dashboard, Vanta. Category incumbents (vulnerability managers) are described by users as dated and inconsistent, which is the gap.

**Mode per surface:**
- Login: Operate (one task, no persuasion).
- Inbox: Operate (scan, filter, pick).
- Item form: Operate (enter data safely).
- Item detail: Operate + Read (review a note, act, see history).

**Reference sites:** https://linear.app, https://vercel.com/geist, https://www.vanta.com, https://stripe.com/payments

**Key characteristics:**
- Warm-gray canvas with white working surfaces: depth from layers, not shadows.
- Every ID, date, timestamp and count is set in JetBrains Mono with tabular numbers, so columns align exactly.
- One accent (verdigris) that means "fixed / focused / here". Status colors are quiet tints.
- Split view on desktop: the list stays visible while one item is open.

## Colors

**Strategy:** Restrained. Neutrals plus one accent; status colors appear only inside small badges and the overdue label.

**Light or dark:** Light. The use scene is a security manager at a desk in daylight, and the panel will watch a screen share during a video call, where light surfaces stay legible. Dark mode is not built.

**Meaning:**
- `primary` (graphite) is the solid primary button.
- `accent` (verdigris) is focus rings, the active nav item, links, and the Closed status. It is never used as a large fill.
- Status badges use the tint as background and the full color as text: Open uses `neutral-tint` + `text-muted`, In progress uses `info`, Pending review uses `warning`, Closed uses `accent`.
- `error` (vermilion) is used for overdue dates and errors, always with a word ("Overdue", an error message), never color alone.
- Text on `canvas`, `surface`, every tint and the selected row meets WCAG AA (4.5:1); the values of `text-muted`, `accent` and `error` were darkened slightly to guarantee it. `text-muted` is only for secondary text at 13px or larger.
- `warning-text` is the Pending review badge text (the `warning` hue darkened for 4.5:1 on its tint). `*-border` tokens outline banners. `border-strong` is the hover border. `toggle-off` gives the off switch 3:1 against the canvas.

## Typography

**Satoshi** (Fontshare, ITF Free Font License) is the single UI family: a geometric sans with enough character to avoid the default-template look, and calm enough for dense tables. Weights 400 / 500 / 700. Load from the Fontshare CSS API (`https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap`). Do not commit the font files: the license restricts redistribution.

**JetBrains Mono** (Google Fonts, OFL) is for data only: item IDs (`RW-0142`), dates (`2026-10-18`), timestamps, counts and pagination ranges. Never for sentences: titles, descriptions, completion notes and activity sentences stay in Satoshi; only the activity timestamp is mono.

**Scale:** page title (display) 32px (26px under 640px), item title 24px, section heading 20px, detail section 16px, body 15px, label/table header 13px, mono 14px, character counters 12px mono. Levels differ by size and weight, not weight alone.

**Fallback stack:** `Satoshi, ui-sans-serif, system-ui, sans-serif` and `"JetBrains Mono", ui-monospace, monospace`. The fallback exists for offline loading only.

## Layout

- **Desktop (≥1024px):**
  - Fixed 240px sidebar on the canvas, holding the product name, org name, and **Inbox** with its count in mono. The bottom holds the user name + role and **Sign out with an icon**.
  - No other nav items: the brief has one list view.
  - Main area is a split view. The list pane is about 60%; the detail pane is about 40% and opens when a row is selected (URL `/items/:id`), with Escape to close it.
- **Tablet (640–1023px):** the sidebar collapses to a top bar; the detail opens as its own page.
- **Mobile (<640px):**
  - Top bar with the product name and a menu.
  - Filters collapse into one "Filters" button showing the current values.
  - The table becomes stacked rows: title, then mono due date and status badge.
  - Touch targets are at least 44px.
- **Density:** 4px base grid, 40px table rows, 16px panel padding, 24px between sections.
- **Max width:** 1440px content; forms max 640px.

## Elevation & Depth

Two layers only: `canvas`, and `surface` panels with a 1px `border` and a shadow of `0 1px 2px rgba(22,24,29,0.06)`. Modals (session expired) add `0 8px 24px rgba(22,24,29,0.12)` over a 40% graphite scrim. No glows, no gradients, no blur panels.

## Shapes

Buttons and inputs use `rounded.md` (6px). Panels use `rounded.lg` (8px). Badges use `rounded.sm` (4px). Nested elements use inner radius = outer radius minus the gap. No pills, except the toggle switch track.

## Components

- **Buttons:**
  - Primary is solid graphite; secondary is a white outline.
  - States: hover darkens; focus-visible shows a 2px verdigris ring with a 2px offset; active scales to 0.97 for 100ms; disabled is 50% opacity with no pointer events.
  - Loading keeps the button's width, shows a spinner plus "Saving…", and stays disabled until the request resolves (duplicate-submit protection).
- **Table:**
  - The header row uses label style in `text-muted`.
  - Rows have a hover tint `#FAFAF8`.
  - The selected row uses the `accent-tint` background only, never a colored left border.
  - Each whole row is a link, with keyboard focus visible.
- **Status badge:** tint background, colored text, 4px radius, label style. The text is always the status name.
- **Overdue:** the mono date in `error` followed by the word "Overdue".
- **Filters:** the Status control is a labeled segmented control (All / Open / In progress / Pending review / Closed); Overdue only is a labeled toggle. Both live in the URL query.
- **Inputs:**
  - Label above, 1px border, focus ring in the accent.
  - On error: an `error` border, the message under the field, and `aria-describedby`.
  - Character counters in mono.
- **Banners:** a tint background plus an icon plus text (`warning-tint` for the 409 conflict banner, `error-tint` for failures), with the action as a button inside.
- **Activity timeline:** small dots on a hairline; mono timestamp, then the sentence in Satoshi.
- **Empty state:** a short heading, one line of help, and one action. Filtered: "No items match these filters" + Clear filters. Unfiltered: member "Nothing assigned to you" (no action); manager "No remediation items yet" + New item. No illustration.
- **Loading:** first load shows 8 skeleton rows at 40px; on filter/page change the current rows stay at 0.5 opacity until data arrives.
- **Load error:** in-panel `error-tint` banner "Couldn't load items. Check your connection and try again." + Try again + "Reference req_…" in mono.
- **Toast:** bottom-right, 4s, `aria-live="polite"`, never steals focus; used for successful actions ("Approved. RW-0142 is now Closed.").
- **Request changes:** the button reveals an inline "Reason for changes" textarea in the review panel with Send (disabled until non-empty) and Cancel; focus moves into the textarea.
- **Keyboard:** each table row is a link; Tab moves between rows, Enter opens the detail pane, Esc closes it and returns focus to the same row. No arrow-key roving.
- **Dates:** due dates render the API's ISO DATE string (`2026-10-18`) in mono with no timezone conversion; timestamps render `YYYY-MM-DD HH:mm` in the browser's local time.

## Do's and Don'ts

- Do set every ID, date, timestamp and count in JetBrains Mono with tabular numbers.
- Do pair every status or overdue color with its word.
- Do mark the selected row with a background tint.
- Do keep focus-visible rings on every interactive element.
- Do design loading, empty, error, 409 and session-expired states for every screen.
- Don't add nav items for pages the brief doesn't include (My items, Reports, Settings).
- Don't use colored left borders, gradients, glows, or cards inside cards.
- Don't set sentences in mono.
- Don't use the accent as a large fill or as a second button color.
- Don't use system-ui as the primary face.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter `ease-out`, exit `ease-in`, move `ease-in-out`.
- **Duration:** micro 100ms (press), short 150ms (hover, focus, badge and banner appear), medium 200ms (split-view detail pane slide-in).
- **The one authored moment:** the detail pane slides in 8px with an opacity fade when a row is selected, so the list never jumps.
- Respect `prefers-reduced-motion`: no slide, opacity only.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-21 | Initial design system "Precision Instrument" | Based on the brief, research (Linear, Vercel Geist, Vanta, Stripe) and the goal: "made with care, down to the smallest detail" |
| 2026-10-21 | Mockup direction A chosen | Sign out gets an icon |
| 2026-10-21 | Sidebar holds only Inbox + Sign out (with icon) | The brief has one list view; no placeholder pages |
| 2026-10-21 | Mono only for IDs, dates, timestamps and counts | Mockups set sentences in mono, which hurts readability |
| 2026-10-21 | Selected row uses a background tint, not a left border | Colored left borders read as template UI |
| 2026-10-21 | States, toast, inline reason, keyboard model, ISO dates | Design review decisions |
| 2026-10-21 | Contrast-safe tokens; new type steps documented | Audit measured `text-muted` on tints, `accent` on accent-tint and `error` on the selected row just under 4.5:1; the off toggle was 1.4:1. Values shifted minimally; loose CSS colors and sizes became documented tokens |
