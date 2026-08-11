// Evaluates a JS expression in the cloud game tab via pwr and prints the raw result section.
// Usage: node tools/pwr-eval.mjs "<js expression>"
import { pwr, selectGameTab } from './pwr.mjs';

const expression = process.argv[2];
if (!expression) throw new Error('usage: node tools/pwr-eval.mjs "<js expression>"');

selectGameTab();
const out = pwr(['eval', expression], { maxBuffer: 64 * 1024 * 1024 });

const section = out.slice(out.indexOf('### Result'));
const body = section.slice(section.indexOf('\n') + 1);
const end = body.indexOf('\n### ');
console.log((end === -1 ? body : body.slice(0, end)).trim());
