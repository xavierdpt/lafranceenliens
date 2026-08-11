const FRANCE_CENTER = [46.6, 2.4];
const FRANCE_ZOOM = 6;

const map = L.map('map').setView(FRANCE_CENTER, FRANCE_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

let pickedMarker = null;
const layers = new Map(); // id -> { marker, circle }
const selectedTags = new Set();

const form = document.getElementById('articleForm');
const latInput = document.getElementById('lat');
const lngInput = document.getElementById('lng');
const tagsInput = document.getElementById('tags');
const formError = document.getElementById('formError');
const articleList = document.getElementById('articleList');
const articleCount = document.getElementById('articleCount');
const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const clearFilterBtn = document.getElementById('clearFilter');
const tagFilterContainer = document.getElementById('tagFilter');

map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  latInput.value = lat.toFixed(5);
  lngInput.value = lng.toFixed(5);

  if (pickedMarker) {
    pickedMarker.setLatLng(e.latlng);
  } else {
    pickedMarker = L.marker(e.latlng, { opacity: 0.6 }).addTo(map);
  }
});

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
    const tagsLine = article.tags && article.tags.length
      ? `<br/><span class="popup-tags">${article.tags.map(escapeHtml).join(', ')}</span>`
      : '';
    marker.bindPopup(
      `<strong>${escapeHtml(article.title)}</strong><br/>` +
      `${escapeHtml(article.location_name)} &middot; ${escapeHtml(article.article_date)}${tagsLine}<br/>` +
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
    li.textContent = 'No articles yet.';
    articleList.appendChild(li);
    return;
  }

  for (const article of articles) {
    const li = document.createElement('li');
    li.className = 'article-item';
    const tagBadges = (article.tags || [])
      .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
      .join('');
    li.innerHTML = `
      <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
      <div class="article-meta">
        <span>${escapeHtml(article.location_name)} &middot; ${escapeHtml(article.radius_km)} km</span>
        <span>${escapeHtml(article.article_date)}</span>
      </div>
      ${tagBadges ? `<div class="tag-badges">${tagBadges}</div>` : ''}
      <button class="article-delete" data-id="${article.id}" type="button">Remove</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.article-delete') || e.target.closest('a')) return;
      map.setView([article.lat, article.lng], 9);
      const entry = layers.get(article.id);
      if (entry) entry.marker.openPopup();
    });
    articleList.appendChild(li);
  }

  articleList.querySelectorAll('.article-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Remove this article?')) return;
      await fetch(`/api/articles/${id}`, { method: 'DELETE' });
      loadArticles();
    });
  });
}

function renderTagChips(tags) {
  tagFilterContainer.innerHTML = '';

  if (!tags.length) {
    const span = document.createElement('span');
    span.className = 'empty-state';
    span.textContent = 'No tags yet.';
    tagFilterContainer.appendChild(span);
    return;
  }

  for (const tag of tags) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip' + (selectedTags.has(tag.name) ? ' active' : '');
    chip.textContent = `${tag.name} (${tag.count})`;
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag.name)) {
        selectedTags.delete(tag.name);
      } else {
        selectedTags.add(tag.name);
      }
      chip.classList.toggle('active');
      loadArticles();
    });
    tagFilterContainer.appendChild(chip);
  }
}

async function loadTags() {
  const res = await fetch('/api/tags');
  const tags = await res.json();
  renderTagChips(tags);
}

async function loadArticles() {
  const params = new URLSearchParams();
  if (filterFrom.value) params.set('from', filterFrom.value);
  if (filterTo.value) params.set('to', filterTo.value);
  if (selectedTags.size) params.set('tags', Array.from(selectedTags).join(','));

  const res = await fetch(`/api/articles?${params.toString()}`);
  const articles = await res.json();

  renderMap(articles);
  renderList(articles);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  const payload = {
    title: document.getElementById('title').value,
    url: document.getElementById('url').value,
    article_date: document.getElementById('articleDate').value,
    location_name: document.getElementById('locationName').value,
    lat: Number(latInput.value),
    lng: Number(lngInput.value),
    radius_km: Number(document.getElementById('radiusKm').value),
    tags: tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
  };

  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    formError.textContent = err.error || 'Failed to add article.';
    return;
  }

  form.reset();
  document.getElementById('radiusKm').value = 10;
  if (pickedMarker) {
    map.removeLayer(pickedMarker);
    pickedMarker = null;
  }
  loadTags();
  loadArticles();
});

filterFrom.addEventListener('change', loadArticles);
filterTo.addEventListener('change', loadArticles);
clearFilterBtn.addEventListener('click', () => {
  filterFrom.value = '';
  filterTo.value = '';
  selectedTags.clear();
  loadTags();
  loadArticles();
});

loadTags();
loadArticles();
