// Centralised page access control based on Team table Roles.
//
// PAGE_ROLE_REQUIREMENTS maps a page id to the roles allowed to view/navigate
// to it. Pages not listed here are visible to everyone. Users with the OWNER
// role can access every page regardless of this map.
export const PAGE_ROLE_REQUIREMENTS = {
  table: ['PWA TABLE VIEWER'],
  salesman: ['SALESMAN'],
  sql: ['SQL USER'],
  // factory: ['FACTORY PRINTING'],
  production: ['FACTORY PRODUCTION', 'ROLLS TO SHEETS OPERATOR', 'ROLLS TO DCUT OPERATOR', 'ROLLS TO SIDEPATTY OPERATOR', 'ROLLS TO HANDLES OPERATOR', 'ROLLS TO PRESSING HANDLES OPERATOR', 'FINISHED STOCK COLLECTOR'],
  inventory: ['FACTORY INVENTORY', 'INVENTORY VIEWER', 'BAGS GODOWN INCHARGE', 'ROLLS GODOWN INCHARGE', 'PRINTING AREA INCHARGE'],
  // Anyone who may open one of its subpages (SUBPAGE_ROLE_REQUIREMENTS) reaches
  // the /telecaller hub; each subpage then checks its own roles.
  telecaller: ['TELECALLER', 'SENIOR TELECALLER', 'REFERRAL ENQUIRIES'],
  design: ['DESIGN CONFIRMATION'],
  printing: ['FACTORY PRINTING'],
  stitching: ['FACTORY STITCHING'],
  // Batch reports read production and godown figures, so they go to the people
  // who run those, not to every logged-in user.
  reports: ['FACTORY PRODUCTION', 'FACTORY INVENTORY'],
};

// Subpages with their own roles, keyed "page/subpage" from the first two path
// segments. A subpage not listed here inherits its page's rule. Keep each page's
// entry above a superset of its subpages' roles, or the hub locks people out.
export const SUBPAGE_ROLE_REQUIREMENTS = {
  // Customer calls and the telecallers' salary figures.
  'telecaller/calls': ['TELECALLER', 'SENIOR TELECALLER'],
  'telecaller/customer': ['TELECALLER', 'SENIOR TELECALLER'],
  // Enquiries from the referral portal. REFERRAL ENQUIRIES lets someone work this
  // queue without seeing the call list.
  'telecaller/referrals': ['TELECALLER', 'SENIOR TELECALLER', 'REFERRAL ENQUIRIES'],
};

// The page and (if any) subpage rule an address falls under.
export const accessKeysFor = (pathname = '') => {
  const [page = '', sub] = String(pathname).split('/').filter(Boolean);
  return { page, subpage: sub ? `${page}/${sub}` : null };
};

// PWA GOD is a maintenance role, not a licence to browse: it unlocks everything
// only while god mode is switched on from the home header, so a holder normally
// sees exactly what their other roles grant and has to opt in to look wider.
export const GOD_ROLE = 'PWA GOD';
export const hasGodRole = (userRoles = []) => userRoles.includes(GOD_ROLE);

// Returns true if a user with the given roles may access the page. `godMode` is
// the opt-in bypass and only counts for a holder of GOD_ROLE.
const allowed = (required, userRoles = [], godMode = false) => {
  if (!required || required.length === 0) return true; // ungated
  if (userRoles.includes('OWNER')) return true;        // owner bypass
  if (godMode && hasGodRole(userRoles)) return true;   // opt-in bypass
  return required.some((role) => userRoles.includes(role));
};

export const canAccessPage = (pageId, userRoles = [], godMode = false) =>
  allowed(PAGE_ROLE_REQUIREMENTS[pageId], userRoles, godMode);

// The whole address: its page rule, then its subpage rule if it has one.
export const canAccessPath = (pathname, userRoles = [], godMode = false) => {
  const { page, subpage } = accessKeysFor(pathname);
  if (!canAccessPage(page, userRoles, godMode)) return false;
  return !subpage || allowed(SUBPAGE_ROLE_REQUIREMENTS[subpage], userRoles, godMode);
};

// Whether an address is gated at all, so the guard can show a spinner while
// roles load instead of flashing "unauthorised".
export const isGatedPath = (pathname) => {
  const { page, subpage } = accessKeysFor(pathname);
  return page in PAGE_ROLE_REQUIREMENTS || (subpage !== null && subpage in SUBPAGE_ROLE_REQUIREMENTS);
};

// A page's hub tiles: the subpages this person may open. Detail routes (a
// customer) are reached from a list, never offered on the hub.
const DETAIL_SUBPAGES = new Set(['telecaller/customer']);
export const visibleSubpages = (pageId, userRoles = [], godMode = false) =>
  Object.keys(SUBPAGE_ROLE_REQUIREMENTS)
    .filter((key) => key.startsWith(`${pageId}/`) && !DETAIL_SUBPAGES.has(key))
    .filter((key) => allowed(SUBPAGE_ROLE_REQUIREMENTS[key], userRoles, godMode));
