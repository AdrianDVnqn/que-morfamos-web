const fs = require('fs');
const parser = require('@babel/parser');
const path = process.argv[2] || 'src/App.js';
const maxLines = parseInt(process.argv[3]||2000,10);
const content = fs.readFileSync(path,'utf8');
const lines = content.split('\n');
for(let L=50; L<=Math.min(lines.length, maxLines); L+=50){
  const slice = lines.slice(0,L).join('\n');
  try{ parser.parse(slice, { sourceType:'module', plugins: ['jsx','classProperties','optionalChaining','nullishCoalescingOperator'] });
    console.log('Parsed up to line',L);
  }catch(e){
    console.error('Parse failed at slice with last line',L);
    console.error(e.message);
    if(e.loc) console.error('Error loc',e.loc.line,e.loc.column);
    process.exit(0);
  }
}
console.log('No failures up to',Math.min(lines.length,maxLines));
