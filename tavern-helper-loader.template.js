(async () => {
  const repo = 'YOUR_GITHUB_USERNAME/branch-page-stash';
  const fallbackTag = 'v0.25';
  const loaderState = {
    repo,
    fallbackTag,
    requestedAt: new Date().toISOString(),
  };
  window.__TH_BRANCH_PAGE_STASH_LOADER__ = loaderState;

  async function load(tag, source) {
    const url = `https://gcore.jsdelivr.net/gh/${repo}@${tag}/index.js`;
    Object.assign(loaderState, {
      loadedTag: tag,
      source,
      url,
      loadedAt: new Date().toISOString(),
    });
    await import(url);
    console.info(`[branch-page-stash] Loaded ${tag} from ${source}.`);
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub latest release ${response.status}`);
    const release = await response.json();
    const tag = release && release.tag_name ? release.tag_name : fallbackTag;
    await load(tag, 'latest');
  } catch (error) {
    loaderState.error = String(error && error.message || error);
    console.warn('[branch-page-stash] Falling back to pinned version.', error);
    await load(fallbackTag, 'fallback');
  }
})();
