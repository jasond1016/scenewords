# Paper Studio typography and navigation

The source of truth is `frontend/src/styles.css`. Typography is shared by the
application and the viewer; viewer-local color tokens remain independent.

## Resolved inconsistencies

- Supporting text used 10px/11px overrides, and operational labels inherited the
  editorial font. Shared roles now separate headings from readable UI text.
- Page, drawer and viewer leading controls ranged from 28px to 48px, with different
  insets. Primary icon controls now share a 44px target and 20px icon box.
- Light captions and caramel-button text did not consistently meet AA contrast;
  caption, accent and CTA text colors now cover normal and hover surfaces.
- Chinese capability labels leaked into English controls and validation. Their
  presentation is localized without changing the capability/request contract.
- At narrow widths or 200% text size, settings rows and asset filters could widen
  the page. Rows now wrap, and dropdown menus stay inside the viewport. Compact
  asset cancellation buttons keep their short labels on one line.

## Type roles

| Role | Token | Default size | Family / weight / leading |
| --- | --- | --- | --- |
| Wordmark | `--text-brand` | 15px | Editorial serif / 500 / 1.4 |
| Page / creation welcome title | `--text-page` | 24–30px, responsive | Editorial serif / 600 / 1.4 |
| Section / panel title | `--text-section` | 16px | Editorial serif for headings, UI sans for chrome / 600 / 1.4 |
| Body / user description | `--text-body` | 14px | UI sans / 400 / 1.65 |
| Button / menu action | `--text-control` | 14px | UI sans / 500 / 1.5 |
| Input / composer | `--text-input` | 16px | UI sans / 400 / 1.65 for multiline text |
| Label / compact action | `--text-label` | 13px | UI sans / 500 / 1.5 |
| Caption / metadata / mobile viewer action | `--text-caption` | 12px | UI sans / 400–500 / inherited readable leading |

Sizes use rem so browser font preferences can enlarge text. Tailwind `text-xs`,
`text-sm` and `text-base` map to caption, body and input respectively. Do not add
10px/11px overrides for supporting text. Reserve Geist Mono for technical values;
do not use it for Chinese prose.

Keep Noto Serif SC and its Chinese serif fallbacks for the brand and editorial
headings. Operational text uses the system UI stack with PingFang SC, Microsoft
YaHei and Noto Sans CJK SC fallbacks. Both stacks remain usable without external
font downloads. Brand tracking is separate from the restrained label tracking;
do not apply wide Latin wordmark spacing to Chinese labels.

Long prose, errors and user-entered titles wrap. Truncation is intentional only
for one-line history/model names or constrained brand/navigation chrome; preserve
their full accessible names. Composer ratio choices wrap into rows rather than
squeezing every ratio into one row.

## Leading controls and safe areas

- `--control-target`: 44px square; `--control-icon`: 20px. The topbar and viewer
  use the same icon box, padding and regular stroke, without changing icon paths.
- `--header-inset`: 12px. Top, left and right tokens take the maximum of this
  inset and the corresponding `safe-area-inset-*`.
- Page headers stay sticky. Their leading control remains **back** or **history**;
  a modal viewer uses **close**, never a navigation arrow with different behavior.
- The header height derives from its safe top inset and control target. The
  creation viewport subtracts that same token instead of a separate fixed 56px.
- Full-screen viewer/reference preview controls use the same viewport anchors.
  Contained dialog headers use consistent internal padding instead of pretending
  to be page navigation. History drawers and subject editors reserve safe areas
  and keep their own scroll regions.
- Focus outlines stay visible; pending/disabled controls keep their geometry.
  Menus and long metadata must not push navigation outside the viewport.

## Contrast and localization

Primary, secondary and caption text must meet WCAG AA normal-text contrast (4.5:1)
on their actual surfaces, including inset and hover surfaces. Focus indicators
need at least 3:1. Retain the caramel CTA fill but use dark readable text in the
light application theme; the warm-gallery viewer retains its own CTA palette.
Do not use the muted decorative border color as a text color.

Form controls have a separate neutral focus palette: `--c-input-focus` is gray
`#666666` in light mode and `#A8A8A8` in dark mode, with a soft three-pixel
`--c-input-focus-halo`. Native inputs, selects and textareas never inherit the
gold action outline. Search and composer inputs place this single treatment on
their containing frame, not on both the input and its frame. Invalid fields keep
their error semantics; disabled fields do not receive a focus treatment. In
forced-colors mode, a two-pixel system-color inset outline replaces the halo so
focus remains visible without adding a second separated frame. CTA and selected
state accents are independent and remain caramel.

Capability catalog metadata is Chinese at source. `localizeDynamicField` localizes
known labels, choices, hints and placeholders at the presentation boundary, including
quick parameters and validation messages. It must not change request keys, option
values, defaults, operation selection or stored drafts. Unknown provider metadata
falls back intact rather than displaying an untranslated i18n key.

## Audit coverage

Check creation empty/session states; assets; subjects and their editor; settings;
history; image/video viewers; details, editing, resize, comparison, menus and
feedback. Include 320/390px phones, landscape, iPad, 1024/1440/1920px desktops,
Chinese/English and both themes. Also check 200% text size, reduced CSS viewport
width for browser zoom, keyboard focus, simulated safe insets and horizontal
overflow. Browser emulation is not a substitute for physical Safari/Android
keyboard and accessibility testing.
