const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalizeTags(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error('tags must be an array of strings');
  }
  const seen = new Set();
  const tags = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || tag.length > 30) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > 15) {
    throw new Error('at most 15 tags are allowed');
  }
  return tags;
}

function attachTags(articles) {
  if (!articles.length) return articles;
  const ids = articles.map((a) => a.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT article_tags.article_id AS article_id, tags.name AS name
    FROM article_tags
    JOIN tags ON tags.id = article_tags.tag_id
    WHERE article_tags.article_id IN (${placeholders})
    ORDER BY tags.name
  `).all(...ids);

  const tagsByArticle = new Map();
  for (const row of rows) {
    if (!tagsByArticle.has(row.article_id)) tagsByArticle.set(row.article_id, []);
    tagsByArticle.get(row.article_id).push(row.name);
  }
  return articles.map((a) => ({ ...a, tags: tagsByArticle.get(a.id) || [] }));
}

const insertArticleWithTags = db.transaction((article, tags) => {
  const stmt = db.prepare(`
    INSERT INTO articles (title, url, article_date, location_name, lat, lng, radius_km)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    article.title, article.url, article.article_date,
    article.location_name, article.lat, article.lng, article.radius_km
  );
  const articleId = info.lastInsertRowid;

  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');

  for (const name of tags) {
    let tagRow = findTag.get(name);
    const tagId = tagRow ? tagRow.id : insertTag.run(name).lastInsertRowid;
    linkTag.run(articleId, tagId);
  }

  return articleId;
});

// Rough bounding box around metropolitan France (+ margin), used to sanity-check pins.
const FRANCE_BOUNDS = { minLat: 40, maxLat: 52, minLng: -6, maxLng: 10 };

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
  const tagFilter = normalizeTags(
    typeof req.query.tags === 'string' && req.query.tags
      ? req.query.tags.split(',')
      : []
  );

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
  res.json(attachTags(rows));
});

app.post('/api/articles', (req, res) => {
  const { title, url, article_date, location_name, lat, lng, radius_km, tags } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (typeof url !== 'string' || !/^https?:\/\/.+/i.test(url.trim())) {
    return res.status(400).json({ error: 'a valid http(s) url is required' });
  }
  if (typeof article_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(article_date)) {
    return res.status(400).json({ error: 'article_date is required in YYYY-MM-DD format' });
  }
  if (typeof location_name !== 'string' || !location_name.trim()) {
    return res.status(400).json({ error: 'location_name is required' });
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const radiusNum = radius_km === undefined || radius_km === null || radius_km === '' ? 10 : Number(radius_km);

  if (!isFiniteNumber(latNum) || !isFiniteNumber(lngNum)) {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }
  if (
    latNum < FRANCE_BOUNDS.minLat || latNum > FRANCE_BOUNDS.maxLat ||
    lngNum < FRANCE_BOUNDS.minLng || lngNum > FRANCE_BOUNDS.maxLng
  ) {
    return res.status(400).json({ error: 'location must be within France' });
  }
  if (!isFiniteNumber(radiusNum) || radiusNum <= 0 || radiusNum > 500) {
    return res.status(400).json({ error: 'radius_km must be a number between 0 and 500' });
  }

  let tagList;
  try {
    tagList = normalizeTags(tags);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const articleId = insertArticleWithTags(
    {
      title: title.trim(),
      url: url.trim(),
      article_date,
      location_name: location_name.trim(),
      lat: latNum,
      lng: lngNum,
      radius_km: radiusNum,
    },
    tagList
  );
  const created = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  res.status(201).json(attachTags([created])[0]);
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
