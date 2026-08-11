const FRANCE_BOUNDS = { minLat: 40, maxLat: 52, minLng: -6, maxLng: 10 };
const MAX_TAGS = 15;
const MAX_TAG_LENGTH = 30;

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalizeTagList(input) {
  if (input === undefined || input === null || input === '') return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || tag.length > MAX_TAG_LENGTH) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.slice(0, MAX_TAGS);
}

// Validates and normalizes raw article input (from the API or a parsed GitHub issue).
// Returns { valid, errors, value } — value is only set when valid is true.
function validateArticle(raw) {
  raw = raw || {};
  const errors = [];

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) errors.push('title is required');

  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!/^https?:\/\/.+/i.test(url)) errors.push('a valid http(s) url is required');

  const article_date = typeof raw.article_date === 'string' ? raw.article_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(article_date)) errors.push('date is required in YYYY-MM-DD format');

  const location_name = typeof raw.location_name === 'string' ? raw.location_name.trim() : '';
  if (!location_name) errors.push('location name is required');

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    errors.push('latitude and longitude must be numbers');
  } else if (
    lat < FRANCE_BOUNDS.minLat || lat > FRANCE_BOUNDS.maxLat ||
    lng < FRANCE_BOUNDS.minLng || lng > FRANCE_BOUNDS.maxLng
  ) {
    errors.push('location must be within France');
  }

  const radius_km = raw.radius_km === undefined || raw.radius_km === null || raw.radius_km === ''
    ? 10
    : Number(raw.radius_km);
  if (!isFiniteNumber(radius_km) || radius_km <= 0 || radius_km > 500) {
    errors.push('radius_km must be a number between 0 and 500');
  }

  if (errors.length) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: { title, url, article_date, location_name, lat, lng, radius_km, tags: normalizeTagList(raw.tags) },
  };
}

function insertArticleWithTags(db, article, tags) {
  const run = db.transaction(() => {
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
      const tagRow = findTag.get(name);
      const tagId = tagRow ? tagRow.id : insertTag.run(name).lastInsertRowid;
      linkTag.run(articleId, tagId);
    }

    return articleId;
  });

  return run();
}

function attachTags(db, articles) {
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

module.exports = { FRANCE_BOUNDS, validateArticle, normalizeTagList, insertArticleWithTags, attachTags };
