import * as utils from './utils';
import * as lexer from './lexer';
import { Swig, SwigOptions } from './swig';
import { LexerToken } from './lexer';

const _t = lexer.types;
const _reserved = ['break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with'];

/**
 * Filters are simply function that perform transformations on their first input argument.
 * Filter are run at render time, so they may not directly modify the compiled template structure in any way.
 * All of Swig's built-in filters are written in this same way. For more example, reference the 'filters.js' file in Swig's source.
 * 
 * To disabled auto-escaping on a custom filter, simply add a property to the filter method `safe = true;` and the output from this will not be escaped, no metter what the global settings are for Swig.
 *
 *  @typedef {function} Filter
 *
 * @example
 * // This filter will return 'bazbop' if the idx on the input is not 'foobar'
 * swig.setFilter('foobar', function (input, idx) {
 *   return input[idx] === 'foobar' ? input[idx] : 'bazbop';
 * });
 * // myvar = ['foo', 'bar', 'baz', 'bop'];
 * // => {{ myvar|foobar(3) }}
 * // Since myvar[3] !== 'foobar', we render:
 * // => bazbop
 *
 * @example
 * // This filter will disable auto-escaping on its output:
 * function bazbop (input) { return input; }
 * bazbop.safe = true;
 * swig.setFilter('bazbop', bazbop);
 * // => {{ "<p>"|bazbop }}
 * // => <p>
 *
 * @param {*} input Input argument, automatically sent from Swig's built-in parser.
 * @param {...*} [args] All other arguments are defined by the Filter author.
 * @return {*}
 */

export interface Filter extends Function {
    (input: any, ...arg): any;
    safe?: boolean;
}

export interface Filters {
    [key: string]: Filter;
}

interface Parsers {
    [key: string]: Function;
}



/**
 * Makes a string safe for regular expression.
 * 
 * @param {string} str 
 * @returns 
 * @private
 */
function escapeRegExp(str: string) {
    return str.replace(/[\-\/\\\^$*+?.()|\[\]{}]/, '\\$&');
}

/**
 * Parse strings of variables ang tags into tokens for future compilation.
 * 
 * @class TokenParser
 */
class TokenParser {
    out: string[];
    state: any[];
    filterApplyIdx: number[];
    filename: string;
    line: number;
    filters: Filters;
    escape: boolean;
    private parsers: Parsers;
    private tokens: LexerToken[];
    private isLast: boolean = false;
    private prevToken: LexerToken;
    private autoescape: boolean;

    /**
     * Creates an instance of TokenParser.
     * @param {LexerToken[]}    tokens      Pre-split tokens read by the Lexer.
     * @param {Filters}         filters     Keyed object of filters that may be applied to variables.
     * @param {boolean}         autoescape  Whether or not this shuould be autoescaped.
     * @param {number}          line        Beginning line number for the firsr token. 
     * @param {string}          [filename]  Name of the file being parsed.
     * @memberof TokenParser
     */
    constructor(tokens: LexerToken[], filters: Filters, autoescape: boolean, line: number, filename?: string) {
        this.line = line;
        this.filters = filters;
        this.filename = filename;
        this.autoescape = this.escape = autoescape;
        this.tokens = tokens;
    }

    parse() {
        const tokens = this.tokens;

        if (this.parsers.start) {
            this.parsers.start.call(this);
        }
        utils.each(tokens, (token, i) => {
            let prevToken = tokens[i - 1];
            this.isLast = (i === tokens.length - 1);
            if (prevToken) {
                while (prevToken.type === _t.WHITESAPCE) {
                    i -= 1;
                    prevToken = tokens[i - 1];
                }
            }
            this.prevToken = prevToken;
            this.parseToken(token);
        })
        if (this.parsers.end) {
            this.parsers.end.call(this);
        }

        if (this.escape) {
            this.filterApplyIdx = [0];
            if (typeof this.escape === 'string') {
                this.parseToken({ type: _t.FILTER, match: 'e' });
                this.parseToken({ type: _t.COMMA, match: ',' });
                this.parseToken({ type: _t.STRING, match: String(this.autoescape) });
                this.parseToken({ type: _t.PARENCLOSE, match: ')' });
            } else {
                this.parseToken({ type: _t.FILTEREMPTY, match: 'e' });
            }
        }

        return this.out;
    }

    /**
     * Set a custom method to be called when token type is found.
     * 
     * @example
     * parser.on(_types.STRING, function(token) {
     *      this.out.push(token.match);
     * })
     * 
     * @example
     * parser.on('start', function () {
     *   this.out.push('something at the beginning of your args')
     * });
     * parser.on('end', function () {
     *   this.out.push('something at the end of your args');
     * });
     * 
     * @param {string}      type    Token type ID. Found in the Lexer.  
     * @param {Function}    fn      Callbacak function. Return true to continue executing the default parsing function.
     * @memberof TokenParser
     */
    on(type: number, fn: Function) {
        this.parsers[type] = fn;
    }

