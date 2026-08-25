'use strict';
// Offline tests: citation parsing and CanLII id derivation (no network).
const assert = require('assert');
const { parseCitations, searchUrl } = require('../kernel/canlii.js');

const text = `As held in Dunsmuir v. New Brunswick, 2008 SCC 9, [2008] 1 SCR 190, and applied
in Ariston Realty Corp. v. Elcarim Inc., 2014 ONCA 925, see also 1999 CanLII 1527 (ON CA)
and Vavilov, 2019 SCC 65. Cf. 2020 FCA 77 and 2018 ABQB 152.`;

const got = parseCitations(text);
const byCite = Object.fromEntries(got.map((c) => [c.cite, c]));

assert.deepStrictEqual(byCite['2008 SCC 9'].ids, { databaseId: 'csc-scc', caseId: '2008scc9' }, 'SCC maps to csc-scc');
assert.deepStrictEqual(byCite['2014 ONCA 925'].ids, { databaseId: 'onca', caseId: '2014onca925' });
assert.deepStrictEqual(byCite['1999 CanLII 1527 (ON CA)'].ids, { databaseId: 'onca', caseId: '1999canlii1527' });
assert.deepStrictEqual(byCite['2020 FCA 77'].ids, { databaseId: 'fca', caseId: '2020fca77' });
assert.deepStrictEqual(byCite['2018 ABQB 152'].ids, { databaseId: 'abqb', caseId: '2018abqb152' });
assert.strictEqual(byCite['[2008] 1 SCR 190'].ids, null, 'SCR cites are link-out only');
assert.strictEqual(got.length, 7, 'found all seven distinct citations');
assert(searchUrl('2008 SCC 9').startsWith('https://www.canlii.org/en/search/?text=2008%20SCC%209'));
console.log('CANLII PARSER: ALL PASS (' + got.length + ' citations, ids derived)');
