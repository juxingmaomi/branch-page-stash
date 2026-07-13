(async () => {
  const REPO = 'YOUR_GITHUB_USERNAME/branch-page-stash';
  const VERSION = 'v0.41';
  const URL = `https://gcore.jsdelivr.net/gh/${REPO}@${VERSION}/index.js`;

  const loaderState = {
    repo: REPO,
    loadedTag: VERSION,
    source: 'manual',
    url: URL,
    requestedAt: new Date().toISOString(),
  };
  window.__TH_BRANCH_PAGE_STASH_LOADER__ = loaderState;

  function popup(type, message) {
    const toastr = window.toastr || window.parent && window.parent.toastr;
    if (toastr && typeof toastr[type] === 'function') {
      toastr[type](message);
      return;
    }
    if (type === 'error') {
      alert(message);
      return;
    }
    console.log(`[branch-page-stash] ${message}`);
  }

  try {
    await import(URL);
    loaderState.loadedAt = new Date().toISOString();
    popup('success', `分支页面暂存器已加载 ${VERSION}`);
  } catch (error) {
    loaderState.error = String(error && error.message || error);
    console.error('[branch-page-stash] Load failed.', error);
    popup('error', `分支页面暂存器 ${VERSION} 加载失败。请确认 GitHub 已发布这个版本。`);
  }
})();