    /**
     * Parse a single token.
     * 
     * @param {LexerToken} token 
     * @memberof TokenParser
     */
    parseToken(token: LexerToken) {
        let fn = this.parsers[token.type] || this.parsers['*'],
            match = token.match,
            prevToken = this.prevToken,
            prevTokenType = prevToken ? prevToken.type : null,
            lastState = (this.state.length) ? this.state[this.state.length - 1] : null,
            temp;

        if (fn && typeof fn === 'function') {
            // 调整解析顺序
            if (!fn.call(this, token)) {
                return;
            }
        }

        if (lastState && prevToken &&
            lastState === _t.FILTER &&
            prevTokenType === _t.FILTER &&
            token.type !== _t.PARENCLOSE &&
            token.type !== _t.COMMA &&
            token.type !== _t.OPERATOR &&
            token.type !== _t.FILTER &&
            token.type !== _t.FILTEREMPTY) {
            this.out.push(', ');
        }

        if (lastState && lastState === _t.METHODOPEN) {
            this.state.pop();
            if (token.type !== _t.PARENCLOSE) {
                this.out.push(', ');
            }
        }

        switch (token.type) {
            case _t.WHITESAPCE:
                break;

            case _t.STRING:
                this.filterApplyIdx.push(this.out.length);
                this.out.push(match.replace(/\\/g, '\\\\'));
                break;

            case _t.NUMBER:
            case _t.BOOL:
                this.filterApplyIdx.push(this.out.length);
                this.out.push(match);
                break;

            case _t.FILTER:
                if (!this.filters.hasOwnProperty(match) || typeof this.filters[match] !== 'function') {
                    utils.throwError(`Invaliad filter "${match}"`, this.line, this.filename);
                }
                this.escape = this.filters[match].safe ? false : this.escape;
                this.out.splice(this.filterApplyIdx[this.filterApplyIdx.length - 1], 0, '_filters["' + match + '"](');
                this.state.push(token.type);
                break;

            case _t.FILTEREMPTY:
                if (!this.filters.hasOwnProperty(match) || typeof this.filters[match] !== 'function') {
                    utils.throwError(`Invaliad filter "${match}"`, this.line, this.filename);
                }
                this.escape = this.filters[match].safe ? false : this.escape;
                this.out.splice(this.filterApplyIdx[this.filterApplyIdx.length - 1], 0, '_filters["' + match + '"](');
                this.state.push(')');
                break;

            case _t.FUNCTION:
            case _t.FUNCTIONEMPTY:
                this.out.push('((typeof _ctx.' + match + ' !== "undefined") ? _ctx.' + match +
                    ' : ((typeof ' + match + ' !== "undefined") ? ' + match +
                    ' : _fn))(');
                this.escape = false;
                if (token.type === _t.FUNCTIONEMPTY) {
                    this.out[this.out.length - 1] = this.out[this.out.length - 1] + ')';
                } else {
                    this.state.push(token.type);
                }
                this.filterApplyIdx.push(this.out.length - 1);
                break;

            case _t.PARENOPEN:
                this.state.push(token.type);
                if (this.filterApplyIdx.length) {
                    this.out.splice(this.filterApplyIdx[this.filterApplyIdx.length - 1], 0, '(');
                    if (prevToken && prevTokenType === _t.VAR) {
                        temp = prevToken.match.split('.').slice(0, -1);
                        this.out.push(' || _fn).call' + this.checkMatch(temp));
                        this.state.push(_t.METHODOPEN);
                        this.escape = false;
                    } else {
                        this.out.push(' || _fn)(');
                    }
                    this.filterApplyIdx.push(this.out.length - 3);
                } else {
                    this.out.push('(');
                    this.filterApplyIdx.push(this.out.length - 1);
                }
                break;

            case _t.PARENCLOSE:
                temp = this.state.pop();
                if (temp !== _t.PARENOPEN && temp !== _t.FUNCTION && temp !== _t.FILTER) {
                    utils.throwError('Mismatched nesting state', this.line, this.filename);
                }

                this.out.push(')');
                this.filterApplyIdx.pop();

                if (temp !== _t.FILTER) {
                    this.filterApplyIdx.pop();
                }
                break;

            case _t.COMMA:
                if (lastState !== _t.FUNCTION &&
                    lastState !== _t.FILTER &&
                    lastState !== _t.ARRAYOPEN &&
                    lastState !== _t.CURLYOPEN &&
                    lastState !== _t.PARENOPEN &&
                    lastState !== _t.COLON) {
                    utils.throwError('Unexpected comma', this.line, this.filename);
                }
                if (lastState === _t.COLON) {
                    this.state.pop();
                }
                this.out.push(', ');
                this.filterApplyIdx.pop();
                break;

            case _t.LOGIC:
            case _t.COMPARATOR:
                if (!prevToken ||
                    prevTokenType === _t.COMMA ||
                    prevTokenType === token.type ||
                    prevTokenType === _t.BRACKETOPEN ||
                    prevTokenType === _t.CURLYOPEN ||
                    prevTokenType === _t.PARENOPEN ||
                    prevTokenType === _t.FUNCTION) {
                    utils.throwError('Unexpected logic', this.line, this.filename);
                }
                this.out.push(match);
                break

            case _t.NOT:
                this.out.push(match);
                break;

            case _t.VAR:
                this.parseVar(token, match, lastState);
                break;

            case _t.BRACKETOPEN:
                if (!prevToken ||
                    (prevTokenType !== _t.VAR &&
                        prevTokenType !== _t.BRACKETCLOSE &&
                        prevTokenType !== _t.PARENCLOSE)) {
                    this.state.push(_t.ARRAYOPEN);
                    this.filterApplyIdx.push(this.out.length);
                } else {
                    this.state.push(token.type);
                }
                this.out.push('[');
                break;
            case _t.BRACKETCLOSE:
                temp = this.state.pop();
                if (temp !== _t.BRACKETOPEN && temp !== _t.ARRAYOPEN) {
                    utils.throwError('Unexpected closing square bracket', this.line, this.filename);
                }
                this.out.push(']');
                this.filterApplyIdx.pop();
                break;

            case _t.CURLYOPEN:
                this.state.push(token.type);
                this.out.push('{');
                this.filterApplyIdx.push(this.out.length - 1);
                break;

            case _t.COLON:
                if (lastState !== _t.CURLYOPEN) {
                    utils.throwError('Unexpected colon', this.line, this.filename);
                }
                this.state.push(token.type);
                this.out.push(':');
                this.filterApplyIdx.pop();
                break;

            case _t.CURLYCLOSE:
                if (lastState === _t.COLON) {
                    this.state.pop();
                }
                if (this.state.pop() !== _t.CURLYOPEN) {
                    utils.throwError('Unexpected closing curly brace', this.line, this.filename);
                }
                this.out.push('}');

                this.filterApplyIdx.pop();
                break;

            case _t.DOTKEY:
                if (!prevToken || (
                    prevTokenType !== _t.VAR &&
                    prevTokenType !== _t.BRACKETCLOSE &&
                    prevTokenType !== _t.DOTKEY &&
                    prevTokenType !== _t.PARENCLOSE &&
                    prevTokenType !== _t.FUNCTIONEMPTY &&
                    prevTokenType !== _t.FILTEREMPTY &&
                    prevTokenType !== _t.CURLYCLOSE
                )) {
                    utils.throwError('Unexpected key "' + match + '"', this.line, this.filename);
                }
                this.out.push('.' + match);
                break;

            case _t.OPERATOR:
                this.out.push(' ' + match + ' ');
                this.filterApplyIdx.pop();
                break;
        }
    }

