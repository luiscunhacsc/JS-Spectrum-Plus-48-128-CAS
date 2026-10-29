const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

const RATE = 44100;
const FRAME_SAMPLES = RATE / 50;
const R = Math.exp(-2 * Math.PI * 20 / RATE);

async function start(model = '128K') {
    const e = createEmulator(undefined, { audio: true });
    await e.evaluate(`loadBuiltInModel('${model}')`);
    return e;
}

function near(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

for (const model of ['48K', '128K']) {
    test(`${model}: the booted idle menu stays exactly silent through delayed frames`, async () => {
        const e = await start(model);
        e.frames(200);
        const result = e.evaluate(`(() => {
            let peak = 0, underruns = 0;
            for (let i = 0; i < 80; i++) {
                audioCtx.currentTime += [0.02, 0.033, 0.07, 0.017, 0.12][i % 5];
                if (nextAudioTime <= audioCtx.currentTime) underruns++;
                loop();
                for (const value of audioCtx.lastBuffer.getChannelData(0)) {
                    peak = Math.max(peak, Math.abs(value));
                }
            }
            return { peak, underruns, running: isRunning };
        })()`);
        assert.equal(result.peak, 0);
        assert.ok(result.underruns > 10, 'Exercise actual gaps in the scheduled buffers');
        assert.equal(result.running, true);
    });
}

for (const [name, beeper, ayVolume, level] of [
    ['inactive chips', 0, 0, 0],
    ['held beeper', 1, 0, 1],
    ['constant AY DACs', 0, 15, 0.5],
    ['combined constant chips', 1, 15, 1.5]
]) {
    test(`${name}: DC decays continuously across buffers and clamps to exact zero`, async () => {
        const e = await start();
        const samples = e.evaluate(`(() => {
            ayChip.reset();
            ayChip.write(7, 63);
            for (let channel = 8; channel <= 10; channel++) ayChip.write(channel, ${ayVolume});
            lastSpeakerState = ${beeper}; ayLog = [];
            const samples = [];
            for (let frame = 0; frame < 12; frame++) {
                processAudioFrame([]);
                samples.push(...audioCtx.lastBuffer.getChannelData(0));
            }
            return samples;
        })()`);
        // A single sustained step has one exponential tail, including at every
        // 20 ms boundary. Per-frame mean removal or history resets cannot pass.
        for (const index of [0, 1, 440, 881, 882, 883, 1764, 3528]) {
            near(samples[index], level * Math.pow(R, index));
        }
        assert.ok(samples.slice(-FRAME_SAMPLES).every(value => value === 0));
        assert.ok(samples.every(value => value === 0 || Math.abs(value) >= 1e-8));
    });
}

test('beeper edges retain unit amplitude and sample timing across frame boundaries', async () => {
    const e = await start('48K');
    const samples = e.evaluate(`(() => {
        const length = getFrameTStates();
        return [
            ...synthesizeAudioFrame([{ t: length / 2, val: 1 }], []),
            ...synthesizeAudioFrame([{ t: length / 4, val: 0 }], [])
        ];
    })()`);
    const on = FRAME_SAMPLES / 2 - 1;
    const off = FRAME_SAMPLES + Math.ceil(FRAME_SAMPLES / 4) - 1;
    for (let i = 0; i < samples.length; i++) {
        const step = samples[i] - R * (i ? samples[i - 1] : 0);
        near(step, i === on ? 1 : i === off ? -1 : 0);
    }
    assert.ok(samples.slice(0, on).every(value => value === 0));
});

test('a sustained audible beeper tone survives DC removal at its original volume', async () => {
    const e = await start('48K');
    const result = e.evaluate(`(() => {
        const events = Array.from({ length: 20 }, (_, i) => ({
            t: i * getFrameTStates() / 20, val: 1 - i % 2
        }));
        let data;
        for (let frame = 0; frame < 20; frame++) data = synthesizeAudioFrame(events, []);
        return { rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length),
            mean: data.reduce((sum, value) => sum + value, 0) / data.length,
            range: Math.max(...data) - Math.min(...data) };
    })()`);
    assert.ok(result.rms > 0.45 && result.rms < 0.55);
    assert.ok(result.range > 0.95);
    assert.ok(Math.abs(result.mean) < 0.002);
});

for (const [name, registers] of [
    ['three-channel tone', [[0, 100], [2, 150], [4, 200], [7, 56], [8, 15], [9, 15], [10, 15]]],
    ['noise', [[6, 3], [7, 55], [8, 15]]],
    ['repeating envelope', [[7, 63], [8, 16], [11, 20], [13, 14]]]
]) {
    test(`AY ${name} remains audible in scheduled buffers`, async () => {
        const e = await start();
        const result = e.evaluate(`(() => {
            ayChip.reset(); ayLog = []; lastSpeakerState = 0;
            for (const [register, value] of ${JSON.stringify(registers)}) ayChip.write(register, value);
            let data;
            for (let frame = 0; frame < 20; frame++) {
                processAudioFrame([]);
                data = audioCtx.lastBuffer.getChannelData(0);
            }
            return { rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length),
                min: Math.min(...data), max: Math.max(...data) };
        })()`);
        assert.ok(result.rms > 0.02, `${name} must not be gated away`);
        assert.ok(result.min < -0.01 && result.max > 0.01);
    });
}

test('AY register writes keep their sample positions, including an instruction crossing a frame', async () => {
    const e = await start();
    const samples = e.evaluate(`(() => {
        ayChip.reset(); ayChip.write(7, 63); lastSpeakerState = 0;
        const length = getFrameTStates();
        return [
            ...synthesizeAudioFrame([], [
                { t: length / 4, register: 8, value: 15 },
                { t: length * 3 / 4, register: 8, value: 0 },
                { t: length + 4, register: 8, value: 15 }
            ]),
            ...synthesizeAudioFrame([], [])
        ];
    })()`);
    const on = Math.ceil(FRAME_SAMPLES / 4) - 1;
    const off = Math.ceil(FRAME_SAMPLES * 3 / 4) - 1;
    for (let i = 0; i < samples.length; i++) {
        const step = samples[i] - R * (i ? samples[i - 1] : 0);
        near(step, i === on || i === FRAME_SAMPLES ? 1 / 6 : i === off ? -1 / 6 : 0);
    }
});

test('startup and underrun recovery add 40 ms; timely buffers remain contiguous', async () => {
    const e = await start();
    near(e.evaluate('audioCtx.starts[0]'), 0.04);
    for (const delay of [0.02, 0.025, 0.015, 0.03]) {
        const previousEnd = e.evaluate('nextAudioTime');
        e.evaluate(`audioCtx.currentTime += ${delay}; loop();`);
        near(e.evaluate('audioCtx.starts.at(-1)'), previousEnd);
    }
    for (const delay of [0, 0.1, 0.5]) {
        e.evaluate(`audioCtx.currentTime = nextAudioTime + ${delay}; loop();`);
        near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), 0.04);
        const previousEnd = e.evaluate('nextAudioTime');
        e.frames(1);
        near(e.evaluate('audioCtx.starts.at(-1)'), previousEnd);
    }
});

