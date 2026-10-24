import { describe, it, expect } from 'vitest';
import { canAccessPage, canAccessPath, accessKeysFor, visibleSubpages, SUBPAGE_ROLE_REQUIREMENTS } from './pageAccess';

describe('accessKeysFor — which rules an address falls under', () => {
  it('reads the page and, when there is one, the subpage', () => {
    expect(accessKeysFor('/telecaller/referrals')).toEqual({ page: 'telecaller', subpage: 'telecaller/referrals' });
    expect(accessKeysFor('/telecaller/customer/12')).toEqual({ page: 'telecaller', subpage: 'telecaller/customer' });
    expect(accessKeysFor('/telecaller')).toEqual({ page: 'telecaller', subpage: null });
    expect(accessKeysFor('/')).toEqual({ page: '', subpage: null });
  });
});

describe('canAccessPath — subpages carry their own roles', () => {
  it('lets a referral-only person into the referral list but not the call list', () => {
    // The point of per-subpage rules: someone can be given the referral queue
    // without the telecallers' customer calls and salary figures.
    const roles = ['REFERRAL ENQUIRIES'];
    expect(canAccessPath('/telecaller/referrals', roles)).toBe(true);
    expect(canAccessPath('/telecaller/calls', roles)).toBe(false);
    expect(canAccessPath('/telecaller/customer/7', roles)).toBe(false);
  });
  it('lets a telecaller into both', () => {
    for (const p of ['/telecaller', '/telecaller/calls', '/telecaller/referrals', '/telecaller/customer/7']) {
      expect(canAccessPath(p, ['TELECALLER'])).toBe(true);
    }
  });
  it('lets anyone who can open a subpage reach the hub, and nobody else', () => {
    expect(canAccessPath('/telecaller', ['REFERRAL ENQUIRIES'])).toBe(true);
    expect(canAccessPath('/telecaller', ['SALESMAN'])).toBe(false);
  });
  it('keeps the owner and god-mode bypasses, and ungated pages open', () => {
    expect(canAccessPath('/telecaller/calls', ['OWNER'])).toBe(true);
    expect(canAccessPath('/telecaller/calls', ['PWA GOD'], true)).toBe(true);
    expect(canAccessPath('/telecaller/calls', ['PWA GOD'], false)).toBe(false);
    expect(canAccessPath('/track', [])).toBe(true);
  });
  it('leaves page-level checks as they were', () => {
    expect(canAccessPage('salesman', ['SALESMAN'])).toBe(true);
    expect(canAccessPage('salesman', ['TELECALLER'])).toBe(false);
  });
});

describe('visibleSubpages — the hub shows only what you may open', () => {
  it('lists the subpages of a page a person may open', () => {
    expect(visibleSubpages('telecaller', ['REFERRAL ENQUIRIES'])).toEqual(['telecaller/referrals']);
    expect(visibleSubpages('telecaller', ['TELECALLER'])).toEqual(expect.arrayContaining(['telecaller/calls', 'telecaller/referrals']));
    // Detail routes are reached from a list, never offered on the hub.
    expect(visibleSubpages('telecaller', ['TELECALLER'])).not.toContain('telecaller/customer');
  });
  it('every subpage rule belongs to a gated page', () => {
    for (const key of Object.keys(SUBPAGE_ROLE_REQUIREMENTS)) {
      expect(canAccessPage(key.split('/')[0], [])).toBe(false);
    }
  });
});

describe('reports — each folder has its own people', () => {
  it('shows the inbound call report to a senior telecaller, not to a telecaller', () => {
    expect(canAccessPath('/reports/telecalling/inbound-calls', ['SENIOR TELECALLER'])).toBe(true);
    expect(canAccessPath('/reports', ['SENIOR TELECALLER'])).toBe(true);
    expect(canAccessPath('/reports/telecalling/inbound-calls', ['TELECALLER'])).toBe(false);
  });
  it('keeps production reports with production and inventory, away from telecalling', () => {
    expect(canAccessPath('/reports/production/batch', ['FACTORY INVENTORY'])).toBe(true);
    expect(canAccessPath('/reports/production/batch', ['SENIOR TELECALLER'])).toBe(false);
    expect(canAccessPath('/reports/telecalling/inbound-calls', ['FACTORY PRODUCTION'])).toBe(false);
  });
  it('lets the owner into both', () => {
    expect(canAccessPath('/reports/telecalling/inbound-calls', ['OWNER'])).toBe(true);
    expect(canAccessPath('/reports/production/batch', ['OWNER'])).toBe(true);
  });
});
