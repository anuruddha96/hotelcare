const fs = require('node:fs');
const path = 'scripts/hc-bed-hotfix-20260918.cjs';
let source = fs.readFileSync(path, 'utf8');
const oldCondition = 'if (index < 0 || content.indexOf(before, index + before.length) >= 0) {';
if (!source.includes(oldCondition)) throw new Error('Unexpected patch helper version');
source = source.replace(oldCondition, 'if (index < 0) {');
source = source.replace('  return content.replace(before, after);', "  const matches = content.split(before).length - 1;\n  if (matches > 1) console.log(`Replacing ${matches} matching render blocks in ${path}`);\n  return content.split(before).join(after);");
fs.writeFileSync(path, source);
require('./hc-bed-hotfix-20260918.cjs');
