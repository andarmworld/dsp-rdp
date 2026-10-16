# DSH RDP design system

## 1. Atmosphere and identity
Preserve the existing DSH utility panel: compact Chinese controls, inherited host light/dark theme, no marketing elements. Remote desktop is the dominant flexible surface.

## 2. Color
Use inherited foreground/background. Tokens: border `#8886`, muted foreground opacity .7, error `#c0392b`, success `#238636`, focus `#2780e3`, selected surface `#2780e314`. Errors are scoped to the action that failed and never imply an unrelated desktop disconnected.

## 3. Typography
Inherit host system font. Panel title 20px/600; normal controls/body 14px; helper/status text 12px. Use visible labels, not only placeholders.

## 4. Spacing and layout
Spacing 4/8/12/16px; radius 6px controls and 8px groups. Panel fills available height with min-height 0 and padding16/gap12. Form wraps responsively with fields min-width140 and address flex1/min-width200; actions remain reachable at375px. Desktop area flex1, min-height320. No horizontal page overflow. At375/768/1280 exercise form, list and desktop states.

## 5. Primitives and states
Labeled field: machine name, login name, password (type=password), address (hostname/IP[:port]). Remember-password checkbox explicitly opts in, default unchecked. Connect submits current values and remembers successful connection history; Add machine saves configuration without requiring a successful connection. Validation is inside form, cleared on edit or successful action. Storage/network failures remain visible and actionable.
Machine list: search by name/address/user, selectable entry, last successful timestamp, clear selected state, explicit edit/delete/disconnect actions as appropriate. Switching retains opened iframes; disconnect explicit. Empty/loading/error states each explain next action. Connection-state labels derive from real Guacamole state, never iframe load.
Toolbar: selected machine, state, independent-window button. Popup joins the exact active session using Guacamole type a; never silently opens a new type c connection when reuse fails. Popup blocker message is actionable. Keep original host page open; close popup only affects that view.

## 6. Motion
No decorative animation. Native focus/hover feedback; respect reduced motion. No canvas overlays impersonating desktops.

## 7. Accessibility, security and evidence
Chinese visible and accessible field/button names. Keyboard controls and readable focus styles. Passwords never in localStorage, URLs, logs or committed artifacts. Server credentials and encryption keys stay outside repository. Real-browser QA at375/768/1280; actual Guacamole session reuse verified by unchanged RDP connection and no password dialog. Original screenshot is bug evidence, not a pixel-clone target. No unrelated host redesign or telemetry/tooling in product flows.
