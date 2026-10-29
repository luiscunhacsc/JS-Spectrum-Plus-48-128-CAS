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
- `tests/cas-advanced.test.cjs`: rational cancellation, partial fractions,
  trigonometric powers/products, symbolic parameters, exact verification,
  persistent domain guards, and interval/pole regressions. Numerical derivative
  checks compare the returned formulas with independently written integrands.
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

- `simplify(f)` collects terms, combines real rational powers, cancels univariate
  rational polynomial factors over Q, combines fractions, extracts numeric square
  factors, and recognizes paired sin²+cos² terms. Ordinary expressions receive
  basic simplification; the full rational normalization is explicit.
- `expand(f)` distributes products and nonnegative integer powers up to 16.
- `factor(f,x)` factors rational quadratics with rational roots.
- `solve(equation,x)` solves linear/quadratic polynomials with numeric coefficients
  over the reals. An expression without `=` is interpreted as equal to zero.
- `diff(f,x)` / `d(f,x)` applies sum, product, power, logarithmic differentiation,
  and chain rules.
- `integral(f,x)` / `integrate(f,x)` returns an antiderivative plus C. Rules include constants,
  sums, constant factors, powers, reciprocals, sin/cos/exp/tan/ln/sqrt, affine
  arguments with numeric or symbolic coefficients, derivative-matched substitutions,
  and polynomial times sin/cos/exp by repeated integration by parts. Trigonometric
  rules include sin/cos powers through 8, products and power reduction, tan²,
  and reciprocal sin²/cos². Rational integration includes polynomial division,
  square-free factorization, exact partial-fraction coefficient solving, and
  repeated linear/quadratic factors through denominator degree 12. Quadratics
  use arctangent or logarithmic primitives according to their discriminant.
- `integrate(f,x,a,b)` applies bounds only on intervals whose continuity can be
  certified. Original denominators are checked even if simplification cancels
  a factor. Unsupported/improper integrals are rejected.
- `subst(f,x,value)` substitutes before simplifying so undefined inputs such as
  `subst(x/x,x,0)` remain errors.
- `verify(F,f,x)` checks dF/dx=f. It returns `Verified` only when an exact symbolic
  residual is zero; otherwise it returns `Not proved`. No numerical sampling is
  used as an identity proof.
- `approx(f)` / `numeric(f)` returns a finite numerical result to 12 significant
  digits. Symbolic constants and trig functions are supported; angles are radians.
- Functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `exp`, `ln` / `log`,
  `sqrt`, `abs`. Real mode only. Results hold where the input and rules are defined.

## Conditions and verification

Evaluation records restrictions before algebra can erase them. For example,
`simplify((x^2-1)/(x-1))` returns `x+1` with `x-1!=0`; `sqrt(x^2)` becomes
`abs(x)`. Conditions appear separately from the optional working. Stored `ans`
retains its conditions, and substitution at an excluded value fails.

Symbolic-parameter formulas state sufficient conditions rather than returning
an unchecked formula for every parameter value. For example:

```text
integral(sin(a*x),x)       -> -cos(a*x)/a+C, a!=0
integral(x^n,x)            -> x^(n+1)/(n+1)+C, x>0 and n+1!=0
subst(integral(x^n,x),n,-1) -> ln(abs(x))+C
```

Substitution into the original problem recomputes exceptional cases. Substitution
into a stored conditional answer must satisfy that answer's conditions. Conditions
are sometimes conservative; this is not a complete assumptions or piecewise-case system.

Every returned antiderivative is differentiated and checked against the input.
The checker uses an independent sparse rational normal form, formal complex
exponentials for real trigonometric identities, and exact algebraic relations for
numeric radicals. A zero numerator establishes equality on the stated domain.
If this check cannot prove the candidate, integration returns an explanation
instead of an unverified result. The API exposes `conditions`, `checks`,
`verification`, and `verified` metadata; a standalone failed `verify` never counts
as a successful check.

Definite integration checks the original expression and retained guards over the
whole interval, including holes inherited through `ans`. Polynomial ranges through
degree two use exact rational endpoints/extrema when available. Other supported
cases use conservative interval bounds and rounding margins; very large trig
arguments or unresolved intervals are rejected. Bounds containing poles and
improper integrals remain unsupported. Bound-variable conditions are discharged
only after interval checks; parameter conditions remain attached to the result.

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
yet implement unrestricted rational factorization, arbitrary trig transformations,
general symbolic solving, systems, matrices, complex mode, plotting, variable
assignment, persistent workspaces, or typeset two-dimensional math. Integration
can require explicit expansion or explicitly factored denominators. Rational
integration requires numeric rational coefficients and factors of degree at most
two; bounded rational-root searches and biquadratic recognition are provided.
Higher irreducible factors, general radical integration, and special functions
are not covered. Symbolic-coefficient rational integration is currently limited
to the affine/substitution rules. Unsupported rules or unproved answers return
an explanation. Domain conditions are not a complete assumptions system.

Useful next milestones are broader factorization/integration and explicit
piecewise parameter cases; two-dimensional math output; matrices and equation
systems; plotting; and saved sessions. Preserve the standalone offline build,
Spectrum pixel interface, exact checks, and real-ROM menu tests.

## Build and check

From the project root on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/build_single_html.ps1
node --test
```

Open `../index.html`, start 128K, choose Calculator, and press Enter. For source
development, serve the `developer/` directory so the emulator can fetch ROM assets.
