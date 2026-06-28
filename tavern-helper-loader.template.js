(async () => {
  const repo = 'YOUR_GITHUB_USERNAME/branch-page-stash';
  const fallbackTag = 'v0.24';

  async function load(tag) {
    await import(`https://gcore.jsdelivr.net/gh/${repo}@${tag}/index.js`);
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub latest release ${response.status}`);
    const release = await response.json();
    const tag = release && release.tag_name ? release.tag_name : fallbackTag;
    await load(tag);
  } catch (error) {
    console.warn('[branch-page-stash] Falling back to pinned version.', error);
    await load(fallbackTag);
  }
})();
