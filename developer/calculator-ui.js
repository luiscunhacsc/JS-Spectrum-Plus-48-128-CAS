/* Spectrum CAS home screen: 32 x 24 ROM characters on the emulator's 256 x 192 canvas. */
window.createSpectrumCalculator = function (options) {
    'use strict';
    const { onClose, screen, palette, getCharacterSet } = options;
    const panel = document.getElementById('calculator');
    const input = document.getElementById('casInput');
    const history = document.getElementById('casHistory');
    const menu = document.getElementById('casMenu');
    const announcement = document.getElementById('casAnnouncement');
    const session = window.SpectrumCAS.createSession();
    const context = screen.getContext('2d');
    const frame = context.createImageData(256, 192);
    const pixels = new Uint32Array(frame.data.buffer);
    const characters = new Uint8Array(32 * 24);
    const attributes = new Uint8Array(32 * 24);
    const entries = [], commands = [];
    const FIRST_ROW = 3, VIEW_ROWS = 16;
    const example = 'integral(sin(x+1),x)';
    let font, content = [], scroll = 0, editorStart = 0;
    let commandIndex = 0, draft = '', showSteps = true, activeMenu = '', selectedItem = 0;
    let menuButtons = [], errorDialog = null, failedResult = null;
    const menus = {
        Tools: [['Clear entry', 'entry'], ['Clear history and ans', 'clear'], ['Syntax and supported rules', 'help'], ['Return to Spectrum menu', 'exit']],
        Algebra: [['Simplify', 'simplify(□)'], ['Expand', 'expand(□)'], ['Factor quadratic', 'factor(□,x)'], ['Solve equation', 'solve(□,x)'], ['Substitute x', 'subst(□,x,1)'], ['Numeric approximation', 'approx(□)']],
        Calc: [['Integrate', 'integral(□,x)'], ['Differentiate', 'diff(□,x)'], ['Integral from 0 to pi', 'integral(□,x,0,pi)'], ['Sine', 'sin(□)'], ['Cosine', 'cos(□)'], ['Natural logarithm', 'ln(□)'], ['Exponential', 'exp(□)'], ['Square root', 'sqrt(□)']],
        Other: [['Worked examples', 'examples'], ['Syntax and supported rules', 'help'], ['Numeric approximation', 'approx(□)']],
        PrgmIO: [['Recall previous answer', 'answer'], ['Clear history and ans', 'clear'], ['Syntax and supported rules', 'help']],
        Examples: [['Substitution: sin(x+1)', example], ['Chain substitution', 'integrate(2*x*cos(x^2),x)'], ['Integration by parts', 'integrate(x*exp(x),x)'], ['Definite integral', 'integrate(sin(x),x,0,pi)'], ['Chain rule', 'diff(sin(x^2),x)'], ['Quadratic equation', 'solve(x^2-5*x+6=0,x)'], ['Expand a polynomial', 'expand((x+1)^3)'], ['Exact fractions', '1/3+1/6']]
    };
    const tabs = [
        { name: 'Tools', col: 0, width: 6 },
        { name: 'Algebra', col: 6, width: 8 },
        { name: 'Calc', col: 14, width: 5 },
        { name: 'Other', col: 19, width: 6 },
        { name: 'PrgmIO', col: 25, width: 7 }
    ];
    function ascii(text) {
        return String(text).replace(/π/g, 'pi').replace(/[×·]/g, '*').replace(/[−–—]/g, '-')
            .replace(/′/g, "'").replace(/[↑↓]/g, '^').replace(/[^\x20-\x7e\n]/g, '?');
    }
    function line(text = '', ink = 0, paper = 7, bright = true, source = null) {
        return { text: ascii(text), ink, paper, bright, source };
    }
    function wrap(text, ink = 0, source = null, width = 32) {
        const lines = [];
        for (let paragraph of ascii(text).split('\n')) {
            if (!paragraph) { lines.push(line('', ink, 7, true, source)); continue; }
            while (paragraph.length > width) {
                const space = paragraph.lastIndexOf(' ', width);
                const end = space > width / 3 ? space : width;
                lines.push(line(paragraph.slice(0, end), ink, 7, true, source));
                paragraph = paragraph.slice(end).replace(/^ +/, '');
            }
            lines.push(line(paragraph, ink, 7, true, source));
        }
        return lines;
    }
    function put(row, col, text, ink = 0, paper = 7, bright = true) {
        const attr = ink | (paper << 3) | (bright ? 64 : 0);
        for (const c of ascii(text)) {
            if (col >= 32) break;
            if (col >= 0 && row >= 0 && row < 24) {
                const at = row * 32 + col;
                characters[at] = c.charCodeAt(0); attributes[at] = attr;
            }
            col++;
        }
    }
    function paint(dialogBottom) {
        if (!font) return;
        for (let row = 0; row < 24; row++) {
            for (let col = 0; col < 32; col++) {
                const at = row * 32 + col, attr = attributes[at];
                const bright = (attr & 64) >> 3;
                const ink = palette[(attr & 7) + bright], paper = palette[((attr >> 3) & 7) + bright];
                const glyph = (characters[at] - 32) * 8;
                for (let y = 0; y < 8; y++) {
                    const bits = font[glyph + y];
                    for (let x = 0; x < 8; x++) pixels[(row * 8 + y) * 256 + col * 8 + x] = bits & (128 >> x) ? ink : paper;
                }
            }
        }
        // Single-pixel rules and boxes, as in the recovered calculator reference.
        function rule(y, from = 0, to = 256) { for (let x = from; x < to; x++) pixels[y * 256 + x] = palette[0]; }
        rule(16); rule(152); rule(182);
        for (const tab of tabs) for (let y = 0; y <= 16; y++) pixels[y * 256 + tab.col * 8] = palette[0];
        if (dialogBottom) {
            rule(64, 24, 232); rule(dialogBottom, 24, 232);
            for (let y = 64; y <= dialogBottom; y++) { pixels[y * 256 + 24] = palette[0]; pixels[y * 256 + 231] = palette[0]; }
        }
        context.putImageData(frame, 0, 0);
    }
    function render() {
        if (panel.hidden || !font) return;
        characters.fill(32); attributes.fill(64 | (7 << 3));
        for (const [i, tab] of tabs.entries()) {
            const selected = activeMenu === tab.name;
            put(0, tab.col, ' '.repeat(tab.width), selected ? 7 : 0, selected ? 0 : 7);
            put(1, tab.col, ' '.repeat(tab.width), selected ? 7 : 0, selected ? 0 : 7);
            put(0, tab.col + 1, 'F' + (i + 1), selected ? 7 : 0, selected ? 0 : 7);
            put(1, tab.col + 1, tab.name, selected ? 7 : 0, selected ? 0 : 7);
        }
        const page = Math.floor(scroll / VIEW_ROWS) + 1, pages = Math.max(1, Math.ceil(content.length / VIEW_ROWS));
        if (activeMenu) {
            put(4, 1, activeMenu.toUpperCase());
            for (const [i, [label]] of menus[activeMenu].entries())
                put(6 + i, 0, `${i + 1} ${label}`.padEnd(32), i === selectedItem ? 7 : 0, i === selectedItem ? 0 : 7);
            put(17, 0, 'ENTER selects. ESC returns.');
        } else {
            for (let row = 0; row < VIEW_ROWS; row++) {
                const item = content[scroll + row];
                if (item) put(FIRST_ROW + row, 0, item.text.padEnd(32), item.ink, item.paper, item.bright);
            }
        }
        const value = ascii(input.value || '');
        const cursor = input.selectionStart ?? value.length, end = input.selectionEnd ?? cursor;
        editorStart = Math.max(0, cursor - 61);
        put(20, 1, value.slice(editorStart, editorStart + 31));
        put(21, 1, value.slice(editorStart + 31, editorStart + 62));
        if (!activeMenu) {
            for (let i = Math.max(cursor, editorStart); i < Math.min(end, editorStart + 62); i++) {
                const local = i - editorStart;
                put(20 + Math.floor(local / 31), 1 + local % 31, value[i] || ' ', 7, 0);
            }
            const local = cursor - editorStart;
            if (cursor === end && local >= 0 && local < 62)
                put(20 + Math.floor(local / 31), 1 + local % 31, value[cursor] || ' ', 7, 0);
        }
        put(23, 0, 'MAIN RAD  F6:STEPS');
        const counter = `${page}/${pages}`;
        put(23, 32 - counter.length, counter);
        let dialogBottom = 0;
        if (errorDialog) {
            const message = wrap(errorDialog, 0, null, 22).slice(0, 4);
            if (wrap(errorDialog, 0, null, 22).length > 4) message[3].text = message[3].text.slice(0, 19) + '...';
            const actionsRow = 12 + message.length;
            for (let row = 8; row <= actionsRow; row++) put(row, 3, ' '.repeat(26));
            put(9, 5, 'Error');
            message.forEach((item, i) => put(11 + i, 5, item.text));
            put(actionsRow, 10, 'ESC   ENTER=OK');
            dialogBottom = (actionsRow + 1) * 8;
        }
        paint(dialogBottom);
    }
    function focus() { if (!panel.hidden) { input.focus(); render(); } }
    function setInput(value) {
        input.value = value;
        input.setSelectionRange?.(value.length, value.length);
        focus();
    }
    function closeMenu() {
        menu.hidden = true; activeMenu = '';
        for (const tab of tabs) document.getElementById('cas' + tab.name).setAttribute('aria-expanded', 'false');
    }
    function rebuildHistory(latest = false) {
        content = []; let latestRow = 0;
        for (const entry of entries) {
            if (content.length) content.push(line());
            latestRow = content.length;
            content.push(...wrap(entry.input, 0, entry.input));
            content.push(...wrap(entry.error ? 'Error: ' + entry.result : ascii(entry.result).padStart(32), 0, entry.input));
            if (entry.help) for (const paragraph of entry.help) content.push(line(), ...wrap(paragraph));
            if (showSteps) for (const [i, s] of entry.steps.entries()) {
                content.push(line(), ...wrap(`${i + 1}. ${s.title}`, 0, entry.input), ...wrap(s.math, 0, entry.input));
                if (s.explanation) content.push(...wrap(s.explanation, 0, entry.input));
            }
            if (entry.result.endsWith('+C')) content.push(line(), ...wrap('C arbitrary; ans omits C.', 0, entry.input));
        }
        history.textContent = content.map(item => item.text).join('\n');
        scroll = Math.min(latest ? latestRow : scroll, Math.max(0, content.length - 1));
        render();
    }
    function showHelp() {
        entries.push({ input: 'Help', result: 'Syntax and supported rules', steps: [], help: [
            'Use + - * / ^, parentheses. 2x means 2*x. Constants: pi, e. Angles are radians.',
            'integral(f,x) or integrate(f,x) gives an antiderivative plus C. ans recalls the expression without C.',
            'Integration: sums, powers, reciprocals; sin/cos/exp/tan/ln/sqrt with numeric affine arguments; matched substitutions; polynomial times sin/cos/exp by parts.',
            'integrate(f,x,a,b) applies bounds on certified continuous intervals. No improper integrals.',
            'diff(f,x), simplify(f), expand(f), solve(equation,x), factor(f,x), subst(f,x,value), approx(f).',
            'solve: numeric linear/quadratic polynomials over the reals. factor: rational quadratics. Functions also include asin, acos, atan, abs.',
            'Results hold where the input and applied rules are defined. Unsupported rules produce an explanation.',
            'F1 Tools. F2 Algebra. F3 Calculus. F4 Other/examples. F5 PrgmIO. F6 Steps. Click the top menu names or use keys 1-9 in a menu.',
            'PgUp/PgDn or mouse wheel: scroll working. Up/Down: command history. Ctrl+Enter: approximate. ESC: clear entry, then return to the Spectrum menu.'
        ] });
        if (entries.length > 50) entries.shift();
        rebuildHistory(true); focus();
    }
    function selectItem(index) {
        const name = activeMenu, item = menus[name]?.[index]; if (!item) return;
        const [, value] = item;
        closeMenu();
        if (name === 'Examples') setInput(value);
        else if (value === 'entry') setInput('');
        else if (value === 'clear') {
            entries.length = 0; commands.length = 0; commandIndex = 0; draft = ''; session.clear(); rebuildHistory(true); focus();
        } else if (value === 'exit') onClose();
        else if (value === 'help') showHelp();
        else if (value === 'examples') openMenu('Examples');
        else if (value === 'answer') setInput('ans');
        else {
            const start = input.selectionStart ?? 0, end = input.selectionEnd ?? input.value.length;
            setInput(value.replace('□', input.value.slice(start, end) || input.value.trim() || 'x'));
        }
    }
    function openMenu(name) {
        if (activeMenu === name) { closeMenu(); focus(); return; }
        closeMenu(); activeMenu = name; selectedItem = 0; menu.innerHTML = ''; menuButtons = [];
        for (const [i, [label]] of menus[name].entries()) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
            button.addEventListener('click', () => selectItem(i));
            button.addEventListener('focus', () => { selectedItem = i; render(); });
            menu.appendChild(button); menuButtons.push(button);
        }
        if (name !== 'Examples') document.getElementById('cas' + name).setAttribute('aria-expanded', 'true');
        menu.hidden = false; menuButtons[0].focus(); render();
    }
    function calculate(numeric = false) {
        const source = input.value.trim(); if (!source) return;
        closeMenu();
        const command = numeric ? `approx(${source})` : source;
        let result;
        try { result = session.run(command); }
        catch (error) { result = { input: command, result: error.message, steps: [], error: true }; }
        if (!result.error) { entries.push(result); if (entries.length > 50) entries.shift(); }
        errorDialog = result.error ? result.result : null;
        failedResult = result.error ? result : null;
        if (commands.at(-1) !== source) commands.push(source);
        if (commands.length > 100) commands.shift();
        commandIndex = commands.length; draft = ''; input.value = result.error ? source : '';
        input.setSelectionRange?.(input.value.length, input.value.length);
        rebuildHistory(!result.error);
        announcement.textContent = result.error ? `Cannot evaluate: ${result.result}` : `Result: ${result.result}`;
        focus(); return result;
    }
    function toggleSteps() {
        showSteps = !showSteps;
        document.getElementById('casSteps').setAttribute('aria-pressed', String(showSteps));
        document.getElementById('casStepState').textContent = showSteps ? 'STEPS ON' : 'STEPS OFF';
        rebuildHistory(true);
    }
    function scrollWorking(delta) {
        scroll = Math.max(0, Math.min(Math.max(0, content.length - 1), scroll + delta)); render();
    }
    function dismissError() {
        errorDialog = null;
        if (failedResult) {
            entries.push(failedResult); if (entries.length > 50) entries.shift();
            failedResult = null; rebuildHistory(true);
        }
        focus();
    }
    function handleKey(e) {
        if (errorDialog) {
            e.preventDefault();
            if (e.key === 'Escape' || e.key === 'Enter') dismissError();
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) {
            if (e.ctrlKey && e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); calculate(true); }
            return;
        }
        const index = ['F1', 'F2', 'F3', 'F4', 'F5'].indexOf(e.key);
        if (index >= 0) { e.preventDefault(); openMenu(tabs[index].name); return; }
        if (e.key === 'F6') { e.preventDefault(); toggleSteps(); return; }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (activeMenu) { closeMenu(); focus(); }
            else if (input.value) setInput('');
            else onClose();
            return;
        }
        if (activeMenu) {
            if (e.key === 'Enter') { e.preventDefault(); selectItem(selectedItem); }
            else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); selectItem(Number(e.key) - 1); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                selectedItem = (selectedItem + (e.key === 'ArrowUp' ? -1 : 1) + menuButtons.length) % menuButtons.length;
                menuButtons[selectedItem].focus(); render();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const names = tabs.map(t => t.name), i = names.indexOf(activeMenu);
                openMenu(names[(i + (e.key === 'ArrowLeft' ? -1 : 1) + names.length) % names.length]);
            }
            return;
        }
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault(); scrollWorking(e.key === 'PageUp' ? -VIEW_ROWS : VIEW_ROWS); return;
        }
        if (document.activeElement !== input) return;
        if (e.key === 'Enter') { e.preventDefault(); calculate(); return; }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        if (commandIndex === commands.length) draft = input.value;
        commandIndex = Math.max(0, Math.min(commands.length, commandIndex + (e.key === 'ArrowUp' ? -1 : 1)));
        setInput(commands[commandIndex] ?? draft);
    }
    function point(event) {
        const rect = screen.getBoundingClientRect();
        return { col: Math.floor((event.clientX - rect.left) * 32 / rect.width), row: Math.floor((event.clientY - rect.top) * 24 / rect.height) };
    }
    screen.addEventListener('pointerdown', e => {
        if (panel.hidden) return;
        e.preventDefault(); e.stopPropagation();
        const { col, row } = point(e);
        if (errorDialog) { dismissError(); return; }
        if (row === 0 || row === 1) {
            const tab = tabs.find(t => col >= t.col && col < t.col + t.width);
            if (tab) openMenu(tab.name);
            return;
        }
        if (activeMenu) { if (row >= 6 && row < 6 + menus[activeMenu].length) selectItem(row - 6); else { closeMenu(); focus(); } return; }
        if (row === 23) { if (col >= 10 && col < 18) toggleSteps(); else scrollWorking(col < 16 ? -VIEW_ROWS : VIEW_ROWS); return; }
        if (row >= FIRST_ROW && row < FIRST_ROW + VIEW_ROWS) {
            const source = content[scroll + row - FIRST_ROW]?.source;
            if (source) { setInput(source); return; }
        }
        if (row === 20 || row === 21) {
            const cursor = Math.max(0, Math.min(input.value.length, editorStart + (row - 20) * 31 + col - 1));
            input.setSelectionRange?.(cursor, cursor);
        }
        focus();
    });
    screen.addEventListener('wheel', e => {
        if (panel.hidden) return;
        e.preventDefault(); if (!activeMenu) scrollWorking(Math.sign(e.deltaY) * 3);
    }, { passive: false });
    for (const type of ['input', 'keyup', 'select', 'focus', 'blur']) input.addEventListener(type, render);
    document.getElementById('casForm').addEventListener('submit', e => { e.preventDefault(); calculate(); });
    document.getElementById('casClose').addEventListener('click', onClose);
    for (const tab of tabs) document.getElementById('cas' + tab.name).addEventListener('click', () => openMenu(tab.name));
    document.getElementById('casSteps').addEventListener('click', toggleSteps);
    rebuildHistory();
    return {
        open() {
            font = getCharacterSet(); panel.hidden = false; closeMenu();
            screen.setAttribute('aria-label', 'Spectrum symbolic calculator, 32 columns by 24 rows');
            if (!entries.length) setInput(example); else focus();
        },
        hide() { closeMenu(); errorDialog = null; failedResult = null; panel.hidden = true; screen.setAttribute('aria-label', 'ZX Spectrum screen'); },
        focus, handleKey, calculate
    };
};
