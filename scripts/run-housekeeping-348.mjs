import { readFileSync, writeFileSync } from 'node:fs';
const path = 'scripts/apply-housekeeping-348.mjs';
let code = readFileSync(path, 'utf8');
const start = code.indexOf(' aria-label={' + String.fromCharCode(0));
const end = code.indexOf(' onPointerDown=', start);
if (start < 0 || end < 0) throw new Error('Source patch must match reviewed lock label anchor');
code = code.slice(0, start) + " aria-label={'Unlock room ' + roomDisplayName(room)}" + code.slice(end);
writeFileSync(path, code);
await import('./apply-housekeeping-348.mjs');
