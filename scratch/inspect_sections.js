const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const sections = content.match(/<section[^>]*id="page-[^"]*"[^>]*>/g);
console.log('Sections:\n', sections);

const regex = /<section[^>]*id="(page-[^"]*)"[^>]*>([\s\S]*?)<\/section>/g;
let m;
while ((m = regex.exec(content)) !== null) {
  const id = m[1];
  const inner = m[2];
  const h = inner.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/);
  console.log(id, '->', h ? h[1].replace(/<[^>]+>/g, '').trim() : 'No heading');
}