test('audio pacing stays near 50 Hz under 60 Hz callbacks with a bounded queue', async () => {
    const e = await start();
    const result = e.evaluate(`(() => {
        const initial = audioCtx.starts.length;
        let maxAhead = 0;
        for (let tick = 1; tick <= 600; tick++) {
            audioCtx.currentTime = tick / 60;
            loop();
            maxAhead = Math.max(maxAhead, nextAudioTime - audioCtx.currentTime);
        }
        return { frames: audioCtx.starts.length - initial, maxAhead,
            contiguous: audioCtx.starts.every((time, i, starts) => !i || Math.abs(time - starts[i - 1] - 0.02) < 1e-9) };
    })()`);
    assert.ok(result.frames >= 499 && result.frames <= 502, `${result.frames} frames over ten seconds`);
    assert.ok(result.maxAhead <= 0.100001, 'The scheduling cushion must not cause runaway buffering');
    assert.equal(result.contiguous, true);
});

test('suspended audio keeps executing CPU frames and synthesis, then resumes with fresh lead', async () => {
    const e = await start();
    const result = e.evaluate(`(() => {
        audioCtx.state = 'suspended'; nextAudioTime = 100;
        const initialStarts = audioCtx.starts.length;
        let frames = 0;
        const synth = synthesizeAudioFrame;
        synthesizeAudioFrame = (...args) => { frames++; return synth(...args); };
        for (let i = 0; i < 20; i++) loop();
        const suspendedStarts = audioCtx.starts.length - initialStarts;
        audioCtx.state = 'running';
        loop();
        return { frames, suspendedStarts, resumedStarts: audioCtx.starts.length - initialStarts,
            lead: audioCtx.starts.at(-1) - audioCtx.currentTime };
    })()`);
    assert.equal(result.frames, 21);
    assert.equal(result.suspendedStarts, 0);
    assert.equal(result.resumedStarts, 1);
    near(result.lead, 0.04);
});

test('reset and model switches clear the DC filter history and restore scheduling lead', async () => {
    const e = await start();
    for (const operation of ['resetSystem()', "loadBuiltInModel('48K')", "loadBuiltInModel('128K')"]) {
        // Leave a substantial tail and a nonzero previous input in the filter.
        e.evaluate('synthesizeAudioFrame([{ t: 0, val: 1 }], []);');
        await e.evaluate(operation);
        assert.ok(e.evaluate('audioCtx.lastBuffer.getChannelData(0).every(value => value === 0)'), operation);
        near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), 0.04);
    }
});
