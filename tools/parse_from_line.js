const fs = require('fs');
const parser = require('@babel/parser');
const path = process.argv[2]||'src/App.js';
const startLine = parseInt(process.argv[3]||'999',10);
const content = fs.readFileSync(path,'utf8');
const lines = content.split('\n');
let startIndex = -1;
for(let i=startLine-1;i<lines.length;i++){
  if(lines[i].includes('return (')){
    // check ahead few lines for top-level App wrapper
    const lookahead = lines.slice(i, i+6).join('\n');
    if(lookahead.indexOf('<div className={') !== -1) { startIndex = i; break; }
  }
}
if(startIndex===-1){ console.error('Could not find App return ( starting at', startLine); process.exit(1); }
console.log('Found App return at line', startIndex+1);
let firstSuccess = -1;
for(let end=startIndex+1; end<=lines.length; end++){
  const slice = lines.slice(startIndex,end).join('\n');
  try{
    const expr = slice.replace(/^.*?return\s*\(/s, '');
    const wrapper = 'function __Wrap(){\n  return (\n' + expr + '\n  );\n}';
    parser.parse(wrapper, { sourceType:'module', plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator'] });
    firstSuccess = end; break; // found the first end where parse succeeds
  }catch(e){
    // keep trying
  }
}
if(firstSuccess === -1){ console.error('Could not find any slice that parses successfully (file likely broken near start)'); process.exit(1); }
// now find where it first breaks after success
for(let end=firstSuccess+1; end<=lines.length; end++){
  const slice = lines.slice(startIndex,end).join('\n');
  try{
    const expr = slice.replace(/^.*?return\s*\(/s, '');
    const wrapper = 'function __Wrap(){\n  return (\n' + expr + '\n  );\n}';
    parser.parse(wrapper, { sourceType:'module', plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator'] });
    // still ok
  }catch(e){
    console.error('Parse failed when including up to line',end,'error:', e.message);
    if(e.loc) console.error('Error loc', e.loc.line, e.loc.column);
    const start = Math.max(startIndex, end-6);
    for(let l=start; l<end+2 && l<lines.length; l++) console.error((l+1).toString().padStart(5,' ')+" | "+lines[l]);
    process.exit(0);
  }
}
console.log('No failures up to full file');
