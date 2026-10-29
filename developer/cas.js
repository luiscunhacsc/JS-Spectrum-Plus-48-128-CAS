/* Spectrum CAS: a bounded, offline symbolic engine. No JavaScript evaluation. */
(function (root) {
    'use strict';
    let remaining = 30000;
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
            default: return `${a.name || a.type}(${a.args.map(key).join(',')})`;
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
            // Only combine integer powers: fractional powers have branch restrictions.
            const integerPower = a.type === 'pow' && isNum(a.exp) && a.exp.q === 1n;
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
        if (is(exp, 0)) return one();
        if (is(exp, 1) || is(base, 1)) return base;
        if (isNum(base) && isNum(exp) && exp.q === 1n) {
            const n = exp.p < 0n ? -exp.p : exp.p;
            if (n > 512n) fail('Exact powers are limited to an exponent of 512.');
            return exp.p < 0n ? num(base.q ** n, base.p ** n) : num(base.p ** n, base.q ** n);
        }
        if (base.type === 'pow' && isNum(exp) && exp.q === 1n && isNum(base.exp) && base.exp.q === 1n)
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
        }
        if (name === 'abs' && isNum(a)) return num(a.p < 0n ? -a.p : a.p, a.q);
        if (name === 'ln' && is(a, 1)) return zero();
        if (name === 'ln' && a.type === 'sym' && a.name === 'e') return one();
        if (name === 'ln' && isNum(a) && a.p <= 0n) fail('ln requires a positive argument in real mode.');
        if (name === 'exp' && is(a, 0)) return one();
        if ((name === 'sin' || name === 'cos') && is(a, 0)) return num(name === 'cos' ? 1 : 0);
        if ((name === 'tan' || name === 'asin' || name === 'atan') && is(a, 0)) return zero();
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
    const commands = new Set(['integrate', 'integral', 'diff', 'd', 'simplify', 'expand', 'factor', 'solve', 'approx', 'numeric', 'subst']);

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
        if (a.type === 'sym') return a.name === variable;
        if (a.type === 'pow') return depends(a.base, variable) || depends(a.exp, variable);
        return !!a.args?.some(t => depends(t, variable));
    }
    function substitute(a, variable, value) {
        tick();
        if (a.type === 'sym') return a.name === variable ? value : a;
        if (a.type === 'pow') return pow(substitute(a.base, variable, value), substitute(a.exp, variable, value));
        if (a.args) return { ...a, args: a.args.map(t => substitute(t, variable, value)) };
        return a;
    }
    function rebuild(a, args) {
        return a.type === 'add' ? add(...args) : a.type === 'mul' ? mul(...args)
            : a.type === 'call' ? call(a.name, args) : { ...a, args };
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
        if (a.type === 'pow' && a.base.type === 'sym' && a.base.name === variable && isNum(a.exp)) {
            return is(a.exp, -1) ? call('ln', [call('abs', [a.base])]) : div(pow(a.base, add(a.exp, one())), add(a.exp, one()));
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
        // A primitive of f(u) divided by a constant du/dx handles affine arguments.
        const u = a.type === 'call' ? a.args[0] : a.type === 'pow' && !depends(a.exp, v) ? a.base : null;
        if (u && depends(u, v)) {
            const slope = differentiate(u, v);
            if (isNum(slope) && !is(slope, 0)) {
                const placeholder = sym('__u');
                const template = a.type === 'pow' ? pow(placeholder, a.exp) : call(a.name, [placeholder]);
                const antiderivative = primitive(template, '__u');
                if (antiderivative) {
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
                const slope = differentiate(transcendental.args[0], v);
                if (polynomial && polynomial.length > 1 && polynomial.length <= 9 && isNum(slope) && !is(slope, 0)) {
                    const antiderivative = integrate(transcendental, v, [], depth + 1);
                    step(steps, 'Integration by parts', `u = ${format(polynomialPart)}, dv = ${format(transcendental)} d${v}`, 'Use integral(u dv) = u*v - integral(v du).');
                    return sub(mul(polynomialPart, antiderivative), integrate(mul(antiderivative, differentiate(polynomialPart, v)), v, steps, depth + 1));
                }
            }
        }
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
        else if (a.type === 'pow') result = approximate(a.base, variables) ** approximate(a.exp, variables);
        else if (a.type === 'call' && functions.has(a.name)) {
            const fn = a.name === 'ln' || a.name === 'log' ? Math.log : Math[a.name];
            const input = approximate(a.args[0], variables);
            if (a.name === 'tan' && Math.abs(Math.cos(input)) < 1e-14) fail('tan is undefined at this angle.');
            result = fn(input);
        } else fail('This expression cannot be approximated.');
        if (!Number.isFinite(result)) fail('The expression is undefined or outside the finite real range.');
        return result;
    }
    // Conservatively prove continuity before applying F(b)-F(a). No sampling through poles.
    function continuousOn(a, v, lower, upper) {
        tick();
        if (!depends(a, v)) { try { approximate(a); return true; } catch { return false; } }
        if (a.type === 'sym') return a.name === v;
        if (a.type === 'add' || a.type === 'mul') return a.args.every(t => continuousOn(t, v, lower, upper));
        function affineRange(u) {
            const derivative = differentiate(u, v);
            if (depends(derivative, v)) return null;
            try { return [approximate(u, { [v]: lower }), approximate(u, { [v]: upper })].sort((a, b) => a - b); }
            catch { return null; }
        }
        if (a.type === 'pow' && isNum(a.exp) && continuousOn(a.base, v, lower, upper)) {
            if (a.exp.q === 1n && a.exp.p >= 0n) return true;
            const range = affineRange(a.base);
            return !!range && (a.exp.q === 1n ? range[0] * range[1] > 0 : range[0] > 0);
        }
        if (a.type === 'call' && continuousOn(a.args[0], v, lower, upper)) {
            if (['sin', 'cos', 'exp', 'abs', 'atan'].includes(a.name)) return true;
            const range = affineRange(a.args[0]); if (!range) return false;
            if (a.name === 'ln') return range[0] > 0;
            if (a.name === 'sqrt') return range[0] >= 0;
            if (a.name === 'tan') return Math.floor((range[0] + Math.PI / 2) / Math.PI) === Math.floor((range[1] + Math.PI / 2) / Math.PI) && Math.abs(Math.cos(range[0])) > 1e-14 && Math.abs(Math.cos(range[1])) > 1e-14;
        }
        return false;
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
        if (a.type === 'pow') return pow(scalar(a.base), scalar(a.exp));
        if (a.type === 'sym' || isNum(a)) return a;
        if (a.type !== 'call' || !commands.has(a.name)) {
            if (a.type === 'eq') fail('Use solve(equation,x) to solve an equation.');
            return rebuild(a, a.args.map(scalar));
        }
        const args = a.args, name = a.name === 'integral' ? 'integrate' : a.name;
        const arities = { integrate: [2, 4], diff: [2], d: [2], solve: [2], subst: [3], simplify: [1], expand: [1], factor: [1, 2], approx: [1], numeric: [1] };
        if (!arities[name].includes(args.length)) fail(`${name} expects ${arities[name].join(' or ')} arguments.`);
        const v = ['integrate', 'diff', 'd', 'solve', 'subst'].includes(name) || name === 'factor' && args.length === 2 ? variable(args[1]) : 'x';
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
        if (name === 'subst') return scalar(substitute(args[0], v, scalar(args[2])));
        const expression = scalar(args[0]);
        if (name === 'diff' || name === 'd') return differentiate(expression, v, steps);
        if (name === 'integrate') {
            const result = integrate(expression, v, steps);
            const derivative = differentiate(result, v);
            step(steps, 'Differentiate to check', `d/d${v} (${format(result)}) = ${format(derivative)}`);
            if (args.length === 2) return { type: 'antiderivative', expression: result };
            const lo = evaluate(args[2], steps), hi = evaluate(args[3], steps);
            const lower = approximate(lo), upper = approximate(hi);
            // Preserve input denominators even when algebra cancels a factor.
            function domainTree(a) {
                if (a.type === 'pow') return { ...a, base: domainTree(a.base), exp: scalar(a.exp) };
                if (a.args) return { ...a, args: a.args.map(domainTree) };
                return a;
            }
            if (!continuousOn(domainTree(args[0]), v, Math.min(lower, upper), Math.max(lower, upper)))
                fail('Cannot certify continuity over this interval. Improper integrals and intervals containing singularities are not supported.');
            const value = sub(scalar(substitute(result, v, hi)), scalar(substitute(result, v, lo)));
            step(steps, 'Apply the bounds', `F(${format(hi)})-F(${format(lo)}) = ${format(value)}`);
            return value;
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
        step(steps, 'Collect like terms', format(expression)); return expression;
    }
    function createSession() {
        let answer = null;
        return {
            run(source) {
                remaining = 30000;
                const steps = [];
                let tree = parse(source);
                if (depends(tree, 'ans')) {
                    if (!answer) fail('There is no previous expression result to recall.');
                    tree = substitute(tree, 'ans', answer);
                }
                const result = evaluate(tree, steps);
                const resultText = result.type === 'text' ? result.value : result.type === 'antiderivative' ? format(result.expression) + '+C' : format(result);
                // ans holds a reusable expression, excluding the arbitrary integration constant.
                if (result.type === 'antiderivative') answer = result.expression;
                else if (!['text', 'list'].includes(result.type)) answer = result;
                else if (result.numeric) answer = parse(result.value);
                return { input: source, result: resultText, steps, note: 'Real variables; radians. Results hold where the original expression and the applied rules are defined.' };
            },
            clear() { answer = null; }
        };
    }
    const api = { createSession };
    if (typeof window !== 'undefined') window.SpectrumCAS = api;
    else root.exports = api;
})(typeof module === 'object' ? module : {});
