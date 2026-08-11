const FRANCE_CENTER = [46.6, 2.4];
const FRANCE_ZOOM = 6;

const map = L.map('map').setView(FRANCE_CENTER, FRANCE_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

const layers = new Map(); // id -> { marker, circle }
let allArticles = [];

const articleList = document.getElementById('articleList');
const articleCount = document.getElementById('articleCount');
const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const clearFilterBtn = document.getElementById('clearFilter');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clearLayers() {
  for (const { marker, circle } of layers.values()) {
    map.removeLayer(marker);
    map.removeLayer(circle);
  }
  layers.clear();
}

function renderMap(articles) {
  clearLayers();
  for (const article of articles) {
    const latlng = [article.lat, article.lng];

    const circle = L.circle(latlng, {
      radius: article.radius_km * 1000,
      color: '#c1440e',
      weight: 1,
      fillColor: '#c1440e',
      fillOpacity: 0.12,
    }).addTo(map);

    const marker = L.marker(latlng).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(article.title)}</strong><br/>` +
      `${escapeHtml(article.location_name)} &middot; ${escapeHtml(article.article_date)}<br/>` +
      `<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Open article</a>`
    );

    layers.set(article.id, { marker, circle });
  }
}

function renderList(articles) {
  articleCount.textContent = articles.length;
  articleList.innerHTML = '';

  if (!articles.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No articles for this date range.';
    articleList.appendChild(li);
    return;
  }

  for (const article of articles) {
    const li = document.createElement('li');
    li.className = 'article-item';
    li.innerHTML = `
      <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
      <div class="article-meta">
        <span>${escapeHtml(article.location_name)} &middot; ${escapeHtml(article.radius_km)} km</span>
        <span>${escapeHtml(article.article_date)}</span>
      </div>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      map.setView([article.lat, article.lng], 9);
      const entry = layers.get(article.id);
      if (entry) entry.marker.openPopup();
    });
    articleList.appendChild(li);
  }
}

function applyFilter() {
  const from = filterFrom.value;
  const to = filterTo.value;

  const filtered = allArticles.filter((article) => {
    if (from && article.article_date < from) return false;
    if (to && article.article_date > to) return false;
    return true;
  });

  renderMap(filtered);
  renderList(filtered);
}

async function loadArticles() {
  const res = await fetch('data.json');
  allArticles = await res.json();
  applyFilter();
}

filterFrom.addEventListener('change', applyFilter);
filterTo.addEventListener('change', applyFilter);
clearFilterBtn.addEventListener('click', () => {
  filterFrom.value = '';
  filterTo.value = '';
  applyFilter();
});

loadArticles();
