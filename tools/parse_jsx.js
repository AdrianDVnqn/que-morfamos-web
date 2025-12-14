const fs = require('fs');
const parser = require('@babel/parser');
const path = process.argv[2] || 'src/App.js';
const code = fs.readFileSync(path, 'utf8');
try{
  parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] });
  console.log('Parsed OK');
}catch(e){
  console.error('Parse error:');
  console.error(e.message);
  if(e.loc) console.error('Line',e.loc.line,'Column',e.loc.column);
  try{
    const src = fs.readFileSync(path,'utf8').split('\n');
    const L = e.loc ? e.loc.line : 0;
    const start = Math.max(0, L-6);
    const end = Math.min(src.length, L+5);
    console.error('---- Source excerpt ----');
    for(let i=start;i<end;i++){
      const num = i+1;
      console.error((num===L? '>>':'  ')+String(num).padStart(4,' ')+" | "+src[i]);
    }
    console.error('---- End excerpt ----');
  }catch(err){ console.error('Could not read file for excerpt', err.message); }
  process.exit(1);
}
