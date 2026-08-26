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
  production: ['FACTORY PRODUCTION', 'ROLLS TO SHEETS OPERATOR', 'ROLLS TO DCUT OPERATOR', 'ROLLS TO SIDEPATTY OPERATOR', 'ROLLS TO HANDLES OPERATOR', 'ROLLS TO PRESSING HANDLES OPERATOR'],
  inventory: ['FACTORY INVENTORY'],
  telecaller: ['TELECALLER', 'SENIOR TELECALLER'],
  design: ['DESIGN CONFIRMATION'],
  printing: ['FACTORY PRINTING'],
  stitching: ['FACTORY STITCHING'],
};

// PWA GOD is a maintenance role, not a licence to browse: it unlocks everything
// only while god mode is switched on from the home header, so a holder normally
// sees exactly what their other roles grant and has to opt in to look wider.
export const GOD_ROLE = 'PWA GOD';
export const hasGodRole = (userRoles = []) => userRoles.includes(GOD_ROLE);

// Returns true if a user with the given roles may access the page. `godMode` is
// the opt-in bypass and only counts for a holder of GOD_ROLE.
export const canAccessPage = (pageId, userRoles = [], godMode = false) => {
  const required = PAGE_ROLE_REQUIREMENTS[pageId];
  if (!required || required.length === 0) return true; // ungated page
  if (userRoles.includes('OWNER')) return true;        // owner bypass
  if (godMode && hasGodRole(userRoles)) return true;   // opt-in bypass
  return required.some((role) => userRoles.includes(role));
};