    /**
     * Parse variable token
     * @param {LexerToken}  token       Lexer token object. 
     * @param {string}      match       Shortcut for token match.
     * @param {number[]}    lastState   Lexer tokemn type state.
     */
    parseVar(token: LexerToken, match: string, lastState: number) {
        const matchArr = match.split(',');

        if (_reserved.indexOf[matchArr[0]] !== -1) {
            utils.throwError(`Reserved keyword "${matchArr[0]}" attempted to be used as a variable`, this.line, this.filename);
        }

        this.filterApplyIdx.push(this.out.length);
        if (lastState === _t.CURLYOPEN) {
            if (matchArr.length > 1) {
                utils.throwError('Unexpected dot', this.line, this.filename);
            }

            this.out.push(matchArr[0]);
            return;
        }

        this.out.push(this.checkMatch(matchArr));
    }

    /**
     * Return contextual dot-check string for match.
     * 
     * 
     * @param {string} match 
     * @memberof TokenParser
     */
    checkMatch(match: string[]): string {
        let temp = match[0], result;

        function checkDot(ctx: string) {
            let c = ctx + temp,
                m = match,
                build = '';
            
            build = `(typeof ${c} !== "undefined" && ${c} !== null`;
            utils.each(m, function(v: any, i: any) {
                if(i === 0) {
                    return;
                }
                build += ` && ${c}.${v} !== undefiend && ${c}.${v} !== null`;
                c += '.' + v;
            });
            build += ')';
            return build;
        }

        function buildDot(ctx: string) {
            return '(' + checkDot(ctx) + '?' + ctx + match.join('.') + ' : "")';
        }
        result = '(' + checkDot('_ctx.') + ' ? ' + buildDot('_ctx.') + ' : ' + buildDot('') + ')';
        return '(' + result + ' !== null ? ' + result + ' : ' + '"" )';
    }
}

