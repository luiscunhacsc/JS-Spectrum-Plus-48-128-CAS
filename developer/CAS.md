# Spectrum 128 symbolic calculator — project context

## Recovery and current milestone

On 2026-10-29 the workspace contained a working 48K/128K browser emulator and
its regression suite. No CAS source, previous design notes, or Git repository
was present. This implementation starts from that emulator and the user's
description: choosing Calculator in the 128K menu should open a CAS with a
TI-89-inspired workflow, including worked integration steps.

**Visual requirement:** the user explicitly requires a Spectrum-like screen,
not a modern computer interface. Their lost-progress screenshot is the layout
reference: white pixel display, boxed F1 Tools / F2 Algebra / F3 Calc / F4 Other /
F5 PrgmIO menus, separate history and command areas, an outlined error dialog,
and a MAIN / RAD / F6:STEPS / page-counter status line. The current implementation
draws these directly on the existing 256 × 192 Spectrum canvas with the ROM's
8 × 8 bitmap font and Spectrum colours. Do not replace it with HTML calculator
chrome, an LCD bezel, browser-font text, or a modern on-screen keypad.

The reference expression is implemented:

```text
integrate(sin(x+1),x)
  u = x+1, du = dx
  integral(sin(u)) du = -cos(u)
  substitute back: -cos(x+1)
  derivative check: sin(x+1)
  answer: -cos(x+1)+C
```

## Files and integration

- `cas.js`: dependency-free symbolic engine; browser API
  `SpectrumCAS.createSession().run(source)` and the same CommonJS API for tests.
- `calculator-ui.js`: pixel renderer, history, boxed menus, entry, examples, working.
- `calculator.css`: visually hides the native input and screen-reader controls;
  all visible calculator content is rendered on the Spectrum canvas.
- `js_spectrum.html`: editable emulator source, calculator markup, ROM hook.
- `build_single_html.ps1`: embeds all calculator code/CSS alongside the existing
  emulator, ROMs, images and tapes into `../index.html`.
- `tests/cas.test.cjs`: exact answers, independent numerical derivative checks,
  domain failures, parser limits, and supported algebra.
- `tests/calculator-menu.test.cjs`: real-ROM menu navigation, return/reentry,
  keyboard isolation, reset, model changes, signature guards.
- `tests/calculator-screen.test.cjs`: decodes the actual rendered pixels using
  ROM glyphs; checks the reference layout, menus, paging, input, and error dialog.

The UK 128K ROM dispatches Calculator to ROM 0 address `0x2885`. The frame loop
checks the address, ROM paging, entry bytes, and Calculator label before opening
the host-side CAS. The CPU pauses at that entry while the browser handles CAS
input. Returning uses the ROM's Exit option at `0x281C`; RAM is preserved. Other
ROMs retain their normal behavior unless they match the checked signature.
No ROM bytes are patched. The CAS does not execute on the emulated Z80.

## Supported syntax and scope

Exact rational arithmetic uses BigInt. Decimal literals become exact fractions.
The parser supports unary signs, right-associative powers, implicit multiplication,
parentheses, pi, e, and the previous scalar expression `ans`. It never evaluates
JavaScript. Input length, nesting, exact number sizes, and operation budgets are
bounded to keep unsupported or excessive calculations from hanging the UI.

- `simplify(f)` collects terms and combines integer powers; ordinary expressions
  also receive these simplifications.
- `expand(f)` distributes products and nonnegative integer powers up to 16.
- `factor(f,x)` factors rational quadratics with rational roots.
- `solve(equation,x)` solves linear/quadratic polynomials with numeric coefficients
  over the reals. An expression without `=` is interpreted as equal to zero.
- `diff(f,x)` / `d(f,x)` applies sum, product, power, logarithmic differentiation,
  and chain rules.
- `integral(f,x)` / `integrate(f,x)` returns an antiderivative plus C. Rules include constants,
  sums, constant factors, powers, reciprocals, sin/cos/exp/tan/ln/sqrt, numeric
  affine arguments, derivative-matched substitutions, and polynomial times
  sin/cos/exp by repeated integration by parts.
- `integrate(f,x,a,b)` applies bounds only on intervals whose continuity can be
  certified. Original denominators are checked even if simplification cancels
  a factor. Unsupported/improper integrals are rejected.
- `subst(f,x,value)` substitutes before simplifying so undefined inputs such as
  `subst(x/x,x,0)` remain errors.
- `approx(f)` / `numeric(f)` returns a finite numerical result to 12 significant
  digits. Symbolic constants and trig functions are supported; angles are radians.
- Functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `exp`, `ln` / `log`,
  `sqrt`, `abs`. Real mode only. Results hold where the input and rules are defined.

The GUI has F1 Tools, F2 Algebra, F3 Calc, F4 Other (including worked examples),
F5 PrgmIO, and F6 Steps. Text entry uses a hidden native input for normal editing
and clipboard support; visible input and the block cursor use ROM characters.
Up/Down recalls commands, Page Up/Down or the mouse wheel scrolls the working,
and Ctrl+Enter approximates. The boxed menus accept arrows/Enter, keys 1-9, and
scaled canvas clicks. Errors preserve the expression and show a pixel dialog;
Enter/Esc dismisses it and the complete error is available in the history.
Esc clears the entry, then returns to the Spectrum menu. F1–F6 belong to the CAS
while it is open. Use the display toolbar for large view/fullscreen. History is
in memory for the current page; it is retained on return but not across reloads.

## Deliberate limitations and next work

This is a working foundation, not a full TI-89 or general-purpose CAS. It does not
yet implement general rational integration/partial fractions, trig transformations,
general symbolic solving, systems, matrices, complex mode, plotting, variable
assignment, persistent workspaces, or typeset two-dimensional math. Integration
can require explicit expansion. Unsupported rules return an error rather than a
guessed answer. Domain restrictions are not a complete assumptions system.

Useful next milestones are a broader integration rule set with explicit domain
conditions; two-dimensional math output; matrices and equation systems; plotting;
and saved sessions. Preserve the standalone offline build and real-ROM menu tests.

## Build and check

From the project root on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/build_single_html.ps1
node --test
```

Open `../index.html`, start 128K, choose Calculator, and press Enter. For source
development, serve the `developer/` directory so the emulator can fetch ROM assets.
