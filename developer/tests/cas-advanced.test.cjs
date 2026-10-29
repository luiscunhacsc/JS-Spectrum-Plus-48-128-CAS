const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSession } = require('../cas.js');

function numberAt(expression, values) {
    let source = expression;
    for (const [variable, value] of Object.entries(values)) source = `subst(${source},${variable},${value})`;
    return Number(createSession().run(`approx(${source})`).result);
}
function checkPrimitive(source, integrand, points, parameters = {}) {
    const result = createSession().run(source);
    assert.equal(result.verified, true, source);
    assert.equal(result.verification.status, 'proved');
    assert.equal(result.verification.residual, '0');
    const primitive = result.result.replace(/\+C$/, '');
    for (const x of points) {
        const h = 0.0001;
        const numericalDerivative = (numberAt(primitive, { ...parameters, x: x + h }) - numberAt(primitive, { ...parameters, x: x - h })) / (2 * h);
        const expected = integrand(x);
        assert.ok(Math.abs(numericalDerivative - expected) < 0.00003 * Math.max(1, Math.abs(expected)), `${source}, x=${x}: ${numericalDerivative} != ${expected}`);
    }
    return result;
}

test('rational cancellation retains holes, combines fractions, and simplifies radicals safely', () => {
    const c = createSession();
    let r = c.run('simplify((x^2-1)/(x-1))');
    assert.equal(r.result, 'x+1'); assert.deepEqual(r.conditions, ['x-1!=0']);
    assert.equal(c.run('subst(ans,x,2)').result, '3');
    c.run('simplify((x^2-1)/(x-1))');
    assert.throws(() => c.run('subst(ans,x,1)'), /Domain condition/);
    assert.equal(c.run('simplify((x^3-x)/(x^2-1))').result, 'x');
    assert.equal(c.run('simplify(sqrt(12))').result, '2*sqrt(3)');
    assert.equal(c.run('simplify(sqrt(8/9))').result, '(2/3)*sqrt(2)');
    assert.equal(c.run('simplify(sqrt(x^2))').result, 'abs(x)');
    assert.equal(c.run('approx(subst(sqrt(x^2),x,-3))').result, '3');
    assert.equal(c.run('simplify(sin(x)^2+cos(x)^2)').result, '1');
    const combined = c.run('simplify(1/x+1/(x+1))');
    for (const x of [-3, 0.5, 2]) assert.ok(Math.abs(numberAt(combined.result, { x }) - (1/x + 1/(x+1))) < 1e-10);
    assert.equal(c.run('simplify((x+1)*(y+1)-(1+y)*(1+x))').result, '0');
});

test('partial fractions handle distinct and repeated rational linear factors', () => {
    for (const [source, integrand] of [
        ['integral(1/((x-1)*(x+2)),x)', x => 1/((x-1)*(x+2))],
        ['integral((x+3)/((x-1)^2*(x+2)),x)', x => (x+3)/((x-1)**2*(x+2))],
        ['integral(1/(x^3-x),x)', x => 1/(x**3-x)],
        ['integral((2*x+1)/((2*x-1)^2*(x+2)),x)', x => (2*x+1)/((2*x-1)**2*(x+2))]
    ]) {
        const r = checkPrimitive(source, integrand, [2.5, 3.2]);
        assert.ok(r.steps.some(s => s.title === 'Partial fractions'));
        assert.ok(r.conditions.length > 0);
    }
});

