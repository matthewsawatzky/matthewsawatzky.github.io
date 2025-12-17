const CONFIG = {
  USERNAME: 'matthewsawatzky',
  REPOS_FILE: 'repos.txt',
  POST_FILE: 'post-of-day.md',
  FEATURED_COUNT: 6,
  CACHE_TTL: 10 * 60 * 1000, // 10 minutes
};

const API_BASE = 'https://api.github.com';

const ui = {
  status: document.getElementById('global-status'),
  postTitle: document.getElementById('post-title'),
  postBody: document.getElementById('post-body'),
  postActions: document.getElementById('post-actions'),
  featuredGrid: document.getElementById('featured-grid'),
  allGrid: document.getElementById('all-grid'),
  toAll: document.getElementById('to-all'),
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modal-close'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalMeta: document.getElementById('modal-meta'),
  modalTag: document.getElementById('modal-tag'),
  modalActions: document.getElementById('modal-actions'),
};

const state = {
  repoRefs: [],
  repos: [],
  repoMap: new Map(),
  readmeCache: new Map(),
};

document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  loadPostOfDay();
  loadRepos();
});

function bindUI() {
  ui.toAll.addEventListener('click', () => {
    const allPanel = document.getElementById('all-panel');
    allPanel?.scrollIntoView({ behavior: 'smooth' });
  });

  ui.modalClose.addEventListener('click', closeModal);
  ui.modal.addEventListener('click', (e) => {
    if (e.target === ui.modal) closeModal();
  });
}

async function loadPostOfDay() {
  setStatus('Loading post of the day…');
  try {
    const text = await fetchText(CONFIG.POST_FILE);
    const post = parsePostFile(text);
    renderPost(post);
    setStatus('');
  } catch (err) {
    console.warn('Post load failed:', err);
    ui.postTitle.textContent = 'Add a post-of-day file';
    ui.postBody.textContent = 'Place post-of-day.md with a Title, optional Link, and content.';
    ui.postActions.innerHTML = '';
    setStatus('');
  }
}

function parsePostFile(text) {
  const lines = text.split(/\r?\n/);
  let title = 'Post of the day';
  let link = '';
  let source = '';
  let idx = 0;

  while (idx < lines.length && /^\s*\w+\s*:/i.test(lines[idx])) {
    const line = lines[idx];
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'title') title = value || title;
    if (key === 'link') link = value;
    if (key === 'source') source = value;
    idx += 1;
  }

  const body = lines.slice(idx).join('\n').trim();
  return { title, link, source, body };
}

async function loadRepos() {
  setStatus('Loading repos from repos.txt…');
  try {
    const repoRefs = await loadRepoRefs(CONFIG.REPOS_FILE);
    state.repoRefs = repoRefs;

    const cacheKey = buildCacheKey(repoRefs);
    const cached = readCache(cacheKey);
    const useCache = cached && Array.isArray(cached.repos);

    const repos = useCache
      ? cached.repos
      : (await Promise.all(repoRefs.map((ref) => fetchRepo(ref)))).filter(Boolean);

    if (!useCache) writeCache(cacheKey, { repos });

    state.repos = repos;
    state.repoMap = new Map(repos.map((repo) => [repo.full_name.toLowerCase(), repo]));

    renderFeatured(repoRefs, repos);
    renderAll(repoRefs, repos);
    setStatus(useCache ? 'Loaded from cache' : 'Loaded live');
  } catch (err) {
    console.error('Repo load failed:', err);
    setStatus('Could not load repos.txt', true);
    ui.featuredGrid.innerHTML = '<p class="lede">Add repos to repos.txt to see them here.</p>';
    ui.allGrid.innerHTML = '';
  }
}

async function loadRepoRefs(file) {
  const text = await fetchText(file);
  const refs = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const parsed = parseRepoLine(line);
      if (parsed) refs.push(parsed);
    });
  return refs;
}

function parseRepoLine(line) {
  const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  let tag = 'Featured';
  let slug = parts[0];
  if (parts.length >= 2) {
    tag = parts[0];
    slug = parts[1];
  }

  const cleaned = slug.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, name] = segments;
  return { tag, owner, name };
}

async function fetchRepo(ref) {
  const url = `${API_BASE}/repos/${ref.owner}/${ref.name}`;
  try {
    const data = await fetchJSON(url);
    return {
      ...data,
      __tag: ref.tag,
    };
  } catch (err) {
    console.warn(`Failed to load ${ref.owner}/${ref.name}:`, err);
    return null;
  }
}

function renderPost(post) {
  ui.postTitle.textContent = post.title;
  ui.postActions.innerHTML = '';

  if (post.link) {
    const btn = document.createElement('a');
    btn.href = post.link;
    btn.target = '_blank';
    btn.rel = 'noreferrer';
    btn.className = 'button button--accent';
    btn.textContent = post.source ? `Open on ${post.source}` : 'Open link';
    ui.postActions.appendChild(btn);
  }

  if (post.body) {
    ui.postBody.innerHTML = renderMarkdown(post.body);
  } else {
    ui.postBody.textContent = 'No content yet. Add body text to post-of-day.md';
  }
}

function renderFeatured(refs, repos) {
  ui.featuredGrid.innerHTML = '';
  const featuredRefs = refs.slice(0, CONFIG.FEATURED_COUNT);
  const cards = featuredRefs
    .map((ref) => repos.find((repo) => repo.full_name.toLowerCase() === `${ref.owner.toLowerCase()}/${ref.name.toLowerCase()}`))
    .filter(Boolean);

  if (!cards.length) {
    ui.featuredGrid.innerHTML = '<p class="lede">Add up to six repos (with optional tags) at the top of repos.txt.</p>';
    return;
  }

  cards.forEach((repo) => ui.featuredGrid.appendChild(buildRepoCard(repo)));
}

