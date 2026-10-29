const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

async function start() {
    const e = createEmulator(undefined, { strictDom: true });
    await e.evaluate('loadBuiltInModel("128K")'); e.frames(100);
    e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter');
    return e;
}
function enter(e, value) {
    const input = e.elements.get('casInput');
    input.value = value; input.setSelectionRange(value.length, value.length);
    input.dispatchEvent({ type: 'input' });
}
function snapshot(e) { return Buffer.from(e.elements.get('screen').imageData.data); }

// Read the actual output pixels using the ROM glyphs, independently of the UI's
// history/accessibility text. Borders that are not characters decode as '?'.
function screenText(e) {
    const rgba = snapshot(e);
    const font = Buffer.from(e.evaluate('romBanks[1].subarray(0x3D00, 0x4000)'));
    const rows = [];
    for (let row = 0; row < 24; row++) {
        let text = '';
        for (let col = 0; col < 32; col++) {
            const paper = rgba.readUInt32LE((row * 8 * 256 + col * 8) * 4);
            const bitmap = Buffer.alloc(8);
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                const pixel = rgba.readUInt32LE(((row * 8 + y) * 256 + col * 8 + x) * 4);
                if (pixel !== paper) bitmap[y] |= 128 >> x;
            }
            let character = '?';
            for (let c = 32; c <= 126; c++) if (bitmap.equals(font.subarray((c - 32) * 8, (c - 31) * 8))) {
                character = String.fromCharCode(c); break;
            }
            text += character;
        }
        rows.push(text);
    }
    return rows;
}

test('the calculator paints the reference layout onto the native Spectrum bitmap', async () => {
    const e = await start();
    const rgba = snapshot(e), rows = screenText(e);
    assert.equal(rgba.length, 256 * 192 * 4);
    for (let i = 0; i < rgba.length; i += 4)
        assert.ok([0xFF000000, 0xFFFFFFFF].includes(rgba.readUInt32LE(i)), 'reference uses crisp black and bright white pixels');
    assert.match(rows[0], /F1.*F2.*F3.*F4.*F5/);
    for (const label of ['Tools', 'Algebra', 'Calc', 'Other', 'PrgmIO']) assert.ok(rows[1].includes(label), label);
    assert.ok(rows[20].includes('integral(sin(x+1),x)'));
    assert.match(rows[23], /MAIN RAD.*F6:STEPS/);
    // Native eight-pixel ROM F, without browser font rendering or anti-aliasing.
    const glyph = Buffer.from(e.evaluate('romBanks[1].subarray(0x3D00+(70-32)*8,0x3D00+(71-32)*8)'));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
        assert.equal(rgba.readUInt32LE((y * 256 + 8 + x) * 4), glyph[y] & (128 >> x) ? 0xFF000000 : 0xFFFFFFFF);
    e.key('Enter');
    const working = screenText(e).slice(3, 19).join('\n');
    assert.match(working, /-cos\(x\+1\)\+C/);
    assert.match(working, /1\. Substitution/);
    assert.match(working, /4\. Differentiate to check/);
    e.key('F6');
    assert.doesNotMatch(screenText(e).slice(3, 19).join('\n'), /Substitution/);
});

test('boxed menus work through keyboard selection and scaled canvas clicks', async () => {
    const e = await start();
    e.key('F4');
    assert.match(screenText(e).slice(3, 19).join('\n'), /Worked examples/);
    e.key('Digit1');
    assert.match(screenText(e).slice(3, 19).join('\n'), /Integration by parts/);
    e.key('Digit3');
    assert.equal(e.elements.get('casInput').value, 'integrate(x*exp(x),x)');
    e.key('F5');
    assert.match(screenText(e).slice(3, 19).join('\n'), /Recall previous answer/);
    e.key('Escape');
    enter(e, 'x^2');
    const screen = e.elements.get('screen');
    screen.dispatchEvent({ type: 'pointerdown', clientX: 250, clientY: 8, stopPropagation() {} });
    assert.match(screenText(e).slice(3, 19).join('\n'), /Differentiate/);
    e.key('Digit2');
    assert.equal(e.elements.get('casInput').value, 'diff(x^2,x)');
    e.key('Enter');
    assert.match(screenText(e).slice(3, 19).join('\n'), /2\*x/);
    assert.equal(e.evaluate('keyboard[0xFEFE]'), 31);
});

test('working pages and long editable expressions remain readable at native resolution', async () => {
    const e = await start();
    enter(e, 'integral(sin(x)+cos(x)+exp(x)+x^2+x^3,x)'); e.key('Enter');
    const first = snapshot(e);
    e.key('PageDown'); assert.notDeepEqual(snapshot(e), first);
    e.key('PageUp'); assert.deepEqual(snapshot(e), first);
    e.elements.get('screen').dispatchEvent({ type: 'wheel', deltaY: 80 });
    assert.notDeepEqual(snapshot(e), first);
    const longExpression = 'x+'.repeat(100) + 'sin(x+12345)';
    enter(e, longExpression);
    assert.match(screenText(e).slice(20, 22).join(''), /sin\(x\+12345\)/);
    assert.equal(e.elements.get('casInput').value, longExpression);
});

test('errors use a pixel dialog, preserve the expression, and can be dismissed', async () => {
    const e = await start(); e.key('Enter');
    const expression = 'integral(exp(x^2),x)';
    enter(e, expression); e.key('Enter');
    const dialog = screenText(e).slice(8, 18).join('\n');
    assert.match(dialog, /Error/); assert.match(dialog, /ENTER=OK/);
    assert.equal(e.elements.get('casInput').value, expression);
    e.key('Enter');
    assert.match(e.elements.get('casHistory').textContent, /No integration rule/);
    enter(e, '2+2'); e.key('Enter');
    assert.match(screenText(e).slice(3, 19).join('\n'), /4/);
    e.key('Escape');
    assert.equal(e.evaluate('calculatorActive'), false);
});
