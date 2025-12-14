const fs = require('fs');
const path = process.argv[2] || 'src/App.js';
const s = fs.readFileSync(path, 'utf8');
let i=0,line=1,col=1; const stack=[];
while(i<s.length){ const c=s[i]; if(c==='\n'){line++;col=1;i++;continue;} if(c==='"' || c==="'" || c==='`'){ // skip string
  const q=c; i++; col++;
  while(i<s.length && s[i]!==q){ if(s[i]==='\\') { i+=2; col+=2; } else { if(s[i]==='\n'){line++;col=1;} else col++; i++; } }
  i++; col++; continue;
 }
 if(c==='/'){ // skip comments
   if(s[i+1]==='/'){ while(i<s.length && s[i]!=="\n"){ i++; } continue; }
   if(s[i+1]==='*'){ i+=2; while(i<s.length && !(s[i]==='*' && s[i+1]==='/')){ if(s[i]==='\n'){line++;col=1;} else col++; i++; } i+=2; col+=2; continue; }
 }
 if(c==='<' ){ // tag
   // ignore comparison operators and other JS use of '<=' or '<<'
   const nextChar = s[i+1] || '';
   if (!/[A-Za-z\/>]/.test(nextChar)) { i++; col++; continue; }
   // find if closing
   if(s[i+1]==='/' ){ // closing tag
     let j=i+2; while(j<s.length && /[A-Za-z0-9_\-:\.]/.test(s[j])) j++; const name=s.substring(i+2,j);
     if(name===''){ // fragment close
       if(stack.length===0 || stack[stack.length-1].name!=='__frag') { console.log('Unmatched fragment close at',line,col); break; }
       stack.pop();
     } else {
       if(stack.length===0){ console.log('Unmatched closing tag',name,'at',line,col); break; }
       const top=stack.pop(); if(top.name!==name){ console.log('Tag mismatch at',line,col,'expected',top.name,'got',name); break; }
     }
     // advance to '>'
     const end=s.indexOf('>',i+1); if(end===-1) break; const chunk=s.substring(i,end+1); const lines=chunk.split('\n'); line+=lines.length-1; col=lines[lines.length-1].length+1; i=end+1; continue;
   }
   // opening or self-closing
   if(s.substr(i,2)==='<>'){ stack.push({name:'__frag',line,col}); i+=2; col+=2; continue; }
   let j=i+1; while(j<s.length && !/\s|\/|>/.test(s[j])) j++; const name=s.substring(i+1,j);
   const closeIndex=s.indexOf('>',i+1);
   const slashIndex=s.indexOf('/>',i+1);
   const isSelf = slashIndex!==-1 && slashIndex<closeIndex;
   if(!isSelf){ stack.push({name,line,col}); }
   if(closeIndex===-1) break; const chunk=s.substring(i,closeIndex+1); const lines=chunk.split('\n'); line+=lines.length-1; col=lines[lines.length-1].length+1; i=closeIndex+1; continue;
 }
 i++; col++; }
if(stack.length>0){ console.log('Unclosed tags count',stack.length); console.log(stack.slice(-10));
  try{
    const src = fs.readFileSync(path,'utf8').split('\n');
    console.log('---- Excerpts for open tags ----');
    stack.slice(-10).forEach(t => {
      const start = Math.max(0, t.line-3);
      const end = Math.min(src.length, t.line+2);
      console.log(`Tag ${t.name} opened at line ${t.line}, col ${t.col}`);
      for(let i=start;i<end;i++) console.log((i+1).toString().padStart(5,' ')+" | "+src[i]);
      console.log('---');
    });
    console.log('---- End excerpts ----');
  }catch(e){ }
} else console.log('All tags closed');