function renderAll(refs, repos) {
  ui.allGrid.innerHTML = '';
  const ordered = refs
    .map((ref) => repos.find((repo) => repo.full_name.toLowerCase() === `${ref.owner.toLowerCase()}/${ref.name.toLowerCase()}`))
    .filter(Boolean);

  if (!ordered.length) {
    ui.allGrid.innerHTML = '<p class="lede">Repos listed in repos.txt will appear here in order.</p>';
    return;
  }

  ordered.forEach((repo) => ui.allGrid.appendChild(buildRepoCard(repo)));
}

function buildRepoCard(repo) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.repo = repo.full_name.toLowerCase();

  const owner = repo.owner?.login || CONFIG.USERNAME;
  const language = repo.language || 'Unknown';
  const updated = repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—';
  const tag = repo.__tag || 'Featured';
  const zipUrl = `${repo.html_url}/archive/refs/heads/${repo.default_branch || 'main'}.zip`;

  card.innerHTML = `
    <div class="card__eyebrow">${tag}</div>
    <h3 class="card__title">${repo.name}</h3>
    <div class="card__meta">by ${owner}</div>
    <p class="card__desc">${repo.description || 'No description provided.'}</p>
    <div class="card__meta">
      <span class="badge">★ ${formatNumber(repo.stargazers_count || 0)}</span>
      <span class="badge">🍴 ${formatNumber(repo.forks_count || 0)}</span>
      <span class="badge">${language}</span>
      <span class="badge">Updated ${updated}</span>
    </div>
    <div class="card__actions">
      <a class="button" href="${repo.html_url}" target="_blank" rel="noreferrer">View on GitHub</a>
      <a class="button" href="${zipUrl}" target="_blank" rel="noreferrer">Download ZIP</a>
    </div>
  `;

  card.addEventListener('click', () => openReadme(repo));
  card.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));

  return card;
}

async function openReadme(repo) {
  ui.modalTag.textContent = repo.__tag || 'Featured';
  ui.modalTitle.textContent = repo.name;
  ui.modalMeta.textContent = `${repo.owner?.login || CONFIG.USERNAME} · Updated ${repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—'}`;
  ui.modalBody.textContent = 'Loading README…';
  ui.modalActions.innerHTML = '';

  const gitHubLink = document.createElement('a');
  gitHubLink.className = 'button button--accent';
  gitHubLink.href = repo.html_url;
  gitHubLink.target = '_blank';
  gitHubLink.rel = 'noreferrer';
  gitHubLink.textContent = 'View on GitHub';

  const zipUrl = `${repo.html_url}/archive/refs/heads/${repo.default_branch || 'main'}.zip`;
  const downloadLink = document.createElement('a');
  downloadLink.className = 'button';
  downloadLink.href = zipUrl;
  downloadLink.target = '_blank';
  downloadLink.rel = 'noreferrer';
  downloadLink.textContent = 'Download ZIP';

  ui.modalActions.appendChild(gitHubLink);
  ui.modalActions.appendChild(downloadLink);

  openModal();

  const cached = state.readmeCache.get(repo.full_name.toLowerCase());
  if (cached) {
    ui.modalBody.innerHTML = cached;
    return;
  }

  try {
    const readme = await fetchReadme(repo.owner?.login || CONFIG.USERNAME, repo.name);
    const html = readme ? renderMarkdown(readme) : 'README not available.';
    ui.modalBody.innerHTML = html;
    state.readmeCache.set(repo.full_name.toLowerCase(), html);
  } catch (err) {
    console.warn('README load failed:', err);
    ui.modalBody.innerHTML = 'README not available. Open on GitHub to view.';
  }
}

function openModal() {
  ui.modal.classList.add('is-open');
  ui.modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  ui.modal.classList.remove('is-open');
  ui.modal.setAttribute('aria-hidden', 'true');
}

async function fetchReadme(owner, name) {
  const url = `${API_BASE}/repos/${owner}/${name}/readme`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3.raw' } });
  if (!res.ok) throw new Error(`README fetch failed ${res.status}`);
  return res.text();
}

async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Fetch failed for ${path}: ${res.status}`);
  return res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(`GitHub API error ${res.status}: ${msg || res.statusText}`);
  }
  return res.json();
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (err) {
    return '';
  }
}

function renderMarkdown(md) {
  if (!md) return '';
  const raw = typeof marked !== 'undefined' ? marked.parse(md) : md.replace(/\n/g, '<br>');
  if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(raw);
  return raw;
}

function setStatus(message, isError = false) {
  if (!ui.status) return;
  ui.status.textContent = message;
  ui.status.style.color = isError ? '#f87171' : 'var(--accent)';
}

function formatNumber(value) {
  if (value === undefined || value === null) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toString();
}

function buildCacheKey(refs) {
  const listKey = refs.map((r) => `${r.owner.toLowerCase()}/${r.name.toLowerCase()}:${r.tag}`).join('|');
  return `gh-showcase:${CONFIG.USERNAME}:${listKey}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.ts || Date.now() - parsed.ts > CONFIG.CACHE_TTL) return null;
    return parsed.payload;
  } catch (err) {
    console.warn('Cache read failed:', err);
    return null;
  }
}

function writeCache(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), payload }));
  } catch (err) {
    console.warn('Cache write failed:', err);
  }
}
