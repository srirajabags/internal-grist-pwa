// Rupees, written the Indian way.

export const rupees = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;

// Short enough for a phone column: crore, lakh, thousand. Two decimals for
// crore and lakh (₹3.56L, not ₹3.6L, as a lakh is a lot of bags), one for
// thousands, and trailing zeros dropped (₹2L, not ₹2.00L).
export const compactRupees = (v) => {
    const n = Math.round(Number(v) || 0);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    const trim = (x, d) => String(+x.toFixed(d));
    if (a >= 1e7) return `${sign}₹${trim(a / 1e7, 2)}Cr`;
    if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 2)}L`;
    if (a >= 1e3) return `${sign}₹${trim(a / 1e3, 1)}k`;
    return `${sign}₹${a}`;
};
