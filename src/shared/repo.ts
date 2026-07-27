/**
 * Single source of truth for every link to the repository — help page, README,
 * CONTRIBUTING, issue reporting, and electron-builder's `publish` target.
 * Product name: "Sheaf". Public-facing full name: "Sheaf Browser".
 */
export const SHEAF_REPO = 'https://github.com/rajeshkumaravel/sheaf-browser'

/** True while the repo URL is still the placeholder — the UI says so plainly. */
export const REPO_IS_PLACEHOLDER = SHEAF_REPO.includes('REPLACE-ME')

export const SHEAF_ISSUES = `${SHEAF_REPO}/issues`
export const SHEAF_NEW_ISSUE = `${SHEAF_REPO}/issues/new`
export const SHEAF_CONTRIBUTING = `${SHEAF_REPO}/blob/main/CONTRIBUTING.md`
export const SHEAF_SECURITY = `${SHEAF_REPO}/blob/main/SECURITY.md`
export const SHEAF_RELEASES = `${SHEAF_REPO}/releases`
