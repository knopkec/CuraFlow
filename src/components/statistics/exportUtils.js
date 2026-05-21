import { jsPDF } from 'jspdf';

function buildFileSuffix(month) {
    if (month === 'all') {
        return 'gesamt';
    }

    const monthNumber = Number.parseInt(month, 10) + 1;
    return `monat-${String(monthNumber).padStart(2, '0')}`;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

const DANGEROUS_SPREADSHEET_PREFIX = /^[=+\-@]/;

export function sanitizeSpreadsheetCell(value) {
    const normalizedValue = String(value ?? '');
    return DANGEROUS_SPREADSHEET_PREFIX.test(normalizedValue)
        ? `'${normalizedValue}`
        : normalizedValue;
}

export function escapeCsvCell(value) {
    return `"${sanitizeSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

export function escapeHtmlCell(value) {
    return sanitizeSpreadsheetCell(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function buildStatisticsMatrix(stats) {
    const headers = [
        'Name',
        'Rolle',
        'Gesamt Dienste',
        'Gesamt Arbeitsplaetze',
        ...stats.serviceItems,
        ...stats.rotationItems,
    ];

    const rows = stats.byDoctor.map((doctor) => [
        doctor.name,
        doctor.role,
        doctor.totalDienste,
        doctor.totalRotationen,
        ...stats.serviceItems.map((item) => doctor.breakdown[item] || 0),
        ...stats.rotationItems.map((item) => doctor.breakdown[item] || 0),
    ]);

    return { headers, rows };
}

export function exportStatisticsCsv({ stats, year, month }) {
    const { headers, rows } = buildStatisticsMatrix(stats);
    const csvContent = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `statistik_${year}_${buildFileSuffix(month)}.csv`);
}

export function exportStatisticsExcel({ stats, year, month, title }) {
    const { headers, rows } = buildStatisticsMatrix(stats);
    const tableHeader = headers.map((header) => `<th>${escapeHtmlCell(header)}</th>`).join('');
    const tableRows = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtmlCell(cell)}</td>`).join('')}</tr>`)
        .join('');

    const html = `
        <html>
            <head>
                <meta charset="UTF-8" />
                <style>
                    body { font-family: Arial, sans-serif; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
                    th { background: #e2e8f0; font-weight: 700; }
                    h1 { font-size: 18px; margin-bottom: 12px; }
                </style>
            </head>
            <body>
                <h1>${escapeHtmlCell(title)}</h1>
                <table>
                    <thead>
                        <tr>${tableHeader}</tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </body>
        </html>
    `;

    const blob = new Blob([`\ufeff${html}`], {
        type: 'application/vnd.ms-excel;charset=utf-8;',
    });

    downloadBlob(blob, `statistik_${year}_${buildFileSuffix(month)}.xls`);
}

export function exportStatisticsPdf({ stats, year, month, title }) {
    const { headers, rows } = buildStatisticsMatrix(stats);
    const pdfDocument = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'a4',
        compress: true,
    });

    const pageWidth = pdfDocument.internal.pageSize.getWidth();
    const pageHeight = pdfDocument.internal.pageSize.getHeight();
    const margin = 40;
    const lineHeight = 11;
    const maxTextWidth = pageWidth - (margin * 2);

    let cursorY = margin;

    pdfDocument.setFont('helvetica', 'bold');
    pdfDocument.setFontSize(16);
    pdfDocument.text(title, margin, cursorY);
    cursorY += 24;

    pdfDocument.setFont('helvetica', 'normal');
    pdfDocument.setFontSize(10);
    pdfDocument.text(`Exportjahr: ${year}`, margin, cursorY);
    cursorY += 12;
    pdfDocument.text(`Filter: ${month === 'all' ? 'Ganzes Jahr' : `Monat ${Number.parseInt(month, 10) + 1}`}`, margin, cursorY);
    cursorY += 18;

    const printableLines = [
        headers.join(' | '),
        ...rows.map((row) => row.join(' | ')),
    ];

    printableLines.forEach((line, index) => {
        const wrappedLines = pdfDocument.splitTextToSize(line, maxTextWidth);

        if (cursorY + (wrappedLines.length * lineHeight) > pageHeight - margin) {
            pdfDocument.addPage();
            cursorY = margin;
        }

        pdfDocument.setFont('courier', index === 0 ? 'bold' : 'normal');
        pdfDocument.setFontSize(8);
        pdfDocument.text(wrappedLines, margin, cursorY);
        cursorY += (wrappedLines.length * lineHeight) + 4;
    });

    pdfDocument.save(`statistik_${year}_${buildFileSuffix(month)}.pdf`);
}
