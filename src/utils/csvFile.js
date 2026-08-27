// Writing a CSV the way a spreadsheet expects to read one.
//
// A BOM so Excel reads it as UTF-8 without an import step, CRLF line endings, and
// quoting only where a value would otherwise break the row apart. Shared, because
// two exports formatting their files differently is a difference nobody intends
// and everybody eventually trips over.

export const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (headers, rows) =>
    `\uFEFF${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

// Hands the file to the browser. Returns nothing: a download either happens or is
// refused by the browser, and there is no third outcome worth reporting.
export const downloadCsv = (filename, headers, rows) => {
    const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};
