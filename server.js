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

// Rough bounding box around metropolitan France (+ margin), used to sanity-check pins.
const FRANCE_BOUNDS = { minLat: 40, maxLat: 52, minLng: -6, maxLng: 10 };

app.get('/api/articles', (req, res) => {
  const { from, to } = req.query;

  let query = 'SELECT * FROM articles';
  const conditions = [];
  const params = [];

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
  query += ' ORDER BY article_date DESC, id DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

app.post('/api/articles', (req, res) => {
  const { title, url, article_date, location_name, lat, lng, radius_km } = req.body || {};

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

  const stmt = db.prepare(`
    INSERT INTO articles (title, url, article_date, location_name, lat, lng, radius_km)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(title.trim(), url.trim(), article_date, location_name.trim(), latNum, lngNum, radiusNum);
  const created = db.prepare('SELECT * FROM articles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
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