test('rational integration handles quadratic factors, repeated quadratics, and polynomial division', () => {
    for (const [source, integrand] of [
        ['integral(1/(1+x^2),x)', x => 1/(1+x*x)],
        ['integral((x+1)/(x^2+4*x+8),x)', x => (x+1)/(x*x+4*x+8)],
        ['integral(1/(x^2+1)^2,x)', x => 1/(x*x+1)**2],
        ['integral((2*x+3)/(x^2+x+2)^3,x)', x => (2*x+3)/(x*x+x+2)**3],
        ['integral(1/(x^4+5*x^2+4),x)', x => 1/(x**4+5*x*x+4)],
        ['integral(1/((x^2+1)*(x^2+x+2)),x)', x => 1/((x*x+1)*(x*x+x+2))],
        ['integral((x^3+1)/(x^2+1),x)', x => (x**3+1)/(x*x+1)],
        ['integral(1/(x^2-2),x)', x => 1/(x*x-2)],
        ['integral(1/(x^2-2)^2,x)', x => 1/(x*x-2)**2]
    ]) checkPrimitive(source, integrand, [1.8, 2.3]);
    assert.equal(createSession().run('integral(1/(1+x^2),x)').result, 'atan(x)+C');
});

test('trigonometric powers, reciprocal squares, and products have verified primitives', () => {
    for (const [source, integrand] of [
        ['integral(sin(x)^2,x)', x => Math.sin(x)**2],
        ['integral(cos(2*x+1)^4,x)', x => Math.cos(2*x+1)**4],
        ['integral(sin(x)^7,x)', x => Math.sin(x)**7],
        ['integral(sin(x)^3*cos(x)^2,x)', x => Math.sin(x)**3*Math.cos(x)**2],
        ['integral(sin(x)^2*cos(x)^2,x)', x => Math.sin(x)**2*Math.cos(x)**2],
        ['integral(sin(2*x)*cos(3*x),x)', x => Math.sin(2*x)*Math.cos(3*x)],
        ['integral(cos(x)*cos(3*x),x)', x => Math.cos(x)*Math.cos(3*x)],
        ['integral(sin(x)*sin(3*x),x)', x => Math.sin(x)*Math.sin(3*x)],
        ['integral(tan(x)^2,x)', x => Math.tan(x)**2],
        ['integral(cos(x)^(-2),x)', x => 1/Math.cos(x)**2],
        ['integral(sin(x)^(-2),x)', x => 1/Math.sin(x)**2]
    ]) checkPrimitive(source, integrand, [0.35, 0.8]);
});

test('symbolic affine parameters and powers report their exceptional cases', () => {
    let r = checkPrimitive('integral(sin(a*x+b),x)', x => Math.sin(2*x+0.3), [0.4, 1.2], { a: 2, b: 0.3 });
    assert.deepEqual(r.conditions, ['a!=0']);
    r = checkPrimitive('integral(1/(a*x+b),x)', x => 1/(2*x+3), [0.4, 1.2], { a: 2, b: 3 });
    assert.ok(r.conditions.includes('a!=0')); assert.ok(r.conditions.includes('a*x+b!=0'));
    checkPrimitive('integral(x*exp(a*x),x)', x => x*Math.exp(2*x), [0.4, 0.8], { a: 2 });
    r = checkPrimitive('integral(x^n,x)', x => x**2.5, [0.4, 1.2], { n: 2.5 });
    assert.ok(r.conditions.includes('n+1!=0')); assert.ok(r.conditions.includes('x>0'));
    const c = createSession();
    assert.equal(c.run('subst(integral(sin(a*x),x),a,0)').result, '0+C');
    assert.equal(c.run('subst(integral(x^n,x),n,-1)').result, 'ln(abs(x))+C');
    c.run('integral(sin(a*x),x)');
    assert.throws(() => c.run('subst(ans,a,0)'), /Domain condition/);
    c.run('integral(x^n,x)');
    assert.throws(() => c.run('subst(ans,n,-1)'), /Domain condition/);
});

test('resonant parameter values must be recomputed rather than substituted into singular formulas', () => {
    const r = checkPrimitive('integral(sin(a*x)*cos(b*x),x)', x => Math.sin(2*x)*Math.cos(3*x), [0.4, 1.2], { a: 2, b: 3 });
    assert.ok(r.conditions.some(c => c.includes('a') && c.includes('b')));
    const source = 'subst(subst(integral(sin(a*x)*cos(b*x),x),a,2),b,2)';
    checkPrimitive(source, x => Math.sin(2*x)*Math.cos(2*x), [0.4, 0.8]);
});

