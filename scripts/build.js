const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rootDir = path.join(__dirname, '..');
const docsDir = path.join(rootDir, 'docs');
const staticSrcDir = path.join(rootDir, 'web-static');

const db = new Database(path.join(rootDir, 'data.sqlite'));
db.pragma('wal_checkpoint(TRUNCATE)');

const articles = db.prepare('SELECT * FROM articles ORDER BY article_date DESC, id DESC').all();
db.close();

fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });

fs.copyFileSync(path.join(staticSrcDir, 'index.html'), path.join(docsDir, 'index.html'));
fs.copyFileSync(path.join(staticSrcDir, 'app.js'), path.join(docsDir, 'app.js'));
fs.copyFileSync(path.join(rootDir, 'public', 'style.css'), path.join(docsDir, 'style.css'));
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');
fs.writeFileSync(path.join(docsDir, 'data.json'), JSON.stringify(articles, null, 2));

console.log(`Built docs/ with ${articles.length} article(s).`);
