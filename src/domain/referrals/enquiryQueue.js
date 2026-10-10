// The telecallers' queue of enquiries from the referral portal: what to work
// next, and what a telecaller may move an enquiry to.
//
// Priority comes from Grist (Referral_Enquiries.Priority_Rank, from the
// affiliate's lead quality). Within one priority the OLDEST waits shortest, so a
// steady stream of new leads cannot keep pushing an old one to the bottom.

export const OPEN_STATUSES = ['New', 'Contacted', 'Qualified', 'Quotation sent'];
export const DONE_STATUSES = ['Order confirmed', 'Not a fit', 'Duplicate'];

// Blank status is how Grist leaves a row nobody has touched: it is new.
export const statusOf = (e) => (e?.Status ? String(e.Status) : 'New');
export const isOpen = (e) => !DONE_STATUSES.includes(statusOf(e));

export const FILTERS = {
  open: { label: 'Open', test: isOpen },
  new: { label: 'New', test: (e) => statusOf(e) === 'New' },
  done: { label: 'Done', test: (e) => !isOpen(e) },
  all: { label: 'All', test: () => true },
};

const rank = (e) => Number(e?.Priority_Rank) || 2;
const at = (e) => Number(e?.Submitted_At) || 0;
const score = (e) => (e?.Lead_Score === null || e?.Lead_Score === undefined ? 0.5 : Number(e.Lead_Score));

export const SORTS = {
  // Open before done, then High > Normal > Low, then oldest first.
  priority: { label: 'Priority', compare: (a, b) => (isOpen(b) - isOpen(a)) || (rank(a) - rank(b)) || (at(a) - at(b)) },
  newest: { label: 'Newest', compare: (a, b) => at(b) - at(a) },
  score: { label: 'Lead score', compare: (a, b) => (score(b) - score(a)) || (at(a) - at(b)) },
};

export const queueOf = (enquiries, { filter = 'open', sort = 'priority' } = {}) =>
  (enquiries || []).filter((FILTERS[filter] ?? FILTERS.open).test).slice().sort((SORTS[sort] ?? SORTS.priority).compare);

// Where a telecaller can take an enquiry from where it is. "Order confirmed" is
// not offered: it follows from linking the customer, whose orders then earn the
// affiliate their commission. Closing is always possible; reopening a closed one
// returns it to Contacted rather than New, since someone has already looked.
const FORWARD = {
  New: ['Contacted'],
  Contacted: ['Qualified'],
  Qualified: ['Quotation sent'],
  'Quotation sent': [],
};
export const nextStatuses = (e) => {
  const s = statusOf(e);
  if (DONE_STATUSES.includes(s)) return s === 'Order confirmed' ? [] : ['Contacted'];
  return [...(FORWARD[s] ?? []), 'Not a fit', 'Duplicate'];
};

// "3 days ago", for how long an enquiry has waited. Whole units, rounded down.
export const ageLabel = (submittedAtS, nowMs = Date.now()) => {
  if (!submittedAtS) return '';
  const mins = Math.max(0, Math.floor((nowMs / 1000 - submittedAtS) / 60));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
};

// Dial and WhatsApp links for a stored +91XXXXXXXXXX number.
export const contactLinks = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  return { tel: `tel:+91${ten}`, whatsapp: `https://wa.me/91${ten}` };
};

// A telecaller's note, added below what is there, stamped with the IST date and
// who wrote it, so the history of calls reads top to bottom.
const NOTE_DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
export const appendNote = (existing, text, who, nowMs = Date.now()) => {
  const body = String(text || '').trim();
  if (!body) return String(existing || '');
  const line = `${NOTE_DATE.format(new Date(nowMs))}${who ? ` · ${who}` : ''}: ${body}`;
  return existing ? `${String(existing).trimEnd()}\n${line}` : line;
};
