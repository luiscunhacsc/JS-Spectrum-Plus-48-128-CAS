/* Spectrum CAS: a bounded, offline symbolic engine. No JavaScript evaluation. */
(function (root) {
    'use strict';
    const OPERATION_LIMIT = 180000;
    let remaining = OPERATION_LIMIT;
    let calculation = { conditions: new Map(), checks: [] };
    const fail = message => { throw new Error(message); };
    function tick() { if (--remaining < 0) fail('This expression exceeds the calculation limit. Try a smaller expression.'); }
    function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; }
    function num(p, q = 1n) {
        tick(); p = BigInt(p); q = BigInt(q);
        if (!q) fail('Division by zero.');
        if (q < 0n) { p = -p; q = -q; }
        const g = gcd(p, q); p /= g; q /= g;
        if (p.toString().length + q.toString().length > 2048) fail('Number exceeds the exact arithmetic limit.');
        return { type: 'num', p, q };
    }
    const zero = () => num(0), one = () => num(1);
    const sym = name => ({ type: 'sym', name });
    const isNum = a => a.type === 'num';
    const is = (a, p) => isNum(a) && a.p === BigInt(p) * a.q;
    const same = (a, b) => key(a) === key(b);
    function key(a) {
        tick();
        switch (a.type) {
            case 'num': return `${a.p}/${a.q}`;
            case 'sym': return a.name;
            case 'pow': return `^(${key(a.base)},${key(a.exp)})`;
            default: {
                const parts = a.args.map(key);
                if (a.type === 'add' || a.type === 'mul') parts.sort();
                return `${a.name || a.type}(${parts.join(',')})`;
            }
        }
    }
    function add(...items) {
        tick();
        let constant = zero(); const terms = new Map();
        for (const a of items.flatMap(a => a.type === 'add' ? a.args : [a])) {
            if (isNum(a)) { constant = num(constant.p * a.q + a.p * constant.q, constant.q * a.q); continue; }
            const coefficient = a.type === 'mul' && isNum(a.args[0]) ? a.args[0] : one();
            const term = a.type === 'mul' && isNum(a.args[0]) ? mul(...a.args.slice(1)) : a;
            const k = key(term), old = terms.get(k);
            terms.set(k, { term, coefficient: old ? add(old.coefficient, coefficient) : coefficient });
        }
        const args = [...terms.values()].filter(t => !is(t.coefficient, 0))
            .map(t => is(t.coefficient, 1) ? t.term : mul(t.coefficient, t.term));
        if (!is(constant, 0)) args.push(constant);
        return !args.length ? zero() : args.length === 1 ? args[0] : { type: 'add', args };
    }
    function mul(...items) {
        tick();
        let coefficient = one(); const factors = new Map();
        for (const a of items.flatMap(a => a.type === 'mul' ? a.args : [a])) {
            if (isNum(a)) { coefficient = num(coefficient.p * a.p, coefficient.q * a.q); continue; }
            // Rational powers use real roots. Evaluation retains their original domains.
            const integerPower = a.type === 'pow' && isNum(a.exp);
            const base = integerPower ? a.base : a, exponent = integerPower ? a.exp : one();
            const k = key(base), old = factors.get(k);
            factors.set(k, { base, exponent: old ? add(old.exponent, exponent) : exponent });
        }
        if (is(coefficient, 0)) return zero();
        const args = [...factors.values()].map(f => pow(f.base, f.exponent)).filter(a => !is(a, 1));
        args.sort((a, b) => key(a).localeCompare(key(b)));
        if (args.length === 1 && args[0].type === 'add' && !is(coefficient, 1))
            return add(...args[0].args.map(t => mul(coefficient, t)));
        if (!is(coefficient, 1) || !args.length) args.unshift(coefficient);
        return args.length === 1 ? args[0] : { type: 'mul', args };
    }
    const neg = a => mul(num(-1), a);
    const sub = (a, b) => add(a, neg(b));
    const div = (a, b) => mul(a, pow(b, num(-1)));
    function pow(base, exp) {
        tick();
        if (is(base, 0) && isNum(exp) && exp.p <= 0n) fail('Zero cannot be raised to a zero or negative power.');
        if (is(base, 0) && isNum(exp) && exp.p > 0n) return zero();
        if (is(exp, 0)) return one();
        if (is(exp, 1) || is(base, 1)) return base;
        if (isNum(base) && isNum(exp) && exp.q === 1n) {
            const n = exp.p < 0n ? -exp.p : exp.p;
            if (n > 512n) fail('Exact powers are limited to an exponent of 512.');
            return exp.p < 0n ? num(base.q ** n, base.p ** n) : num(base.p ** n, base.q ** n);
        }
        if (base.type === 'call' && isNum(exp) && exp.q === 1n) {
            if (base.name === 'abs' && exp.p % 2n === 0n) return pow(base.args[0], exp);
            if (base.name === 'sqrt' && exp.p % 2n === 0n) return pow(base.args[0], num(exp.p / 2n));
        }
        if (base.type === 'pow' && isNum(exp) && exp.q === 1n && isNum(base.exp))
            return pow(base.base, mul(base.exp, exp));
        if (base.type === 'mul' && isNum(exp) && exp.q === 1n)
            return mul(...base.args.map(a => pow(a, exp)));
        return { type: 'pow', base, exp };
    }
    function integerSqrt(n) {
        if (n < 0n) return null;
        if (n < 2n) return n;
        let x = n, y = (x + 1n) / 2n;
        while (y < x) { tick(); x = y; y = (x + n / x) / 2n; }
        return x * x === n ? x : null;
    }
    function call(name, args) {
        tick();
        if (name === 'log') name = 'ln';
        const a = args[0];
        if (args.length !== 1) fail(`${name} expects one argument.`);
        if (name === 'sqrt' && isNum(a)) {
            if (a.p < 0n) fail('sqrt requires a nonnegative number in real mode.');
            const p = integerSqrt(a.p), q = integerSqrt(a.q);
            if (p !== null && q !== null) return num(p, q);
            function squarePart(n) {
                let outside = 1n;
                for (let d = 2n; d <= 1000n && d * d <= n; d++) {
                    tick();
                    while (n % (d * d) === 0n) { outside *= d; n /= d * d; }
                }
                const root = integerSqrt(n);
                return root === null ? [outside, n] : [outside * root, 1n];
            }
            const [op, ip] = squarePart(a.p), [oq, iq] = squarePart(a.q);
            if (op !== 1n || oq !== 1n || iq !== 1n)
                return mul(num(op, oq * iq), { type: 'call', name: 'sqrt', args: [num(ip * iq)] });
        }
        if (name === 'sqrt' && a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n && a.exp.p % 2n === 0n)
            return call('abs', [pow(a.base, num(a.exp.p / 2n))]);
        if (name === 'sqrt' && a.type === 'call' && a.name === 'abs') return { type: 'call', name, args };
        if (name === 'abs' && isNum(a)) return num(a.p < 0n ? -a.p : a.p, a.q);
        if (name === 'abs' && knownSign(a) >= 0) return a;
        if (name === 'ln' && is(a, 1)) return zero();
        if (name === 'ln' && a.type === 'sym' && a.name === 'e') return one();
        if (name === 'ln' && isNum(a) && a.p <= 0n) fail('ln requires a positive argument in real mode.');
        if (name === 'exp' && is(a, 0)) return one();
        if ((name === 'sin' || name === 'cos') && is(a, 0)) return num(name === 'cos' ? 1 : 0);
        if ((name === 'tan' || name === 'asin' || name === 'atan') && is(a, 0)) return zero();
        if (name === 'atan' && (is(a, 1) || is(a, -1))) return mul(num(a.p > 0n ? 1 : -1, 4), sym('pi'));
        if ((name === 'asin' || name === 'acos') && (is(a, 1) || is(a, -1)))
            return mul(num(name === 'asin' ? (a.p > 0n ? 1 : -1) : (a.p > 0n ? 0 : 2), 2), sym('pi'));
        if (name === 'acos' && is(a, 0)) return mul(num(1, 2), sym('pi'));
        if (name === 'sin' || name === 'cos' || name === 'tan') {
            const pi = sym('pi');
            const multiple = same(a, pi) ? one() : a.type === 'mul' && a.args.length === 2 && isNum(a.args[0]) && same(a.args[1], pi) ? a.args[0] : null;
            if (multiple && (2n * multiple.p) % multiple.q === 0n) {
                const quadrant = Number(((2n * multiple.p / multiple.q) % 4n + 4n) % 4n);
                if (name === 'tan') { if (quadrant % 2) fail('tan is undefined at this angle.'); return zero(); }
                return num((name === 'sin' ? [0, 1, 0, -1] : [1, 0, -1, 0])[quadrant]);
            }
        }
        return { type: 'call', name, args };
    }
    const functions = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'ln', 'log', 'sqrt', 'abs']);
    const commands = new Set(['integrate', 'integral', 'diff', 'd', 'simplify', 'expand', 'factor', 'solve', 'approx', 'numeric', 'subst', 'verify']);

    function parse(source) {
        if (typeof source !== 'string' || !source.trim()) fail('Enter an expression.');
        if (source.length > 1024) fail('Expressions are limited to 1024 characters.');
        const tokens = []; let pos = 0;
        source = source.replace(/π/g, 'pi').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
        while (pos < source.length) {
            if (/\s/.test(source[pos])) { pos++; continue; }
            const rest = source.slice(pos);
            const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^[+\-*/^(),=]/.exec(rest);
            if (!match) fail(`Unexpected character at position ${pos + 1}.`);
            tokens.push(match[0]); pos += match[0].length;
        }
        let at = 0, depth = 0;
        const take = t => tokens[at] === t ? (at++, true) : false;
        function expression(min = 0) {
            tick(); if (++depth > 64) fail('Expression nesting is too deep.');
            let a, token = tokens[at++];
            if (!token) fail('Expected an expression.');
            if (token === '+' || token === '-') { a = expression(25); if (token === '-') a = { type: 'mul', args: [num(-1), a] }; }
            else if (token === '(') { a = expression(); if (!take(')')) fail('Missing closing parenthesis.'); }
            else if (/^(\d|\.)/.test(token)) {
                const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
                const power = Number(exponent), decimals = (mantissa.split('.')[1] || '').length;
                if (Math.abs(power) > 100) fail('Decimal exponents are limited to 100.');
                const p = BigInt(mantissa.replace('.', '')), scale = decimals - power;
                a = scale >= 0 ? num(p, 10n ** BigInt(scale)) : num(p * 10n ** BigInt(-scale));
            } else if (/^[A-Za-z]/.test(token)) {
                if (tokens[at] === '(' && (functions.has(token) || commands.has(token))) {
                    at++; const args = [];
                    if (!take(')')) {
                        do { args.push(expression()); } while (take(','));
                        if (!take(')')) fail('Expected a comma or closing parenthesis.');
                    }
                    a = { type: 'call', name: token, args };
                } else a = sym(token);
            } else fail(`Unexpected token "${token}".`);
            while (at < tokens.length) {
                const next = tokens[at], implicit = next === '(' || /^[A-Za-z0-9.]/.test(next);
                const op = implicit ? '*' : next;
                const precedence = ({ '=': 5, '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 })[op];
                if (precedence === undefined || precedence < min) break;
                if (!implicit) at++;
                const b = expression(op === '^' ? precedence : precedence + 1);
                a = op === '+' ? { type: 'add', args: [a, b] }
                    : op === '-' ? { type: 'add', args: [a, { type: 'mul', args: [num(-1), b] }] }
                    : op === '*' ? { type: 'mul', args: [a, b] }
                    : op === '/' ? { type: 'mul', args: [a, { type: 'pow', base: b, exp: num(-1) }] }
                    : op === '^' ? { type: 'pow', base: a, exp: b } : { type: 'eq', args: [a, b] };
            }
            depth--; return a;
        }
        const result = expression();
        if (at !== tokens.length) fail(`Unexpected token "${tokens[at]}".`);
        return result;
    }
    function precedence(a) { return a.type === 'add' ? 10 : a.type === 'mul' ? 20 : a.type === 'pow' ? 30 : isNum(a) && (a.p < 0n || a.q !== 1n) ? 20 : 40; }
    function format(a, parent = 0) {
        let result;
        if (isNum(a)) result = `${a.p}${a.q === 1n ? '' : '/' + a.q}`;
        else if (a.type === 'sym') result = a.name;
        else if (a.type === 'add') result = a.args.map((t, i) => {
            const text = format(t); return i && !text.startsWith('-') ? '+' + text : text;
        }).join('');
        else if (a.type === 'mul') {
            const negative = isNum(a.args[0]) && a.args[0].p < 0n;
            let factors = negative ? [num(-a.args[0].p, a.args[0].q), ...a.args.slice(1)] : a.args;
            if (is(factors[0], 1) && factors.length > 1) factors = factors.slice(1);
            result = (negative ? '-' : '') + factors.map(t => format(t, 21)).join('*');
        } else if (a.type === 'pow') result = `${format(a.base, 31)}^${format(a.exp, 31)}`;
        else if (a.type === 'eq') result = a.args.map(t => format(t)).join('=');
        else if (a.type === 'list') result = '{' + a.args.map(t => format(t)).join(', ') + '}';
        else result = `${a.name}(${a.args.map(t => format(t)).join(',')})`;
        return precedence(a) < parent ? '(' + result + ')' : result;
    }
    function depends(a, variable) {
        tick();
        if (a.type === 'guarded') return depends(a.expression, variable);
        if (a.type === 'sym') return a.name === variable;
        if (a.type === 'pow') return depends(a.base, variable) || depends(a.exp, variable);
        return !!a.args?.some(t => depends(t, variable));
    }
    function substitute(a, variable, value) {
        tick();
        if (a.type === 'guarded') return { ...a, expression: substitute(a.expression, variable, value),
            guards: a.guards.map(g => ({ ...g, expression: substitute(g.expression, variable, value) })) };
        if (a.type === 'sym') return a.name === variable ? value : a;
        if (a.type === 'pow') return { ...a, base: substitute(a.base, variable, value), exp: substitute(a.exp, variable, value) };
        if (a.args) return { ...a, args: a.args.map(t => substitute(t, variable, value)) };
        return a;
    }
    function rebuild(a, args) {
        return a.type === 'add' ? add(...args) : a.type === 'mul' ? mul(...args)
            : a.type === 'call' ? call(a.name, args) : { ...a, args };
    }
    // Sign information is deliberately conservative: 2 positive, 1 nonnegative,
    // 0 zero, -1 nonpositive, -2 negative, NaN unknown. All symbols are finite reals.
    function knownSign(a) {
        tick();
        if (isNum(a)) return a.p > 0n ? 2 : a.p < 0n ? -2 : 0;
        if (a.type === 'sym') return ['pi', 'e'].includes(a.name) ? 2 : NaN;
        if (a.type === 'call') {
            if (a.name === 'exp') return 2;
            if (a.name === 'abs' || a.name === 'sqrt') return 1;
        }
        if (a.type === 'pow' && isNum(a.exp)) {
            const s = knownSign(a.base);
            if (a.exp.p === 0n) return 2;
            if (s === 2) return 2;
            if (a.exp.q === 1n && a.exp.p % 2n === 0n) return s === -2 || a.exp.p < 0n ? 2 : 1;
            if (a.exp.q % 2n === 0n) return 1;
            if (a.exp.p % 2n === 0n) return 1;
            return s;
        }
        if (a.type === 'add') {
            const signs = a.args.map(knownSign);
            if (signs.every(s => s >= 0)) return signs.some(s => s === 2) ? 2 : signs.every(s => s === 0) ? 0 : 1;
            if (signs.every(s => s <= 0)) return signs.some(s => s === -2) ? -2 : signs.every(s => s === 0) ? 0 : -1;
            const vars = [...symbols(a)];
            if (vars.length === 1) {
                const r = rationalPolynomial(a, vars[0]);
                if (r && r[1].length === 1 && r[0].length === 3) {
                    const [c, b, leading] = pscale(r[0], rd(one(), r[1][0]));
                    const discriminant = ra(rm(b, b), rn(rm(num(4), rm(leading, c))));
                    if (discriminant.p <= 0n) return (leading.p > 0n ? 1 : -1) * (discriminant.p < 0n ? 2 : 1);
                }
            }
        }
        if (a.type === 'mul') {
            const signs = a.args.map(knownSign);
            if (signs.includes(0)) return 0;
            if (signs.every(Number.isFinite)) return (signs.filter(s => s < 0).length % 2 ? -1 : 1) * (signs.every(s => Math.abs(s) === 2) ? 2 : 1);
        }
        return NaN;
    }
    function basicSimplify(a) {
        tick();
        if (a.type === 'pow') return pow(basicSimplify(a.base), basicSimplify(a.exp));
        if (a.args) return rebuild(a, a.args.map(basicSimplify));
        return a;
    }
    const conditionText = g => `${format(g.expression)}${{ nonzero: '!=0', nonnegative: '>=0', positive: '>0' }[g.relation]}`;
    function requireCondition(expression, relation) {
        tick(); expression = basicSimplify(expression);
        if (relation === 'nonzero' && expression.type === 'mul') {
            expression.args.forEach(a => requireCondition(a, relation)); return;
        }
        if (expression.type === 'call' && expression.name === 'abs' && relation !== 'nonnegative') {
            requireCondition(expression.args[0], 'nonzero'); return;
        }
        if (expression.type === 'call' && expression.name === 'sqrt' && relation !== 'nonnegative') {
            requireCondition(expression.args[0], 'positive'); return;
        }
        if (expression.type === 'pow' && isNum(expression.exp) && relation === 'nonzero' && !is(expression.exp, 0)) {
            requireCondition(expression.base, 'nonzero'); return;
        }
        if (expression.type === 'pow' && isNum(expression.exp) && expression.exp.q === 1n && expression.exp.p % 2n === 0n && relation === 'positive') {
            requireCondition(expression.base, 'nonzero'); return;
        }
        const sign = knownSign(expression);
        const satisfied = relation === 'nonzero' ? Math.abs(sign) === 2 : relation === 'positive' ? sign === 2 : sign >= 0;
        if (satisfied) return;
        const impossible = relation === 'nonzero' ? sign === 0 : relation === 'positive' ? sign <= 0 : sign === -2;
        const guard = { expression, relation };
        if (impossible) fail(`Domain condition fails: ${conditionText(guard)}.`);
        const k = key(expression), old = calculation.conditions.get(k);
        if (old?.relation === 'positive') return;
        if (old && old.relation !== relation) guard.relation = 'positive';
        calculation.conditions.set(k, guard);
    }
    function powerDomain(base, exp) {
        if (isNum(exp)) {
            if (exp.p <= 0n) requireCondition(base, 'nonzero');
            if (exp.q % 2n === 0n) requireCondition(base, exp.p < 0n ? 'positive' : 'nonnegative');
        } else requireCondition(base, 'positive');
    }
    function functionDomain(name, a) {
        if (name === 'ln' || name === 'log') requireCondition(a, 'positive');
        if (name === 'sqrt') requireCondition(a, 'nonnegative');
        if (name === 'tan') requireCondition(call('cos', [a]), 'nonzero');
        if (name === 'asin' || name === 'acos') requireCondition(sub(one(), pow(a, num(2))), 'nonnegative');
    }

    // Exact univariate Q[x] arithmetic. Coefficients are rational num nodes.
    const ra = (a, b) => num(a.p * b.q + b.p * a.q, a.q * b.q);
    const rm = (a, b) => num(a.p * b.p, a.q * b.q);
    const rd = (a, b) => num(a.p * b.q, a.q * b.p);
    const rn = a => num(-a.p, a.q);
    function trim(p) { while (p.length > 1 && is(p.at(-1), 0)) p.pop(); return p; }
    const pzero = p => p.length === 1 && is(p[0], 0);
    function padd(a, b) { return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ra(a[i] || zero(), b[i] || zero()))); }
    const pscale = (p, c) => trim(p.map(a => rm(a, c)));
    function pmul(a, b) {
        tick(); if (a.length + b.length > 34) fail('Rational polynomial degree limit reached.');
        const out = Array.from({ length: a.length + b.length - 1 }, zero);
        for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = ra(out[i + j], rm(a[i], b[j]));
        return trim(out);
    }
    function ppow(a, n) { let out = [one()]; for (let i = 0; i < n; i++) out = pmul(out, a); return out; }
    function pdivide(a, b) {
        tick(); if (pzero(b)) fail('Polynomial division by zero.');
        let rest = a.slice(); const quotient = Array.from({ length: Math.max(1, a.length - b.length + 1) }, zero);
        while (!pzero(rest) && rest.length >= b.length) {
            const n = rest.length - b.length, coefficient = rd(rest.at(-1), b.at(-1)); quotient[n] = coefficient;
            const subtract = [...Array.from({ length: n }, zero), ...pscale(b, rn(coefficient))];
            rest = padd(rest, subtract);
        }
        return [trim(quotient), rest];
    }
    function pgcd(a, b) {
        while (!pzero(b)) { tick(); [a, b] = [b, pdivide(a, b)[1]]; }
        return pzero(a) ? [one()] : pscale(a, rd(one(), a.at(-1)));
    }
    function rationalPolynomial(a, v) {
        tick();
        if (isNum(a)) return [[a], [one()]];
        if (a.type === 'sym' && a.name === v) return [[zero(), one()], [one()]];
        if (a.type === 'add' || a.type === 'mul') {
            let out = [[a.type === 'add' ? zero() : one()], [one()]];
            for (const t of a.args) {
                const r = rationalPolynomial(t, v); if (!r) return null;
                out = a.type === 'add' ? [padd(pmul(out[0], r[1]), pmul(r[0], out[1])), pmul(out[1], r[1])]
                    : [pmul(out[0], r[0]), pmul(out[1], r[1])];
            }
            return out;
        }
        if (a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n && a.exp.p >= -16n && a.exp.p <= 16n) {
            const r = rationalPolynomial(a.base, v); if (!r) return null;
            const n = Number(a.exp.p < 0n ? -a.exp.p : a.exp.p);
            return a.exp.p < 0n ? [ppow(r[1], n), ppow(r[0], n)] : [ppow(r[0], n), ppow(r[1], n)];
        }
        return null;
    }
    function polynomialExpression(p, v) {
        return add(...p.map((c, i) => mul(c, pow(sym(v), num(i)))).reverse());
    }
    function reducedFraction(r) {
        const g = pgcd(r[0], r[1]);
        let n = pdivide(r[0], g)[0], d = pdivide(r[1], g)[0];
        const scale = rd(one(), d.at(-1)); n = pscale(n, scale); d = pscale(d, scale);
        return [n, d];
    }
    function symbols(a, out = new Set()) {
        if (a.type === 'sym' && !['pi', 'e'].includes(a.name)) out.add(a.name);
        if (a.type === 'pow') { symbols(a.base, out); symbols(a.exp, out); }
        if (a.args) a.args.forEach(t => symbols(t, out));
        return out;
    }
    function simplifyRational(a) {
        const vars = [...symbols(a)]; if (vars.length !== 1) return a;
        const r = rationalPolynomial(a, vars[0]); if (!r) return a;
        const [n, d] = reducedFraction(r);
        return div(polynomialExpression(n, vars[0]), polynomialExpression(d, vars[0]));
    }
    function simplifyTrig(a) {
        if (a.type !== 'add') return a;
        const terms = a.args.slice();
        for (let i = 0; i < terms.length; i++) {
            const factors = terms[i].type === 'mul' ? terms[i].args : [terms[i]];
            const square = factors.find(t => t.type === 'pow' && is(t.exp, 2) && t.base.type === 'call' && t.base.name === 'sin');
            if (!square) continue;
            const coefficient = mul(...factors.filter(t => t !== square));
            const complement = mul(coefficient, pow(call('cos', square.base.args), num(2)));
            const j = terms.findIndex((t, j) => j !== i && same(t, complement));
            if (j >= 0) { terms[i] = coefficient; terms[j] = zero(); }
        }
        return add(...terms);
    }
    function simplify(a) {
        if (a.type === 'pow') return pow(simplify(a.base), simplify(a.exp));
        if (!a.args) return a;
        const rebuilt = rebuild(a, a.args.map(simplify));
        return simplifyRational(simplifyTrig(rebuilt));
    }
    // Identity checking uses a separate sparse rational normal form. Sines and
    // cosines become formal complex exponentials; multiplication adds phases.
    // A zero numerator is an exact identity on the retained real input domain.
    function proveDerivative(primitiveExpression, integrand, v) {
        const derivative = simplify(differentiate(primitiveExpression, v));
        const atom = a => ({ id: 'A:' + key(a), expression: a });
        const imaginary = { id: 'I:', kind: 'imaginary' };
        function monomial(parts, coefficient) {
            tick(); const ordinary = new Map(); let phase = zero(), imaginaryPower = 0;
            for (const [a, exponent] of parts) {
                if (a.kind === 'phase') phase = add(phase, mul(num(exponent), a.expression));
                else if (a.kind === 'imaginary') imaginaryPower += exponent;
                else {
                    const old = ordinary.get(a.id);
                    ordinary.set(a.id, [a, exponent + (old?.[1] || 0)]);
                }
            }
            if (Math.floor(imaginaryPower / 2) % 2) coefficient = rn(coefficient);
            if (imaginaryPower % 2) ordinary.set(imaginary.id, [imaginary, 1]);
            phase = expand(phase);
            if (!is(phase, 0)) {
                const a = { id: 'E:' + key(phase), kind: 'phase', expression: phase };
                ordinary.set(a.id, [a, 1]);
            }
            for (const [id, [a, exponent]] of ordinary) if (a.kind === 'root' && exponent >= a.degree) {
                coefficient = rm(coefficient, pow(a.radicand, num(Math.floor(exponent / a.degree))));
                ordinary.set(id, [a, exponent % a.degree]);
            }
            const powers = [...ordinary.values()].filter(([, n]) => n).sort((a, b) => a[0].id.localeCompare(b[0].id));
            return { key: JSON.stringify(powers.map(([a, n]) => [a.id, n])), powers, coefficient };
        }
        function polynomial(terms) {
            const out = new Map();
            for (const term of terms) {
                const old = out.get(term.key);
                const coefficient = old ? ra(old.coefficient, term.coefficient) : term.coefficient;
                if (is(coefficient, 0)) out.delete(term.key); else out.set(term.key, { ...term, coefficient });
            }
            if (out.size > 256) fail('Symbolic verification exceeds the 256-term limit.');
            return out;
        }
        const constant = n => polynomial([monomial([], n)]);
        const unit = () => constant(one());
        const single = (a, c = one()) => polynomial([monomial([[a, 1]], c)]);
        const plus = (a, b) => polynomial([...a.values(), ...b.values()]);
        function times(a, b) {
            tick(); const terms = [];
            for (const x of a.values()) for (const y of b.values())
                terms.push(monomial([...x.powers, ...y.powers], rm(x.coefficient, y.coefficient)));
            return polynomial(terms);
        }
        const signature = p => [...p].map(([k, t]) => k + ':' + key(t.coefficient)).sort().join(';');
        function fraction(n, d) {
            if (!d.size) fail('Symbolic verification encountered an identically zero denominator.');
            if (!n.size) return [constant(zero()), unit()];
            if (signature(n) === signature(d)) return [unit(), unit()];
            return [n, d];
        }
        const multiply = (a, b) => fraction(times(a[0], b[0]), times(a[1], b[1]));
        const sum = (a, b) => signature(a[1]) === signature(b[1]) ? fraction(plus(a[0], b[0]), a[1])
            : fraction(plus(times(a[0], b[1]), times(b[0], a[1])), times(a[1], b[1]));
        function normal(a) {
            tick();
            if (isNum(a)) return [constant(a), unit()];
            if (a.type === 'add' || a.type === 'mul')
                return a.args.map(normal).reduce(a.type === 'add' ? sum : multiply, [constant(num(a.type === 'add' ? 0 : 1)), unit()]);
            if (a.type === 'pow' && isNum(a.base) && isNum(a.exp) && a.exp.q > 1n && a.exp.q <= 16n) {
                const whole = a.exp.p / a.exp.q, remainder = a.exp.p % a.exp.q;
                const root = { id: 'R:' + key(a.base) + ':' + a.exp.q, kind: 'root', radicand: a.base, degree: Number(a.exp.q) };
                const radical = polynomial([monomial([[root, Number(remainder < 0n ? -remainder : remainder)]], one())]);
                return multiply([constant(pow(a.base, num(whole))), unit()], remainder < 0n ? [unit(), radical] : [radical, unit()]);
            }
            if (a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n && a.exp.p >= -32n && a.exp.p <= 32n) {
                let f = normal(a.base), out = [unit(), unit()];
                if (a.exp.p < 0n) f = [f[1], f[0]];
                for (let n = 0n; n < (a.exp.p < 0n ? -a.exp.p : a.exp.p); n++) out = multiply(out, f);
                return out;
            }
            if (a.type === 'call' && a.name === 'sqrt') return normal(pow(a.args[0], num(1, 2)));
            if (a.type === 'call' && a.name === 'tan') {
                const s = normal(call('sin', a.args)), c = normal(call('cos', a.args));
                return multiply(s, [c[1], c[0]]);
            }
            if (a.type === 'call' && ['sin', 'cos'].includes(a.name)) {
                const phase = a.args[0];
                const positive = { id: '', kind: 'phase', expression: phase }, negative = { id: '', kind: 'phase', expression: neg(phase) };
                if (a.name === 'cos') return [plus(single(positive, num(1, 2)), single(negative, num(1, 2))), unit()];
                return [plus(times(single(imaginary, num(-1, 2)), single(positive)), times(single(imaginary, num(1, 2)), single(negative))), unit()];
            }
            return [single(atom(a)), unit()];
        }
        const residual = normal(sub(derivative, integrand));
        return { proved: residual[0].size === 0, derivative, method: 'Exact rational/trigonometric identity', residual: residual[0].size ? format(sub(derivative, integrand)) : '0' };
    }

    function factorDenominator(p, seeds = []) {
        const factors = [];
        function divisors(n) {
            n = n < 0n ? -n : n; if (n > 1000000n) return [];
            const out = [];
            for (let d = 1n; d * d <= n; d++) { tick(); if (n % d === 0n) { out.push(d); if (d * d !== n) out.push(n / d); } }
            return out;
        }
        function split(q, multiplicity) {
            q = pscale(q, rd(one(), q.at(-1)));
            while (q.length > 3) {
                let candidate = null;
                for (const seed of seeds) if (seed.length >= 2 && seed.length <= 3 && pzero(pdivide(q, seed)[1])) { candidate = seed; break; }
                if (!candidate && is(q[0], 0)) candidate = [zero(), one()];
                if (!candidate) {
                    let lcm = 1n; for (const c of q) lcm = lcm * c.q / gcd(lcm, c.q);
                    const integers = q.map(c => c.p * (lcm / c.q));
                    const numerators = divisors(integers[0]), denominators = divisors(integers.at(-1));
                    let tried = 0;
                    outer: for (const n of numerators) for (const d of denominators) for (const sign of [1n, -1n]) {
                        if (++tried > 512) break outer;
                        const root = num(sign * n, d), linear = [rn(root), one()];
                        if (pzero(pdivide(q, linear)[1])) { candidate = linear; break outer; }
                    }
                }
                if (!candidate && q.length === 5 && is(q[1], 0) && is(q[3], 0)) {
                    const discriminant = sub(pow(q[2], num(2)), mul(num(4), q[0], q[4]));
                    if (knownSign(discriminant) >= 0) {
                        const root = call('sqrt', [discriminant]);
                        if (isNum(root)) candidate = [rd(sub(q[2], root), mul(num(2), q[4])), zero(), one()];
                    }
                }
                if (!candidate) fail('Rational integration currently needs a denominator that factors into rational linear or quadratic factors. Try entering its factors explicitly.');
                const monic = pscale(candidate, rd(one(), candidate.at(-1)));
                split(monic, multiplicity); q = pdivide(q, monic)[0];
            }
            if (q.length === 3) {
                const discriminant = sub(pow(q[1], num(2)), mul(num(4), q[2], q[0]));
                if (knownSign(discriminant) >= 0) {
                    const radical = call('sqrt', [discriminant]);
                    if (isNum(radical)) {
                        const r = rd(add(rn(q[1]), radical), mul(num(2), q[2]));
                        factors.push({ polynomial: [rn(r), one()], multiplicity });
                        split(pdivide(q, [rn(r), one()])[0], multiplicity); return;
                    }
                }
            }
            if (q.length > 1) factors.push({ polynomial: q, multiplicity });
        }
        const derivative = p.slice(1).map((c, i) => rm(c, num(i + 1)));
        let repeated = pgcd(p, derivative), distinct = pdivide(p, repeated)[0], multiplicity = 1;
        while (distinct.length > 1) {
            const shared = pgcd(distinct, repeated), part = pdivide(distinct, shared)[0];
            if (part.length > 1) split(part, multiplicity);
            distinct = shared; repeated = pdivide(repeated, shared)[0]; multiplicity++;
        }
        return factors;
    }
    function partialFractions(numerator, denominator, factors) {
        const unknowns = [];
        for (const factor of factors) for (let power = 1; power <= factor.multiplicity; power++)
            for (let degree = 0; degree < factor.polynomial.length - 1; degree++) {
                const basis = pdivide(denominator, ppow(factor.polynomial, power))[0];
                unknowns.push({ factor, power, degree, basis: [...Array.from({ length: degree }, zero), ...basis] });
            }
        const size = denominator.length - 1;
        if (unknowns.length !== size || size > 12) fail('Partial fractions are limited to denominator degree 12.');
        const matrix = Array.from({ length: size }, (_, row) => [...unknowns.map(u => u.basis[row] || zero()), numerator[row] || zero()]);
        for (let col = 0; col < size; col++) {
            const pivot = matrix.findIndex((row, i) => i >= col && !is(row[col], 0));
            if (pivot < 0) fail('Could not construct an exact partial-fraction decomposition.');
            [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
            const scale = matrix[col][col]; matrix[col] = matrix[col].map(c => rd(c, scale));
            for (let row = 0; row < size; row++) if (row !== col && !is(matrix[row][col], 0)) {
                const multiple = matrix[row][col];
                matrix[row] = matrix[row].map((c, j) => ra(c, rn(rm(multiple, matrix[col][j]))));
            }
        }
        return unknowns.map((u, i) => ({ ...u, coefficient: matrix[i][size] })).filter(u => !is(u.coefficient, 0));
    }
    function integrateRational(a, v, steps, depth) {
        const r = rationalPolynomial(a, v); if (!r || r[1].length === 1) return null;
        const [n, d] = reducedFraction(r), [quotient, rest] = pdivide(n, d);
        if (d.length === 1) {
            const expression = polynomialExpression(n, v);
            step(steps, 'Cancel polynomial factors', `${format(a)} = ${format(expression)}`, 'Original denominator restrictions are retained.');
            return integrate(expression, v, steps, depth + 1);
        }
        let result = pzero(quotient) ? zero() : integrate(polynomialExpression(quotient, v), v, steps, depth + 1);
        if (!pzero(quotient)) step(steps, 'Polynomial division', `${format(a)} = ${format(polynomialExpression(quotient, v))}+(${format(polynomialExpression(rest, v))})/(${format(polynomialExpression(d, v))})`);
        if (pzero(rest)) return result;
        const seeds = [];
        function collect(t) {
            if (t.type === 'pow') {
                const p = rationalPolynomial(t.base, v);
                if (p && p[1].length === 1 && p[0].length >= 2 && p[0].length <= 3) seeds.push(pscale(p[0], rd(one(), p[0].at(-1))));
                collect(t.base);
            }
            if (t.args) t.args.forEach(collect);
        }
        collect(a);
        const factors = factorDenominator(d, seeds), fractions = partialFractions(rest, d, factors);
        const decomposition = add(...fractions.map(f => div(mul(f.coefficient, pow(sym(v), num(f.degree))), pow(polynomialExpression(f.factor.polynomial, v), num(f.power)))));
        step(steps, 'Partial fractions', `${format(div(polynomialExpression(rest, v), polynomialExpression(d, v)))} = ${format(decomposition)}`, 'Coefficients are solved with exact rational arithmetic.');
        const grouped = new Map();
        for (const f of fractions) {
            const k = factors.indexOf(f.factor) + ':' + f.power;
            if (!grouped.has(k)) grouped.set(k, { ...f, coefficients: [zero(), zero()] });
            grouped.get(k).coefficients[f.degree] = f.coefficient;
        }
        for (const f of grouped.values()) {
            const q = polynomialExpression(f.factor.polynomial, v), k = f.power;
            if (f.factor.polynomial.length === 2) {
                const term = k === 1 ? mul(f.coefficients[0], call('ln', [call('abs', [q])])) : mul(rd(f.coefficients[0], num(1 - k)), pow(q, num(1 - k)));
                result = add(result, term);
                step(steps, k === 1 ? 'Integrate a linear fraction' : 'Integrate a repeated linear factor', format(term));
            } else {
                const [, b, c2] = f.factor.polynomial, c = f.factor.polynomial[0];
                const alpha = rd(f.coefficients[1], num(2)), beta = sub(f.coefficients[0], mul(alpha, b));
                const delta = sub(mul(num(4), c2, c), pow(b, num(2)));
                const linear = add(mul(num(2), sym(v)), b);
                let j;
                if (knownSign(delta) === -2) {
                    const root = call('sqrt', [neg(delta)]);
                    j = div(call('ln', [call('abs', [div(sub(linear, root), add(linear, root))])]), root);
                } else {
                    const root = call('sqrt', [delta]);
                    j = mul(div(num(2), root), call('atan', [div(linear, root)]));
                }
                for (let power = 2; power <= k; power++)
                    j = add(div(linear, mul(num(power - 1), delta, pow(q, num(power - 1)))), mul(div(num(2 * (2 * power - 3)), mul(num(power - 1), delta)), j));
                const logarithmic = k === 1 ? call('ln', [call('abs', [q])]) : div(pow(q, num(1 - k)), num(1 - k));
                const term = add(mul(alpha, logarithmic), mul(beta, j)); result = add(result, term);
                step(steps, k === 1 ? 'Integrate a quadratic fraction' : 'Reduce a repeated quadratic factor', format(term), 'Split the numerator into a denominator-derivative term and a standard quadratic integral.');
            }
        }
        return result;
    }
    function step(steps, title, math, explanation = '') { steps.push({ title, math, explanation }); }
    function differentiate(a, v, steps = []) {
        tick();
        if (!depends(a, v)) return zero();
        if (a.type === 'sym') return one();
        if (a.type === 'add') {
            step(steps, 'Sum rule', `d/d${v} (${format(a)})`, 'Differentiate each term separately.');
            return add(...a.args.map(t => differentiate(t, v, steps)));
        }
        if (a.type === 'mul') {
            step(steps, 'Product rule', '(f*g)\u2032 = f\u2032*g + f*g\u2032');
            return add(...a.args.map((t, i) => mul(differentiate(t, v, steps), ...a.args.filter((_, j) => i !== j))));
        }
        if (a.type === 'pow') {
            const u = a.base, n = a.exp, du = differentiate(u, v, steps);
            if (!depends(n, v)) {
                step(steps, 'Power and chain rules', `d/d${v} (u^n) = n*u^(n-1)*du/d${v}`);
                return mul(n, pow(u, sub(n, one())), du);
            }
            step(steps, 'Logarithmic differentiation', '(u^w)\u2032 = u^w*(w\u2032*ln(u)+w*u\u2032/u)', 'For a positive base in real mode.');
            return mul(a, add(mul(differentiate(n, v, steps), call('ln', [u])), div(mul(n, du), u)));
        }
        if (a.type === 'call' && functions.has(a.name)) {
            const u = a.args[0], du = differentiate(u, v, steps);
            let outer;
            switch (a.name) {
                case 'sin': outer = call('cos', [u]); break;
                case 'cos': outer = neg(call('sin', [u])); break;
                case 'tan': outer = pow(call('cos', [u]), num(-2)); break;
                case 'exp': outer = a; break;
                case 'ln': case 'log': outer = pow(u, num(-1)); break;
                case 'sqrt': outer = div(one(), mul(num(2), call('sqrt', [u]))); break;
                case 'asin': outer = pow(call('sqrt', [sub(one(), pow(u, num(2)))]), num(-1)); break;
                case 'acos': outer = neg(pow(call('sqrt', [sub(one(), pow(u, num(2)))]), num(-1))); break;
                case 'atan': outer = pow(add(one(), pow(u, num(2))), num(-1)); break;
                case 'abs': outer = div(u, call('abs', [u])); break;
                default: fail(`No differentiation rule for ${a.name}.`);
            }
            step(steps, 'Chain rule', `d/d${v} ${format(a)} = (${format(outer)})*(${format(du)})`, 'Multiply the outer derivative by the inner derivative; where the derivative exists.');
            return mul(outer, du);
        }
        fail(`Cannot differentiate ${format(a)}.`);
    }
    function primitive(a, variable) {
        if (a.type === 'sym' && a.name === variable) return div(pow(a, num(2)), num(2));
        if (a.type === 'pow' && a.base.type === 'sym' && a.base.name === variable && !depends(a.exp, variable)) {
            if (is(a.exp, -1)) return call('ln', [call('abs', [a.base])]);
            if (!isNum(a.exp)) requireCondition(add(a.exp, one()), 'nonzero');
            return div(pow(a.base, add(a.exp, one())), add(a.exp, one()));
        }
        if (a.type === 'call' && a.args[0]?.type === 'sym' && a.args[0].name === variable) {
            const u = a.args[0];
            switch (a.name) {
                case 'sin': return neg(call('cos', [u]));
                case 'cos': return call('sin', [u]);
                case 'exp': return a;
                case 'tan': return neg(call('ln', [call('abs', [call('cos', [u])])]));
                case 'ln': return sub(mul(u, a), u);
                case 'sqrt': return mul(num(2, 3), pow(u, num(3, 2)));
            }
        }
        return null;
    }
    function constantSlope(u, v) {
        const slope = simplify(differentiate(u, v));
        return !depends(slope, v) && !is(slope, 0) ? slope : null;
    }
    function trigFactor(a) {
        const f = a.type === 'pow' ? a.base : a, exponent = a.type === 'pow' ? a.exp : one();
        if (f.type !== 'call' || !['sin', 'cos', 'tan'].includes(f.name) || !isNum(exponent) || exponent.q !== 1n) return null;
        const n = Number(exponent.p);
        return Math.abs(n) <= 8 ? { name: f.name, argument: f.args[0], power: n } : null;
    }
    function integrateTrig(a, v, steps, depth) {
        const f = trigFactor(a);
        if (f && Math.abs(f.power) >= 2) {
            const slope = constantSlope(f.argument, v); if (!slope) return null;
            requireCondition(slope, 'nonzero');
            const s = call('sin', [f.argument]), c = call('cos', [f.argument]), n = f.power;
            if (f.name === 'tan' && n === 2) {
                step(steps, 'Trigonometric identity', 'tan(u)^2 = 1/cos(u)^2-1');
                return sub(div(call('tan', [f.argument]), slope), sym(v));
            }
            if (n === -2 && (f.name === 'sin' || f.name === 'cos')) {
                step(steps, 'Reciprocal trigonometric rule', `u = ${format(f.argument)}, du = (${format(slope)}) d${v}`);
                return f.name === 'cos' ? div(call('tan', [f.argument]), slope) : neg(div(c, mul(s, slope)));
            }
            if (n < 2 || f.name === 'tan') return null;
            if (n === 2) {
                step(steps, 'Power reduction', `${f.name}(u)^2 = (1${f.name === 'sin' ? '-' : '+'}cos(2*u))/2`);
                const oscillatory = div(call('sin', [mul(num(2), f.argument)]), mul(num(4), slope));
                return add(div(sym(v), num(2)), f.name === 'sin' ? neg(oscillatory) : oscillatory);
            }
            step(steps, 'Trigonometric power recurrence', `Reduce ${f.name}(u)^${n} to ${f.name}(u)^${n - 2}.`);
            const edge = div(mul(pow(f.name === 'sin' ? s : c, num(n - 1)), f.name === 'sin' ? c : s), mul(num(n), slope));
            return add(f.name === 'sin' ? neg(edge) : edge, mul(num(n - 1, n), integrate(pow(f.name === 'sin' ? s : c, num(n - 2)), v, steps, depth + 1)));
        }
        if (a.type !== 'mul' || a.args.length !== 2) return null;
        const left = trigFactor(a.args[0]), right = trigFactor(a.args[1]);
        if (!left || !right || left.name === 'tan' || right.name === 'tan' || left.power < 1 || right.power < 1) return null;
        if (left.power === 1 && right.power === 1) {
            const sum = add(left.argument, right.argument), difference = sub(left.argument, right.argument);
            let expression;
            if (left.name === 'sin' && right.name === 'sin') expression = sub(call('cos', [difference]), call('cos', [sum]));
            else if (left.name === 'cos' && right.name === 'cos') expression = add(call('cos', [difference]), call('cos', [sum]));
            else expression = add(call('sin', [sum]), (left.name === 'sin' ? x => x : neg)(call('sin', [difference])));
            step(steps, 'Product to sum', `${format(a)} = ${format(mul(num(1, 2), expression))}`);
            return mul(num(1, 2), integrate(expression, v, steps, depth + 1));
        }
        if (!same(left.argument, right.argument) || left.name === right.name || left.power + right.power > 12) return null;
        const sine = left.name === 'sin' ? left : right, cosine = left.name === 'cos' ? left : right;
        const slope = constantSlope(sine.argument, v); if (!slope) return null;
        requireCondition(slope, 'nonzero');
        const u = sym('__u');
        if (sine.power % 2 || cosine.power % 2) {
            const oddSine = sine.power % 2 === 1;
            const inner = call(oddSine ? 'cos' : 'sin', [sine.argument]);
            const polynomial = expand(mul(pow(u, num(oddSine ? cosine.power : sine.power)), pow(sub(one(), pow(u, num(2))), num(((oddSine ? sine.power : cosine.power) - 1) / 2))));
            step(steps, 'Trigonometric substitution', `u = ${format(inner)}`, 'Use sin(u)^2+cos(u)^2=1 to obtain a polynomial.');
            return mul(oddSine ? num(-1) : one(), div(basicSimplify(substitute(integrate(polynomial, '__u', steps, depth + 1), '__u', inner)), slope));
        }
        const doubled = call('cos', [mul(num(2), sine.argument)]);
        const expression = expand(mul(pow(div(sub(one(), doubled), num(2)), num(sine.power / 2)), pow(div(add(one(), doubled), num(2)), num(cosine.power / 2))));
        step(steps, 'Power reduction', format(expression));
        return integrate(expression, v, steps, depth + 1);
    }
    function integrate(a, v, steps, depth = 0) {
        tick(); if (depth > 12) fail('Integration rule nesting limit reached.');
        if (!depends(a, v)) {
            step(steps, 'Constant rule', `integral(${format(a)}) d${v} = ${format(mul(a, sym(v)))}`);
            return mul(a, sym(v));
        }
        if (a.type === 'add') {
            step(steps, 'Linearity', `integral(${format(a)}) d${v}`, 'Integrate each term and add the results.');
            return add(...a.args.map(t => integrate(t, v, steps, depth + 1)));
        }
        const direct = primitive(a, v);
        if (direct) {
            step(steps, a.type === 'pow' && is(a.exp, -1) ? 'Logarithm rule' : a.type === 'sym' || a.type === 'pow' ? 'Power rule' : 'Standard antiderivative', `integral(${format(a)}) d${v} = ${format(direct)}`);
            return direct;
        }
        const trigonometric = integrateTrig(a, v, steps, depth);
        if (trigonometric) return trigonometric;
        // A primitive of f(u) divided by a constant du/dx handles affine arguments.
        const u = a.type === 'call' ? a.args[0] : a.type === 'pow' && !depends(a.exp, v) ? a.base : null;
        if (u && depends(u, v)) {
            const slope = constantSlope(u, v);
            if (slope) {
                const placeholder = sym('__u');
                const template = a.type === 'pow' ? pow(placeholder, a.exp) : call(a.name, [placeholder]);
                const antiderivative = primitive(template, '__u');
                if (antiderivative) {
                    requireCondition(slope, 'nonzero');
                    step(steps, 'Substitution', `u = ${format(u)}, du = (${format(slope)}) d${v}`);
                    step(steps, 'Integrate in u', `integral(${format(template).replace(/__u/g, 'u')}) du = ${format(antiderivative).replace(/__u/g, 'u')}`);
                    const result = div(substitute(antiderivative, '__u', u), slope);
                    step(steps, 'Substitute back', format(result));
                    return result;
                }
            }
        }
        if (a.type === 'mul') {
            const constants = a.args.filter(t => !depends(t, v)), variables = a.args.filter(t => depends(t, v));
            if (constants.length) {
                step(steps, 'Constant multiple rule', `Take ${format(mul(...constants))} outside the integral.`);
                return mul(...constants, integrate(mul(...variables), v, steps, depth + 1));
            }
            // Match a factor f(g(x)) and the remaining multiple of g'(x).
            for (let i = 0; i < a.args.length; i++) {
                const f = a.args[i], inner = f.type === 'call' ? f.args[0] : f.type === 'pow' ? f.base : null;
                if (!inner || !depends(inner, v)) continue;
                const du = differentiate(inner, v);
                if (is(du, 0)) continue;
                const ratio = div(mul(...a.args.filter((_, j) => i !== j)), du);
                if (depends(ratio, v)) continue;
                const placeholder = sym('__u');
                const template = f.type === 'pow' ? pow(placeholder, f.exp) : call(f.name, [placeholder]);
                const antiderivative = primitive(template, '__u');
                if (!antiderivative) continue;
                step(steps, 'Substitution', `u = ${format(inner)}, du = (${format(du)}) d${v}`);
                step(steps, 'Integrate in u', `${format(ratio)} * integral(${format(template).replace(/__u/g, 'u')}) du`);
                const result = mul(ratio, substitute(antiderivative, '__u', inner));
                step(steps, 'Substitute back', format(result)); return result;
            }
            // Polynomial times sin/cos/exp with an affine argument: repeated parts.
            const transcendental = a.args.find(t => t.type === 'call' && ['sin', 'cos', 'exp'].includes(t.name));
            if (transcendental) {
                const polynomialPart = mul(...a.args.filter(t => t !== transcendental));
                const polynomial = polynomialCoefficients(polynomialPart, v);
                const slope = constantSlope(transcendental.args[0], v);
                if (polynomial && polynomial.length > 1 && polynomial.length <= 9 && slope) {
                    const antiderivative = integrate(transcendental, v, [], depth + 1);
                    step(steps, 'Integration by parts', `u = ${format(polynomialPart)}, dv = ${format(transcendental)} d${v}`, 'Use integral(u dv) = u*v - integral(v du).');
                    return sub(mul(polynomialPart, antiderivative), integrate(mul(antiderivative, differentiate(polynomialPart, v)), v, steps, depth + 1));
                }
            }
        }
        const rational = integrateRational(a, v, steps, depth);
        if (rational) return rational;
        fail(`No integration rule is implemented for ${format(a)} yet. Try expanding the expression or a substitution.`);
    }
    function expand(a) {
        tick();
        if (a.type === 'add') return add(...a.args.map(expand));
        function distribute(a, b) {
            tick();
            if (a.type === 'add') return add(...a.args.map(t => distribute(t, b)));
            if (b.type === 'add') return add(...b.args.map(t => distribute(a, t)));
            return mul(a, b);
        }
        if (a.type === 'mul') return a.args.map(expand).reduce(distribute, one());
        if (a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n && a.exp.p >= 0n && a.exp.p <= 16n) {
            const base = expand(a.base); let result = one();
            for (let n = 0n; n < a.exp.p; n++) result = distribute(result, base);
            return result;
        }
        return a;
    }
    function polynomialCoefficients(a, v) {
        a = expand(a); const coefficients = [];
        for (const term of a.type === 'add' ? a.args : [a]) {
            let degree = 0, coefficient = one();
            for (const f of term.type === 'mul' ? term.args : [term]) {
                if (!depends(f, v)) coefficient = mul(coefficient, f);
                else if (f.type === 'sym' && f.name === v) degree++;
                else if (f.type === 'pow' && f.base.type === 'sym' && f.base.name === v && isNum(f.exp) && f.exp.q === 1n && f.exp.p >= 0n && f.exp.p <= 16n) degree += Number(f.exp.p);
                else return null;
            }
            if (degree > 16) return null;
            coefficients[degree] = add(coefficients[degree] || zero(), coefficient);
        }
        for (let i = 0; i < coefficients.length; i++) coefficients[i] ||= zero();
        while (coefficients.length > 1 && is(coefficients.at(-1), 0)) coefficients.pop();
        return coefficients;
    }
    function solve(a, v, steps) {
        const expression = a.type === 'eq' ? sub(a.args[0], a.args[1]) : a;
        const c = polynomialCoefficients(expression, v);
        if (!c || c.length > 3 || c.some(t => !isNum(t))) fail('solve currently supports linear and quadratic polynomials with numeric coefficients.');
        step(steps, 'Collect terms', `${format(expand(expression))} = 0`);
        if (c.length === 1) return { type: 'text', value: is(c[0], 0) ? 'All real values' : 'No solutions' };
        if (c.length === 2) {
            const result = div(neg(c[0]), c[1]);
            step(steps, 'Isolate the variable', `${v} = -(${format(c[0])})/(${format(c[1])})`);
            return { type: 'list', args: [{ type: 'eq', args: [sym(v), result] }] };
        }
        const discriminant = sub(pow(c[1], num(2)), mul(num(4), c[2], c[0]));
        step(steps, 'Discriminant', `b^2-4*a*c = ${format(discriminant)}`);
        if (discriminant.p < 0n) return { type: 'text', value: 'No real solutions' };
        step(steps, 'Quadratic formula', `${v} = (-b +/- sqrt(b^2-4*a*c))/(2*a)`);
        const radical = call('sqrt', [discriminant]), denominator = mul(num(2), c[2]);
        const roots = [div(add(neg(c[1]), radical), denominator), div(sub(neg(c[1]), radical), denominator)];
        return { type: 'list', args: (same(roots[0], roots[1]) ? roots.slice(0, 1) : roots).map(r => ({ type: 'eq', args: [sym(v), r] })) };
    }
    function approximate(a, variables = {}) {
        tick();
        if (isNum(a)) {
            const value = Number(a.p) / Number(a.q);
            if (!Number.isFinite(value)) fail('Number is outside the finite numeric range.');
            return value;
        }
        if (a.type === 'sym') {
            if (a.name === 'pi') return Math.PI;
            if (a.name === 'e') return Math.E;
            if (Object.hasOwn(variables, a.name)) return variables[a.name];
            fail(`Give ${a.name} a value with subst(expression,${a.name},value) before approximating.`);
        }
        let result;
        if (a.type === 'add') result = a.args.reduce((n, t) => n + approximate(t, variables), 0);
        else if (a.type === 'mul') result = a.args.reduce((n, t) => n * approximate(t, variables), 1);
        else if (a.type === 'pow') {
            const base = approximate(a.base, variables), exponent = approximate(a.exp, variables);
            result = base < 0 && isNum(a.exp) && a.exp.q % 2n === 1n
                ? (a.exp.p % 2n ? -1 : 1) * ((-base) ** exponent) : base ** exponent;
        }
        else if (a.type === 'call' && functions.has(a.name)) {
            const fn = a.name === 'ln' || a.name === 'log' ? Math.log : Math[a.name];
            const input = approximate(a.args[0], variables);
            if (a.name === 'tan' && Math.abs(Math.cos(input)) < 1e-14) fail('tan is undefined at this angle.');
            result = fn(input);
        } else fail('This expression cannot be approximated.');
        if (!Number.isFinite(result)) fail('The expression is undefined or outside the finite real range.');
        return result;
    }
    function rangeOn(a, v, lower, upper) {
        tick();
        if (!depends(a, v)) { try { const n = approximate(a); return [n, n]; } catch { return null; } }
        if (a.type === 'sym' && a.name === v) return [lower, upper];
        const rational = rationalPolynomial(a, v);
        if (rational && rational[1].length === 1 && rational[0].length <= 3) {
            const exact = pscale(rational[0], rd(one(), rational[1][0]));
            if (calculation.intervalBounds) {
                const compare = (a, b) => a.p * b.q - b.p * a.q;
                const value = x => ra(ra(rm(exact[2] || zero(), rm(x, x)), rm(exact[1] || zero(), x)), exact[0]);
                const [lo, hi] = calculation.intervalBounds, values = [value(lo), value(hi)];
                if (exact[2] && !is(exact[2], 0)) {
                    const vertex = rd(rn(exact[1] || zero()), rm(num(2), exact[2]));
                    if (compare(vertex, lo) >= 0n && compare(vertex, hi) <= 0n) values.push(value(vertex));
                }
                values.sort((a, b) => compare(a, b) < 0n ? -1 : compare(a, b) > 0n ? 1 : 0);
                const result = [Number(values[0].p) / Number(values[0].q), Number(values.at(-1).p) / Number(values.at(-1).q)];
                return result.every(Number.isFinite) ? result : null;
            }
            const p = exact.map(c => Number(c.p) / Number(c.q));
            const value = x => (p[2] || 0) * x * x + (p[1] || 0) * x + p[0];
            const values = [value(lower), value(upper)];
            if (p[2]) { const vertex = -p[1] / (2 * p[2]); if (vertex >= lower && vertex <= upper) values.push(value(vertex)); }
            const magnitude = Math.max(Math.abs(lower), Math.abs(upper));
            const error = 64 * Number.EPSILON * (1 + Math.abs(p[0]) + Math.abs(p[1] || 0) * magnitude + Math.abs(p[2] || 0) * magnitude ** 2);
            return values.every(Number.isFinite) && Number.isFinite(error) ? [Math.min(...values) - error, Math.max(...values) + error] : null;
        }
        if (a.type === 'add' || a.type === 'mul') {
            let out = a.type === 'add' ? [0, 0] : [1, 1];
            for (const t of a.args) {
                const r = rangeOn(t, v, lower, upper); if (!r) return null;
                if (a.type === 'add') out = [out[0] + r[0], out[1] + r[1]];
                else { const p = [out[0] * r[0], out[0] * r[1], out[1] * r[0], out[1] * r[1]]; out = [Math.min(...p), Math.max(...p)]; }
            }
            return out.every(Number.isFinite) ? out : null;
        }
        if (a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n) {
            const r = rangeOn(a.base, v, lower, upper), n = Number(a.exp.p); if (!r) return null;
            if (n < 0 && r[0] <= 0 && r[1] >= 0) return null;
            const values = [r[0] ** n, r[1] ** n];
            if (n > 0 && n % 2 === 0 && r[0] <= 0 && r[1] >= 0) values.push(0);
            return values.every(Number.isFinite) ? [Math.min(...values), Math.max(...values)] : null;
        }
        if (a.type === 'call' && ['sin', 'cos'].includes(a.name)) {
            const r = rangeOn(a.args[0], v, lower, upper); if (!r) return null;
            if (Math.max(Math.abs(r[0]), Math.abs(r[1])) > 1e12) return [-1, 1];
            if (r[1] - r[0] >= 2 * Math.PI) return [-1, 1];
            const fn = Math[a.name], values = r.map(fn), offset = a.name === 'sin' ? Math.PI / 2 : 0;
            for (let k = Math.ceil((r[0] - offset) / Math.PI); k <= Math.floor((r[1] - offset) / Math.PI); k++) values.push(k % 2 ? -1 : 1);
            return [Math.min(...values), Math.max(...values)];
        }
        return null;
    }
    // Conservative interval bounds retain the original expression's holes and
    // reject intervals containing poles. No sample-point evidence is used as proof.
    function continuousOn(a, v, lower, upper) {
        tick();
        if (a.type === 'guarded') return continuousOn(a.expression, v, lower, upper);
        if (!depends(a, v)) return true; // Any parameter restrictions remain explicit conditions.
        if (a.type === 'sym') return a.name === v;
        if (a.type === 'add' || a.type === 'mul') return a.args.every(t => continuousOn(t, v, lower, upper));
        if (a.type === 'pow' && isNum(a.exp) && continuousOn(a.base, v, lower, upper)) {
            if (a.exp.q === 1n && a.exp.p >= 0n) return true;
            if (knownSign(a.base) === 2) return true;
            const range = rangeOn(a.base, v, lower, upper), margin = range ? 1e-12 * Math.max(1, Math.abs(range[0]), Math.abs(range[1])) : 0;
            if (!range) return false;
            if (a.exp.q % 2n === 1n) return a.exp.p >= 0n || range[0] > margin || range[1] < -margin;
            return a.exp.p < 0n ? range[0] > margin : range[0] >= 0;
        }
        if (a.type === 'call' && continuousOn(a.args[0], v, lower, upper)) {
            if (['sin', 'cos', 'exp', 'abs', 'atan'].includes(a.name)) return true;
            const range = rangeOn(a.args[0], v, lower, upper); if (!range) return false;
            if (a.name === 'ln') return range[0] > 0;
            if (a.name === 'sqrt') return range[0] >= 0;
            if (a.name === 'tan') return Math.max(Math.abs(range[0]), Math.abs(range[1])) <= 1e12 && Math.floor((range[0] + Math.PI / 2) / Math.PI) === Math.floor((range[1] + Math.PI / 2) / Math.PI) && Math.abs(Math.cos(range[0])) > 1e-12 && Math.abs(Math.cos(range[1])) > 1e-12;
        }
        return false;
    }
    function conditionOnInterval(guard, v, lower, upper) {
        if (!depends(guard.expression, v)) return true;
        const sign = knownSign(guard.expression);
        if (guard.relation === 'nonzero' && Math.abs(sign) === 2 || guard.relation === 'positive' && sign === 2 || guard.relation === 'nonnegative' && sign >= 0) return true;
        const range = rangeOn(guard.expression, v, lower, upper); if (!range) return false;
        const margin = 1e-12 * Math.max(1, Math.abs(range[0]), Math.abs(range[1]));
        if (guard.relation === 'nonzero') return range[0] > margin || range[1] < -margin;
        return guard.relation === 'positive' ? range[0] > margin : range[0] >= 0;
    }
    function variable(a) {
        if (a?.type !== 'sym' || ['pi', 'e', 'ans', '__u'].includes(a.name)) fail('Choose a variable such as x or t.');
        return a.name;
    }
    function evaluate(a, steps) {
        tick();
        function scalar(a) {
            const result = evaluate(a, steps);
            if (result.type === 'antiderivative') return result.expression;
            if (result.type === 'text' && result.numeric) return parse(result.value);
            if (['text', 'list'].includes(result.type)) fail('This command does not return a scalar expression.');
            return result;
        }
        if (a.type === 'guarded') {
            for (const guard of a.guards) requireCondition(scalar(guard.expression), guard.relation);
            return scalar(a.expression);
        }
        if (a.type === 'pow') {
            const base = scalar(a.base), exponent = scalar(a.exp);
            powerDomain(base, exponent); return pow(base, exponent);
        }
        if (a.type === 'sym' || isNum(a)) return a;
        if (a.type !== 'call' || !commands.has(a.name)) {
            if (a.type === 'eq') fail('Use solve(equation,x) to solve an equation.');
            const args = a.args.map(scalar);
            if (a.type === 'call' && functions.has(a.name)) {
                if (args.length !== 1) fail(`${a.name} expects one argument.`);
                functionDomain(a.name, args[0]);
            }
            return rebuild(a, args);
        }
        const args = a.args, name = a.name === 'integral' ? 'integrate' : a.name;
        const arities = { integrate: [2, 4], diff: [2], d: [2], solve: [2], subst: [3], simplify: [1], expand: [1], factor: [1, 2], approx: [1], numeric: [1], verify: [3] };
        if (!arities[name].includes(args.length)) fail(`${name} expects ${arities[name].join(' or ')} arguments.`);
        const v = name === 'verify' ? variable(args[2]) : ['integrate', 'diff', 'd', 'solve', 'subst'].includes(name) || name === 'factor' && args.length === 2 ? variable(args[1]) : 'x';
        const previousConditions = name === 'integrate' ? new Map(calculation.conditions) : null;
        if (name === 'integrate') calculation.conditions = new Map();
        if (name === 'solve') {
            function originalPolynomial(a) {
                if (!depends(a, v)) return true;
                if (a.type === 'sym') return true;
                if (['add', 'mul', 'eq'].includes(a.type)) return a.args.every(originalPolynomial);
                if (a.type === 'pow') {
                    const exponent = scalar(a.exp);
                    return isNum(exponent) && exponent.q === 1n && exponent.p >= 0n && originalPolynomial(a.base);
                }
                return false;
            }
            if (!originalPolynomial(args[0])) fail('solve currently requires a polynomial equation without variable denominators.');
            const equation = args[0].type === 'eq' ? { ...args[0], args: args[0].args.map(t => evaluate(t, steps)) } : evaluate(args[0], steps);
            return solve(equation, v, steps);
        }
        if (name === 'subst') {
            const result = evaluate(substitute(args[0], v, scalar(args[2])), steps);
            if (result.type === 'text' && result.numeric) return parse(result.value);
            if (['text', 'list'].includes(result.type)) fail('Substitution expects a scalar expression or antiderivative.');
            return result;
        }
        const expression = scalar(args[0]);
        if (name === 'diff' || name === 'd') return scalar(differentiate(expression, v, steps));
        function verify(result, original) {
            const proof = proveDerivative(result, original, v);
            const report = { status: proof.proved ? 'proved' : 'not-proved', variable: v, method: proof.method, residual: proof.residual };
            calculation.checks.push(report);
            step(steps, 'Differentiate to check', `d/d${v} (${format(result)}) = ${format(proof.derivative)}`,
                proof.proved ? `Verified symbolically: dF/d${v} - f = 0 on the stated domain.` : 'Symbolic equality was not established.');
            return proof.proved;
        }
        if (name === 'verify') return { type: 'text', value: verify(expression, scalar(args[1])) ? 'Verified' : 'Not proved' };
        if (name === 'integrate') {
            function finish(value) {
                const guards = [...calculation.conditions.values()];
                calculation.conditions = previousConditions;
                for (const guard of guards) requireCondition(guard.expression, guard.relation);
                return value;
            }
            const result = integrate(expression, v, steps);
            if (!verify(result, expression)) fail('An antiderivative was found, but its derivative could not be verified symbolically. No unverified answer has been returned.');
            if (args.length === 2) return finish({ type: 'antiderivative', expression: result });
            const lo = evaluate(args[2], steps), hi = evaluate(args[3], steps);
            const lower = approximate(lo), upper = approximate(hi);
            if (isNum(lo) && isNum(hi) && !same(lo, hi) && lower === upper)
                fail('The bounds cannot be distinguished at the available numerical precision.');
            // Preserve input denominators even when algebra cancels a factor.
            function domainTree(a) {
                if (a.type === 'guarded') return { ...a, expression: domainTree(a.expression) };
                if (a.type === 'pow') return { ...a, base: domainTree(a.base), exp: scalar(a.exp) };
                if (a.args) return { ...a, args: a.args.map(domainTree) };
                return a;
            }
            const outerBounds = calculation.intervalBounds;
            calculation.intervalBounds = isNum(lo) && isNum(hi) ? (lower <= upper ? [lo, hi] : [hi, lo]) : null;
            let continuous;
            try {
                continuous = continuousOn(domainTree(args[0]), v, Math.min(lower, upper), Math.max(lower, upper)) &&
                    [...calculation.conditions.values()].every(g => conditionOnInterval(g, v, Math.min(lower, upper), Math.max(lower, upper)));
            } finally { calculation.intervalBounds = outerBounds; }
            if (!continuous)
                fail('Cannot certify continuity over this interval. Improper integrals and intervals containing singularities are not supported.');
            const value = sub(scalar(substitute(result, v, hi)), scalar(substitute(result, v, lo)));
            for (const [k, condition] of calculation.conditions) if (depends(condition.expression, v)) calculation.conditions.delete(k);
            step(steps, 'Apply the bounds', `F(${format(hi)})-F(${format(lo)}) = ${format(value)}`);
            return finish(value);
        }
        if (name === 'approx' || name === 'numeric') {
            const value = approximate(expression);
            return { type: 'text', value: Number(value.toPrecision(12)).toString(), numeric: true };
        }
        if (name === 'expand') {
            const result = expand(expression);
            step(steps, 'Distribute products and powers', `${format(expression)} = ${format(result)}`); return result;
        }
        if (name === 'factor') {
            const c = polynomialCoefficients(expression, v);
            if (!c || c.length !== 3 || c.some(t => !isNum(t))) fail('factor currently supports quadratic polynomials with rational coefficients.');
            const discriminant = sub(pow(c[1], num(2)), mul(num(4), c[2], c[0]));
            if (discriminant.p < 0n) return expression;
            const radical = call('sqrt', [discriminant]);
            if (!isNum(radical)) { step(steps, 'Rational factorization', 'No linear factors over the rationals.'); return expression; }
            const r1 = div(add(neg(c[1]), radical), mul(num(2), c[2]));
            const r2 = div(sub(neg(c[1]), radical), mul(num(2), c[2]));
            const result = mul(c[2], sub(sym(v), r1), sub(sym(v), r2));
            step(steps, 'Factor from the roots', `${format(expression)} = ${format(result)}`); return result;
        }
        const simplified = simplify(expression);
        step(steps, 'Simplify algebraically', format(simplified), 'Original domain restrictions are retained after cancellation.'); return simplified;
    }
    function createSession() {
        let answer = null;
        return {
            run(source) {
                remaining = OPERATION_LIMIT;
                calculation = { conditions: new Map(), checks: [] };
                const steps = [];
                let tree = parse(source);
                if (depends(tree, 'ans')) {
                    if (!answer) fail('There is no previous expression result to recall.');
                    tree = substitute(tree, 'ans', { type: 'guarded', expression: answer.expression, guards: answer.guards });
                }
                const result = evaluate(tree, steps);
                const resultText = result.type === 'text' ? result.value : result.type === 'antiderivative' ? format(result.expression) + '+C' : format(result);
                // ans holds a reusable expression, excluding the arbitrary integration constant.
                let nextAnswer = null;
                if (result.type === 'antiderivative') nextAnswer = result.expression;
                else if (!['text', 'list'].includes(result.type)) nextAnswer = result;
                else if (result.numeric) nextAnswer = parse(result.value);
                if (nextAnswer) answer = { expression: nextAnswer, guards: [...calculation.conditions.values()] };
                const conditions = [...calculation.conditions.values()].map(conditionText);
                const checks = calculation.checks;
                return { input: source, result: resultText, steps, conditions, checks, verification: checks.at(-1) || null,
                    verified: checks.length ? checks.every(c => c.status === 'proved') : null,
                    note: 'Finite real variables; radians. Results apply under the stated domain conditions. Verification is symbolic, not numerical sampling.' };
            },
            clear() { answer = null; }
        };
    }
    const api = { createSession };
    if (typeof window !== 'undefined') window.SpectrumCAS = api;
    else root.exports = api;
})(typeof module === 'object' ? module : {});
