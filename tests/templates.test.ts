import { Swig } from '../lib/swig';
import file = require('file');
import path = require('path');
import fs = require('fs');
import should = require('should');
import _ = require('lodash');


function isTest(f) {
    return (/\.test\.html$/).test(f);
}

function isExpectation(f) {
    return (/\.expectation\.html$/).test(f);
}

describe('Templates', function () {
    let swig: Swig;

    beforeEach(() => {
        swig = new Swig();
    });

    afterEach(() => {
        swig = null;
    });

    var casefiles = [],
        locals = {
            alpha: 'Nachos',
            first: 'Tacos',
            second: 'Burritos',
            includefile: "./includes.html",
            bar: ["a", "b", "c"]
        },
        tests,
        expectations,
        cases;

    file.walkSync(__dirname + '/cases/', function (start, dirs, files) {
        _.each(files, function (f) {
            return casefiles.push(path.normalize(start + '/' + f));
        });
    });

    tests = _.filter(casefiles, isTest);
    expectations = _.filter(casefiles, isExpectation);
    cases = _.groupBy(tests.concat(expectations), function (f) {
        return (f as string).split('.')[0];
    });

    _.each(cases, function (files, c) {
        var test = _.find(files, isTest),
            expectation = fs.readFileSync(_.find(files, isExpectation), 'utf8');

        it(c, function () {
            should(swig.compileFile(test)(locals)).be.eql(expectation);
        });
    });

    it('throw if circular extends are found', function () {
        should.throws(() => {
            swig.compileFile(__dirname + '/cases-error/circular.test.html')();
        }, /Illegal circular ectends of ".*/g);
    });

    it('throw with filename reporting', function () {
        should.throws(function () {
            swig.compileFile(__dirname + '/cases-error/report-filename.test.html')();
        }, /in file .*swig-ts\/tests\/cases-error\/report-filename-partial\.html/g);
    });
});
