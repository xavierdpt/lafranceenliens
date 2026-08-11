const db = require('../db');
const { validateArticle, insertArticleWithTags } = require('../lib/articles');

const REPO = process.env.GITHUB_REPOSITORY || 'xavierdpt/lafranceenliens';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const SUBMISSION_LABEL = 'submission';
const INTEGRATED_LABEL = 'integrated';
const NEEDS_CHANGES_LABEL = 'needs-changes';
const ERROR_COMMENT_MARKER = '<!-- import-bot:validation-error -->';

if (!TOKEN) {
  console.error('Set a GITHUB_TOKEN (or GH_TOKEN) environment variable with issues:write access before running this script.');
  process.exit(1);
}

async function gh(pathname, options = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${options.method || 'GET'} ${pathname} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Parses the "### Label\n\nvalue" sections produced by the site's submission form
// (and by the .github/ISSUE_TEMPLATE/submit-article.md template).
function parseTemplateBody(body) {
  const sections = {};
  const re = /^### (.+?)\s*\r?\n+([\s\S]*?)(?=\r?\n### |\r?\n*$)/gm;
  let match;
  while ((match = re.exec(body || '')) !== null) {
    const label = match[1].trim().toLowerCase();
    const value = match[2].trim();
    sections[label] = value.toLowerCase() === '_no response_' ? '' : value;
  }
  return sections;
}

function fieldsToArticle(sections) {
  return {
    title: sections['title'],
    url: sections['url'],
    article_date: sections['date (yyyy-mm-dd)'] || sections['date'],
    location_name: sections['location name'],
    lat: sections['latitude'],
    lng: sections['longitude'],
    radius_km: sections['radius km'],
    tags: sections['tags (comma separated)'] || sections['tags'] || '',
  };
}

async function ensureErrorComment(issue, errors) {
  const message = `${ERROR_COMMENT_MARKER}\nThis submission couldn't be imported automatically:\n\n${errors.map((e) => `- ${e}`).join('\n')}\n\nEdit the issue description to fix the above — it will be picked up on the next import run.`;

  const comments = await gh(`/repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
  const alreadyPosted = comments.some((c) => c.body.trim() === message.trim());
  if (!alreadyPosted) {
    await gh(`/repos/${REPO}/issues/${issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: message }),
    });
  }

  if (!issue.labels.some((l) => l.name === NEEDS_CHANGES_LABEL)) {
    await gh(`/repos/${REPO}/issues/${issue.number}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: [NEEDS_CHANGES_LABEL] }),
    });
  }
}

async function integrate(issue, value) {
  const articleId = insertArticleWithTags(db, value, value.tags);

  await gh(`/repos/${REPO}/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `Imported into the map database as article #${articleId}. Thanks for the contribution!` }),
  });
  await gh(`/repos/${REPO}/issues/${issue.number}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: [INTEGRATED_LABEL] }),
  });
  if (issue.labels.some((l) => l.name === NEEDS_CHANGES_LABEL)) {
    await gh(`/repos/${REPO}/issues/${issue.number}/labels/${NEEDS_CHANGES_LABEL}`, { method: 'DELETE' });
  }
  await gh(`/repos/${REPO}/issues/${issue.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });

  return articleId;
}

async function run() {
  const issues = await gh(`/repos/${REPO}/issues?state=open&labels=${SUBMISSION_LABEL}&per_page=100`);
  const pending = issues.filter((issue) => !issue.pull_request && !issue.labels.some((l) => l.name === INTEGRATED_LABEL));

  console.log(`Found ${pending.length} pending submission issue(s).`);

  for (const issue of pending) {
    const article = fieldsToArticle(parseTemplateBody(issue.body));
    const { valid, errors, value } = validateArticle(article);

    if (!valid) {
      console.log(`#${issue.number} "${issue.title}": invalid — ${errors.join('; ')}`);
      await ensureErrorComment(issue, errors);
      continue;
    }

    const articleId = await integrate(issue, value);
    console.log(`#${issue.number} "${issue.title}": imported as article #${articleId}`);
  }
}

run()
  .then(() => db.close())
  .catch((err) => {
    console.error(err);
    db.close();
    process.exit(1);
  });