export const parse = function (swig: Swig, source: string, opts: SwigOptions, tags: any, filters: Filters) {
    source = source.replace(/\r\n/g, '\n');
    let escape = opts.autoescape,
        tagOpen = (<string[]>opts.tagControls)[0],
        tagClose = (<string[]>opts.tagControls)[1],
        varOpen = (<string[]>opts.varControls)[0],
        varClose = (<string[]>opts.varControls)[1],
        escapedTagOpen = escapeRegExp(tagOpen),
        escapedTagClose = escapeRegExp(tagClose),
        escapedVarOpen = escapeRegExp(varOpen),
        escapedVarClose = escapeRegExp(varClose),
        tagStrip = new RegExp('^' + escapedTagOpen + '-?\\s*-?|-?\\s*-?' + escapedTagClose + '$', 'g'),
        tagStripBefore = new RegExp('^' + escapedTagOpen + '-'),
        tagStripAfter = new RegExp('-' + escapedTagClose + '$'),
        varStrip = new RegExp('^' + escapedVarOpen + '-?\\s*-?|-?\\s*-?' + escapedVarClose + '$', 'g'),
        varStripBefore = new RegExp('^' + escapedVarOpen + '-'),
        varStripAfter = new RegExp('-' + escapedVarClose + '$'),
        cmtOpen = (<string[]>opts.cmtControls)[0],
        cmtClose = (<string[]>opts.cmtControls)[1],
        anyChar = '[\\s\\S]*?',
        splitter = new RegExp(
            '(' +
            escapedTagOpen + anyChar + escapedTagClose + '|' +
            escapedVarOpen + anyChar + escapedVarClose + '|' +
            escapeRegExp(cmtOpen) + anyChar + escapeRegExp(cmtClose) +
            ')'
        ),
        line = 1,
        stack: any[] = [],
        parent = null,
        tokens = [],
        blocks = {},
        inRaw = false,
        stripNext;

    /**
     * Parse a variable.
     * 
     * @param {string} str  String contents of the variable, between <i>{{</i> and <i>}}</i>
     * @param {number} line The line number that this variable starts on.
     * @return {VarToken}   Parsed variable token object.
     */
    function parseVariable(str: string, line: number) {
        let tokens = lexer.read(utils.strip(str)),
            parser,
            out: string;

        parser = new TokenParser(tokens, filters, escape, line, opts.filename);
        out = parser.parse().join('');

        if (parser.state.length) {
            utils.throwError(`Unable to parse "${str}"`, line, opts.filename);
        }

        return {
            complie: function () {
                return '_output +=' + out + ';\n';
            }
        };
    }

    /**
     * Parse a tag.
     * 
     * @param {string} str  String contents of the variable, between <i>{%</i> and <i>%}</i>
     * @param {number} line The line number that this variable starts on.
     * @return {TagToken} Parsed token object.
     */
    function parseTag(str: string, line: number) {
        let tokens, parser, chunks, tagName, tag, args, last;

        if (utils.startWith(str, 'end')) {
            last = stack[stack.length - 1];
            if (last && last.name === str.split(/\s+/)[0].replace(/^end/, '') && last.ends) {
                switch (last.name) {
                    case 'autoescape':
                        escape = opts.autoescape;
                        break;
                    case 'raw':
                        inRaw = false;
                        break;
                }
                stack.pop();
                return;
            }

            if (!inRaw) {
                utils.throwError(`Unexpected end of tag ${str.replace(/^end/, '')}`, line, opts.filename);
            }
        }

        if (inRaw) {
            return;
        }

        chunks = str.split(/\s+(.+)?/);
        tagName = <string>chunks.shift();

        if (!tags.hasOwnProperty(tagName)) {
            utils.throwError(`Unexpected tag "${str}"`, line, opts.filename);
        }

        tokens = lexer.read(utils.strip(chunks.join('')));
        parser = new TokenParser(tokens, filters, false, line, opts.filename);
        tag = tags[tagName];

        if (!tag.parse(chunks[1], line, parser, _t, stack, opts, swig)) {
            utils.throwError('Unexpected tag "' + tagName + '"', line, opts.filename);
        }

        parser.parse();
        args = parser.out;

        switch (tagName) {
            case 'autoescape':
                escape = (args[0] !== 'false') ? args[0] : false;
                break;
            case 'raw':
                inRaw = true;
                break;
        }

        return {
            block: !!tags[tagName].block,
            compile: tag.compile,
            args: args,
            content: [],
            ends: tag.ends,
            name: tagName
        }
    }

    function stripPrevToken(token: any) {
        if (typeof token === 'string') {
            token = token.replace(/\s*$/, '');
        }

        return token;
    }
}