const fs = require('fs');
const parser = require('@babel/parser');
const path = process.argv[2] || 'src/App.js';
const content = fs.readFileSync(path,'utf8');
const lines = content.split('\n');
let lo = 1, hi = lines.length, best = 0;
while(lo<=hi){
  const mid = Math.floor((lo+hi)/2);
  const slice = lines.slice(0,mid).join('\n');
  try{
    parser.parse(slice, { sourceType:'module', plugins: ['jsx','classProperties','optionalChaining','nullishCoalescingOperator'] });
    best = mid; lo = mid+1;
  }catch(e){
    hi = mid-1;
  }
}
console.log('Last good line:', best, 'Total lines:', lines.length);
if(best < lines.length){
  const excerptStart = Math.max(0, best-10);
  const excerptEnd = Math.min(lines.length, best+10);
  console.log('---- Excerpt around break ----');
  for(let i=excerptStart;i<excerptEnd;i++){
    console.log(String(i+1).padStart(4,' ')+" | "+lines[i]);
  }
}
