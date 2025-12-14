const fs=require('fs'); const s=fs.readFileSync(process.argv[2]||'frontend/src/App.js','utf8');
const counts={backtick:(s.match(/`/g)||[]).length,single:(s.match(/'/g)||[]).length,double:(s.match(/"/g)||[]).length,lt:(s.match(/</g)||[]).length,gt:(s.match(/>/g)||[]).length}; console.log(counts);
