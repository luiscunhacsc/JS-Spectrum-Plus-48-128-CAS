const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

async function start() {
    const e = createEmulator(undefined, { audio: true });
    await e.evaluate('loadBuiltInModel("128K")'); e.frames(100); return e;
}
function enterCalculator(e) { e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter'); }

test('the real 128K Calculator menu opens the CAS and returns through the ROM Exit option', async () => {
    const e = await start(); enterCalculator(e);
    assert.equal(e.evaluate('calculatorActive'), true);
    assert.equal(e.evaluate('isRunning'), false);
    assert.equal(e.evaluate('z80.getState().pc'), 0x2885);
    assert.equal(e.evaluate('document.activeElement === document.getElementById("casInput")'), true);
    e.evaluate('writeMemory(0xA000, 123)');
    const result = e.evaluate('calculatorUI.calculate()');
    assert.equal(result.result, '-cos(x+1)+C');
    const pc = e.evaluate('z80.getState().pc'); e.frames(3);
    assert.equal(e.evaluate('z80.getState().pc'), pc, 'CPU stays paused while typing algebra');
    e.click('casClose'); e.frames(100);
    assert.equal(e.evaluate('calculatorActive'), false);
    assert.equal(e.evaluate('readMemory(0xA000)'), 123, 'returning preserves RAM');
    enterCalculator(e);
    assert.equal(e.evaluate('calculatorActive'), true);
    assert.match(e.elements.get('casHistory').textContent, /-cos\(x\+1\)\+C/);
});

test('CAS shortcuts and keyboard input do not leak into the emulator', async () => {
    const e = await start(); enterCalculator(e);
    e.dispatchKey('KeyX', 'keydown');
    assert.equal(e.evaluate('keyboard[0xFEFE]'), 31);
    e.dispatchKey('F3', 'keydown');
    assert.equal(e.evaluate('displayMode'), 'default');
    assert.equal(e.elements.get('casMenu').hidden, false);
    e.dispatchKey('Escape', 'keydown');
    assert.equal(e.elements.get('casMenu').hidden, true);
    e.evaluate('calculatorUI.calculate()');
    e.dispatchKey('ArrowUp', 'keydown');
    assert.equal(e.elements.get('casInput').value, 'integral(sin(x+1),x)');
    e.dispatchKey('ArrowDown', 'keydown');
    assert.equal(e.elements.get('casInput').value, '');
    e.dispatchKey('F6', 'keydown');
    assert.equal(e.elements.get('casStepState').textContent, 'STEPS OFF');
    e.click('btnAudio');
    assert.equal(e.evaluate('document.activeElement === document.getElementById("casInput")'), true);
});

test('reset and switching model dismiss the CAS and restore normal keyboard focus', async () => {
    const e = await start(); enterCalculator(e); e.click('btnReset');
    assert.equal(e.evaluate('calculatorActive'), false);
    assert.equal(e.elements.get('calculator').hidden, true);
    assert.equal(e.elements.get('runState').textContent, '128K / RUNNING');
    e.frames(100); enterCalculator(e);
    await e.evaluate('loadBuiltInModel("48K")');
    assert.equal(e.evaluate('calculatorActive'), false);
    assert.equal(e.evaluate('isRunning'), true);
    assert.equal(e.evaluate('document.activeElement === container'), true);
});

test('the trap is confined to ROM 0 and the supplied Calculator signature', async () => {
    const e = await start();
    assert.equal(e.evaluate('atCalculatorEntry(0x2885)'), true);
    assert.equal(e.evaluate('atCalculatorEntry(0x2884)'), false);
    e.evaluate('pagingLatch |= 16');
    assert.equal(e.evaluate('atCalculatorEntry(0x2885)'), false);
    e.evaluate('pagingLatch &= ~16; romBanks[0][0x2885] ^= 1');
    assert.equal(e.evaluate('atCalculatorEntry(0x2885)'), false);
});