test('verification proves identities exactly and never treats sampling or failed proof as success', () => {
    const c = createSession();
    for (const source of [
        'verify(-cos(x),sin(x),x)',
        'verify(x/2-sin(2*x)/4,sin(x)^2,x)',
        'verify(atan(x),1/(1+x^2),x)',
        'verify(ln(abs(x)),1/x,x)',
        'verify(0,sin(x)^2+cos(x)^2-1,x)',
        'verify((sin(x)^2)/2,sin(x)*cos(x),x)'
    ]) {
        const result = c.run(source);
        assert.equal(result.result, 'Verified', source); assert.equal(result.verified, true);
        assert.equal(result.verification.residual, '0');
    }
    for (const source of ['verify(cos(x),sin(x),x)', 'verify(x,1/(1+x^2),x)', 'verify(0,sin(1000*x),x)']) {
        const result = c.run(source);
        assert.equal(result.result, 'Not proved'); assert.equal(result.verified, false);
        assert.notEqual(result.verification.residual, '0');
    }
});

test('domain restrictions survive cancellation, differentiation, nested substitution, and ans reuse', () => {
    const c = createSession();
    assert.deepEqual(c.run('simplify(x/x)').conditions, ['x!=0']);
    assert.throws(() => c.run('subst(ans,x,0)'), /Domain condition/);
    assert.deepEqual(c.run('diff(x/x,x)').conditions, ['x!=0']);
    assert.deepEqual(c.run('diff(abs(x),x)').conditions, ['x!=0']);
    assert.deepEqual(c.run('diff(sqrt(x),x)').conditions, ['x>0']);
    assert.throws(() => c.run('subst(ln(x),x,0)'), /Domain condition/);
    assert.throws(() => c.run('subst(sqrt(x),x,-1)'), /Domain condition/);
    assert.equal(c.run('approx((-8)^(1/3))').result, '-2');
    assert.deepEqual(c.run('1/(x^2+4*x+8)').conditions, []);
});

test('definite rational integrals certify the full interval and retain original holes', () => {
    const c = createSession();
    assert.equal(c.run('integral(1/(1+x^2),x,0,1)').result, '(1/4)*pi');
    assert.equal(c.run('integral(sin(x)^2,x,0,pi)').result, '(1/2)*pi');
    for (const source of [
        'integral(1/(x^2-1),x,-2,2)',
        'integral(1/(x^2-1),x,1,2)',
        'integral((x^2-1)/(x-1),x,0,2)',
        'integral(x^0,x,-1,1)',
        'integral(1/(x^2-2),x,0,2)'
    ]) assert.throws(() => c.run(source), /continuity|Domain condition/, source);
    c.run('simplify(x/x)');
    assert.throws(() => c.run('integral(ans,x,-1,1)'), /continuity/);
    const r = c.run('integral(1/(x^2-1),x,2,3)');
    assert.deepEqual(r.conditions, []); assert.equal(r.verified, true);
    assert.ok(Math.abs(numberAt(r.result, {}) - Math.log(1.5)/2) < 1e-10);
    const symbolic = c.run('integral(sin(a*x),x,0,pi)');
    assert.deepEqual(symbolic.conditions, ['a!=0']); assert.equal(symbolic.verified, true);
    const scoped = c.run('1/x+integral(x,x,0,1)');
    assert.deepEqual(scoped.conditions, ['x!=0']);
    assert.ok(Math.abs(numberAt(scoped.result, { x: 2 }) - 1) < 1e-10);
    assert.throws(() => c.run('integral(1/(x^2-1),x,1,1.00000000000001)'), /continuity|Domain condition/);
    assert.throws(() => c.run('integral(tan(x),x,100000000000000000000,100000000000000000001)'), /precision|continuity/);
    assert.equal(c.run('integral(sqrt(x),x,0,1)').result, '2/3');
    for (const source of ['ln()', 'sqrt()', 'asin()', 'tan()']) assert.throws(() => c.run(source), /expects one argument/);
});
