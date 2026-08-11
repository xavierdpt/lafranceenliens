const express = require('express');
const path = require('path');
const db = require('./db');
const { validateArticle, normalizeTagList, insertArticleWithTags, attachTags } = require('./lib/articles');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tags', (req, res) => {
  const rows = db.prepare(`
    SELECT tags.name AS name, COUNT(article_tags.article_id) AS count
    FROM tags
    JOIN article_tags ON article_tags.tag_id = tags.id
    GROUP BY tags.id
    ORDER BY tags.name
  `).all();
  res.json(rows);
});

app.get('/api/articles', (req, res) => {
  const { from, to } = req.query;
  const tagFilter = normalizeTagList(req.query.tags);

  let query = 'SELECT DISTINCT articles.* FROM articles';
  const conditions = [];
  const params = [];

  if (tagFilter.length) {
    query += ' JOIN article_tags ON article_tags.article_id = articles.id JOIN tags ON tags.id = article_tags.tag_id';
    conditions.push(`tags.name IN (${tagFilter.map(() => '?').join(',')})`);
    params.push(...tagFilter);
  }
  if (from) {
    conditions.push('article_date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('article_date <= ?');
    params.push(to);
  }
  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY article_date DESC, articles.id DESC';

  const rows = db.prepare(query).all(...params);
  res.json(attachTags(db, rows));
});

app.post('/api/articles', (req, res) => {
  const { valid, errors, value } = validateArticle(req.body);
  if (!valid) {
    return res.status(400).json({ error: errors[0], errors });
  }

  const articleId = insertArticleWithTags(db, value, value.tags);
  const created = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  res.status(201).json(attachTags(db, [created])[0]);
});

app.delete('/api/articles/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const info = db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'not found' });
  }
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`France article map server running at http://localhost:${PORT}`);
});
