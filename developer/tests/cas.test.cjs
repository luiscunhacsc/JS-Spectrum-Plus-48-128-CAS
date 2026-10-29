const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSession } = require('../cas.js');

test('the requested shifted-sine integral explains substitution and checks its derivative', () => {
    const result = createSession().run('integrate(sin(x+1),x)');
    assert.equal(result.result, '-cos(x+1)+C');
    assert.equal(createSession().run('integral(sin(x+1),x)').result, result.result);
    assert.deepEqual(result.steps.map(s => s.title), ['Substitution', 'Integrate in u', 'Substitute back', 'Differentiate to check']);
    assert.equal(result.steps[0].math, 'u = x+1, du = (1) dx');
    assert.equal(result.steps.at(-1).math, 'd/dx (-cos(x+1)) = sin(x+1)');
});

test('exact arithmetic, operator precedence, decimals, and implicit multiplication', () => {
    const cas = createSession();
    for (const [input, expected] of [
        ['1/3+1/6', '1/2'], ['0.1+0.2', '3/10'], ['1e-3*1000', '1'],
        ['-2^2', '-4'], ['2^-3', '1/8'], ['2^3^2', '512'],
        ['2x+3x-x', '4*x'], ['expand((x+1)(x-1))', 'x^2-1'], ['sqrt(81/16)', '9/4']
    ]) assert.equal(cas.run(input).result, expected, input);
});

test('antiderivatives have the right numerical derivative across different rule families', () => {
    const cases = [
        ['integrate(sin(2*x+1),x)', x => Math.sin(2*x+1)],
        ['integrate(cos(3*x-2),x)', x => Math.cos(3*x-2)],
        ['integrate(x^3+2*x+3,x)', x => x**3+2*x+3],
        ['integrate(1/x,x)', x => 1/x],
        ['integrate((2*x+1)^(-2),x)', x => (2*x+1)**-2],
        ['integrate(2*x*cos(x^2),x)', x => 2*x*Math.cos(x*x)],
        ['integrate(x*(x^2+1)^3,x)', x => x*(x*x+1)**3],
        ['integrate(x*exp(x),x)', x => x*Math.exp(x)],
        ['integrate(x^2*sin(2*x),x)', x => x*x*Math.sin(2*x)],
        ['integrate(ln(2*x+1),x)', x => Math.log(2*x+1)],
        ['integrate(sqrt(x+1),x)', x => Math.sqrt(x+1)]
    ];
    for (const [input, integrand] of cases) {
        const cas = createSession(); const primitive = cas.run(input).result.replace(/\+C$/, '');
        for (const x of [0.4, 1.3, 2.1]) {
            const h = 1e-4;
            const value = t => Number(cas.run(`approx(subst(${primitive},x,${t}))`).result);
            const actual = (value(x+h)-value(x-h))/(2*h);
            assert.ok(Math.abs(actual-integrand(x)) < 2e-5, `${input} at ${x}: ${actual} != ${integrand(x)}`);
        }
    }
});

test('differentiation applies chain, product, variable-power, and inverse-trig rules', () => {
    const cas = createSession();
    for (const [input, x, expected] of [
        ['diff(sin(x^2),x)', 0.7, 1.4*Math.cos(0.49)],
        ['diff(x*exp(x),x)', 0.7, 1.7*Math.exp(0.7)],
        ['diff(x^x,x)', 2, 4*(Math.log(2)+1)],
        ['diff(atan(x),x)', 2, 0.2],
        ['diff(ln(abs(x)),x)', -2, -0.5]
    ]) {
        const derivative = cas.run(input).result;
        const actual = Number(cas.run(`approx(subst(${derivative},x,${x}))`).result);
        assert.ok(Math.abs(actual-expected)<1e-9, input);
    }
});

test('definite integration respects bounds and refuses singular or uncertified intervals', () => {
    const cas = createSession();
    assert.equal(cas.run('integrate(sin(x),x,0,pi)').result, '2');
    assert.equal(cas.run('integrate(x^2,x,0,3)').result, '9');
    assert.equal(cas.run('integrate(x^2,x,3,0)').result, '-9');
    assert.equal(cas.run('integrate(1/x,x,-2,-1)').result, '-ln(2)');
    for (const source of ['integrate(1/x,x,-1,1)', 'integrate(x/x,x,-1,1)', 'integrate(1/(x-1),x,0,2)', 'integrate(tan(x),x,0,pi)'])
        assert.throws(() => cas.run(source), /continuity|undefined/, source);
});

test('quadratic solving and factorization produce exact real answers', () => {
    const cas = createSession();
    assert.equal(cas.run('solve(x^2-5*x+6=0,x)').result, '{x=3, x=2}');
    assert.equal(cas.run('solve(2*x+1=0,x)').result, '{x=-1/2}');
    assert.equal(cas.run('solve(x^2+1=0,x)').result, 'No real solutions');
    assert.equal(cas.run('solve((x-1)^2=0,x)').result, '{x=1}');
    assert.equal(cas.run('expand(factor(2*x^2-2,x))-(2*x^2-2)').result, '0');
    assert.equal(cas.run('expand((x+1)^3)').result, 'x^3+3*x^2+3*x+1');
    assert.throws(() => cas.run('solve(x^2/x=0,x)'), /polynomial/);
});

test('substitution preserves undefined input domains; ans survives errors and clear resets it', () => {
    const cas = createSession();
    assert.equal(cas.run('subst(x^2+1,x,3)').result, '10');
    assert.throws(() => cas.run('subst(x/x,x,0)'), /Zero|zero/);
    assert.equal(cas.run('ans+1').result, '11');
    assert.equal(cas.run('integrate(sin(x+1),x)').result, '-cos(x+1)+C');
    assert.equal(cas.run('diff(ans,x)').result, 'sin(x+1)');
    assert.equal(cas.run('diff(integrate(x,x),x)').result, 'x');
    cas.clear(); assert.throws(() => cas.run('ans'), /previous/);
});

test('invalid syntax, unsupported integrals, and excessive work produce useful errors', () => {
    const cas = createSession();
    for (const source of ['1/0', '0^0', 'sqrt(-1)', 'ln(0)', 'sin(x,x)', 'integrate(x)', 'sin(x', '1;globalThis.pwned=1', 'solve(x^3=1,x)', 'approx(x)', 'integrate(exp(x^2),x)', 'expand((x+y+z)^16)', '2^100000', '('.repeat(80)+'x'+')'.repeat(80)]) {
        assert.throws(() => cas.run(source), Error, source);
    }
    assert.equal(cas.run('2+2').result, '4', 'a failed calculation cannot poison the next request');
});
