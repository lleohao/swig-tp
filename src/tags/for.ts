import { CompileFunction, ParseFunction } from './index';
import { TYPES as types } from '../lexer';
const ctx = '_ctx.',
    ctxloop = ctx + 'loop';

/**
 * Loop over objects and arrays.
 *
 * @alias for
 *
 * @example
 * // obj = { one: 'hi', two: 'bye' };
 * {% for x in obj %}
 *   {% if loop.first %}<ul>{% endif %}
 *   <li>{{ loop.index }} - {{ loop.key }}: {{ x }}</li>
 *   {% if loop.last %}</ul>{% endif %}
 * {% endfor %}
 * // => <ul>
 * //    <li>1 - one: hi</li>
 * //    <li>2 - two: bye</li>
 * //    </ul>
 *
 * @example
 * // arr = [1, 2, 3]
 * // Reverse the array, shortcut the key/index to `key`
 * {% for key, val in arr|reverse %}
 * {{ key }} -- {{ val }}
 * {% endfor %}
 * // => 0 -- 3
 * //    1 -- 2
 * //    2 -- 1
 *
 *
 * @param compiler
 * @param args
 * @param content
 * @param parents
 * @param options
 * @param blockName
 * @return {loop.index} The current iteration of the loop (1-indexed)
 * @return {loop.index0} The current iteration of the loop (0-indexed)
 * @return {loop.revindex} The number of iterations from the end of the loop (1-indexed)
 * @return {loop.revindex0} The number of iterations from the end of the loop (0-indexed)
 * @return {loop.key} If the iterator is an object, this will be the key of the current item, otherwise it will be the same as the loop.index.
 * @return {loop.first} True if the current object is the first in the object or array.
 * @return {loop.last} True if the current object is the last in the object or array.
 */
const compile: CompileFunction = function (compiler, args: string[], content, parents, options, blockName) {
    let val = args.shift(),
        key = '__k',
        ctxloopcache = (ctx + '__loopcache' + Math.random()).replace(/\./g, ''),
        last;

    if (args[0] && args[0] === ',') {
        args.shift();
        key = val;
        val = args.shift();
    }

    last = args.join('');

    return [
        '(function () {\n',
        '   var __l = ' + last + ', __len = (_utils.isArray(__l) || typeof __l === "string") ? __l.length : _utils.keys(__l).length;\n',
        '   if(!__l) { return; };\n',
        '       var ' + ctxloopcache + ' = { loop: ' + ctxloop + ', ' + val + ': ' + ctx + val + ', ' + key + ': ' + ctx + key + ' };\n',
        '   ' + ctxloop + ' = {first: false, index: 1, index0: 0, revindex: __len, revindex0: __len - 1, length: __len, last: false };\n',
        '   _utils.each(__l, function(' + val + ', ' + key + ') {\n',
        '   ' + ctx + val + ' = ' + val + ';\n',
        '    ' + ctx + key + ' = ' + key + ';\n',
        '    ' + ctxloop + '.key = ' + key + ';\n',
        '    ' + ctxloop + '.first = (' + ctxloop + '.index0 === 0);\n',
        '    ' + ctxloop + '.last = (' + ctxloop + '.revindex0 === 0);\n',
        '    ' + compiler(content, parents, options, blockName),
        '    ' + ctxloop + '.index += 1; ' + ctxloop + '.index0 += 1; ' + ctxloop + '.revindex -= 1; ' + ctxloop + '.revindex0 -= 1;\n',
        '  });\n',
        '  ' + ctxloop + ' = ' + ctxloopcache + '.loop;\n',
        '  ' + ctx + val + ' = ' + ctxloopcache + '.' + val + ';\n',
        '  ' + ctx + key + ' = ' + ctxloopcache + '.' + key + ';\n',
        '  ' + ctxloopcache + ' = undefined;\n',
        '})();\n'
    ].join('');
}

const parse: ParseFunction = function (str, line, parser) {
    let firstVar, ready;

    parser.on(types.NUMBER, function (token) {
        let lastState = this.state.length ? this.state[this.state.length - 1] : null;
        if (!ready ||
            (lastState !== types.ARRAYOPEN &&
                lastState !== types.CURLYOPEN &&
                lastState !== types.CURLYCLOSE &&
                lastState !== types.FUNCTION &&
                lastState !== types.FILTER)) {
            throw new Error('Unexpected number "' + token.match + '" on line ' + line + '.');
        }
        return true;
    });

    parser.on(types.VAR, function (token) {
        if (ready && firstVar) {
            return true;
        }

        if (!this.out.length) {
            firstVar = true;
        }

        this.out.push(token.match);
    });

    parser.on(types.COMMA, function (token) {
        if (firstVar && this.prevToken.type === types.VAR) {
            this.out.push(token.match);
            return;
        }

        return true;
    });

    parser.on(types.COMPARATOR, function (token) {
        if (token.match !== 'in' || !firstVar) {
            throw new Error('Unexpected token "' + token.match + '" on line ' + line + '.');
        }
        ready = true;
        this.filterApplyIdx.push(this.out.length);
    });

    return true;
}

export default {
    compile: compile,
    parse: parse,
    ends: true
}