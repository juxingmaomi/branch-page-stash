(async () => {
  const url = 'https://gcore.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/branch-page-stash@v0.25/index.js';
  window.__TH_BRANCH_PAGE_STASH_LOADER__ = {
    repo: 'YOUR_GITHUB_USERNAME/branch-page-stash',
    loadedTag: 'v0.25',
    source: 'pinned',
    url,
    loadedAt: new Date().toISOString(),
  };
  await import(url);
})();
