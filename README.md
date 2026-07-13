# Branch Page Stash

SillyTavern TavernHelper script for the branch page stash tool.

## Files

- `index.js`: the real script loaded by TavernHelper.
- `tavern-helper-loader.template.js`: paste this small loader into TavernHelper after replacing `YOUR_GITHUB_USERNAME`. Update `VERSION` manually when you want to switch versions.

## Publish

1. Create a public GitHub repository, for example `branch-page-stash`.
2. Upload `index.js` to the repository root.
3. Create a release/tag such as `v0.37`.
4. In TavernHelper, use the loader template. It loads the version written in `VERSION`:

```js
https://gcore.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/branch-page-stash@v0.37/index.js
```

The loader shows a success popup after the version loads, and an error popup if the tag or network request fails.

jsDelivr does not need an account. It serves public GitHub files through CDN URLs.
