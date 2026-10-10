const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const regex = /<section id="(page-[^"]*)"[^>]*>([\s\S]*?)<\/section>/g;
let m;
while ((m = regex.exec(content)) !== null) {
  const pageId = m[1];
  const body = m[2];
  console.log('========================================');
  console.log('PAGE:', pageId);
  const titles = body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g) || [];
  titles.forEach(t => console.log('  H:', t.replace(/<[^>]+>/g, '').trim()));
  const buttons = body.match(/<button[^>]*>([\s\S]*?)<\/button>/g) || [];
  console.log('  Buttons count:', buttons.length);
  buttons.slice(0, 5).forEach(b => console.log('    Btn:', b.replace(/<[^>]+>/g, '').trim()));
}
