# JS Spectrum

A browser-based ZX Spectrum 48K and 128K emulator.

## Start the emulator

Double-click the launcher for your operating system:

- **Windows:** `Launch-Windows.bat`
- **macOS:** make it executable once with `chmod +x Launch-macOS.command`, then double-click it (if blocked, right-click and choose **Open**).
- **Linux:** make it executable once with `chmod +x Launch-Linux.sh`, then double-click it or run `./Launch-Linux.sh`.

Alternatively, open **`index.html`** directly in a modern browser.

After the emulator opens:

1. Select the **48K** or **128K** model card to start. The selected card shows
   **Running**; selecting it again restarts that model.
2. Audio is on by default and starts when you launch a model. Select **Audio
   on** to mute or unmute it. Browsers require a click before playing sound.
3. To play a tape, select **Load tape**, choose a `.tap` file (or drop one onto
   the tape deck), then type `LOAD ""` and press Enter. **Sample games** opens
   the bundled tape library. On 48K, press **J** for LOAD, then **Shift + P**
   twice for the quotes.
   On 128K, insert the tape, select **Tape Loader** from the Spectrum menu,
   and press Enter. You can also load tapes with `LOAD ""` from BASIC.

The app is a single, self-contained HTML file. The emulator code, both models'
ROMs, model images, keyboard map, and sample tapes are embedded in it; no installation,
server, or additional files are needed to run it.

**Sample games** includes EXOLON, RoboCop, Target: Renegade, Head over Heels,
Cybernoid, and Cybernoid II in the **128K favourites** group. **The NeverEnding
Story (128K)** is a separate music pick. The original sample games are also kept.
These 128K picks select the 128K model when needed; reset before loading a
different game, and press Space if its title screen pauses.
The NeverEnding Story continues automatically from its loading picture to the
credits and theme music; press Space on the credits to enter the adventure.

## Symbolic calculator (128K)

Start the **128K** model, select **Calculator** in the Spectrum menu (Down twice),
and press Enter. The calculator uses the Spectrum's 256 × 192 pixel display,
ROM character set, and black-on-white screen, with the boxed function menus
and command/history areas from the recovered screenshot. Press
Enter again to try the prefilled `integral(sin(x+1),x)` example: the answer is
`-cos(x+1)+C`, with substitution and a derivative check shown step by step.

The calculator runs entirely offline. It supports exact fractions, symbolic
arithmetic, differentiation, a growing set of integration rules, polynomial
expansion, and linear/quadratic equation solving. Rational simplification retains
cancelled denominator restrictions; integration now includes partial fractions,
trigonometric powers/products, and symbolic coefficients. Each returned
antiderivative must pass an exact symbolic derivative identity check.
**F4 / Other → Worked examples**
provides more examples; **F1 / Tools** includes syntax and the supported rules.
**F6 / Steps** toggles the working. Page Up/Down or the mouse wheel scrolls it.
Up/Down recalls previous commands. Both `integral(...)` and `integrate(...)`
are accepted. Use
`ans` for the previous expression result (without the integration constant).
Domain conditions such as `a!=0` stay visible with the steps hidden and are
retained by `ans`. `verify(F,f,x)` checks whether `dF/dx=f`; an unsuccessful check
reports **Not proved**, without claiming mathematical equivalence.
Press **Esc** to clear the entry, then **Esc** again to return to the 128K menu;
history stays available until
the page is reloaded or you clear it.

This is a new CAS implementation, not a complete TI-89 emulation. Unsupported
operations give an explanation. See [developer/CAS.md](developer/CAS.md) for
the implementation context, supported rules, limitations, and next steps.

## Keyboard

- Click the emulator display to focus keyboard input.
- The footer shows **Keyboard connected** when the display has focus. Tab
  moves to the controls, where Enter and Space work normally.
- **F1** toggles the keyboard map.
- **F2** toggles fullscreen.
- **F3** toggles large view.
- PC **arrow keys** act as Spectrum cursor keys (Caps Shift + 5/6/7/8).
- PC **Ctrl** maps to Caps Shift; PC **Shift** maps to Symbol Shift.

## Project files

- `index.html` — ready-to-run emulator.
- `Launch-Windows.bat`, `Launch-macOS.command`, `Launch-Linux.sh` — open the emulator in the default browser. macOS/Linux may require making the launcher executable once.
- `LICENSE` — license and attribution.
- `developer/` — editable source, build script, and source assets for regenerating `index.html`.
- `Screenshots and Video/` — optional demonstrations.

To rebuild the app on Windows, run `developer\build_single_html.ps1` in
PowerShell. It writes the updated standalone `index.html`.

Run regression checks with `node --test`. The bundled EXOLON tape is used for
loading, music, keyboard, and screen-transition checks; set `EXOLON_TAP` to test
a different local copy.

The 128K model includes AY-3-8912 music and sound effects (tone, noise, and
envelope), mixed with the beeper. TAP loading supports the ROM's standard and
alternate loading entry points, including the 128K Tape Loader.
