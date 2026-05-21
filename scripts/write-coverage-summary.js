import fs from 'node:fs';
import path from 'node:path';

const coverageRoot = path.resolve(process.cwd(), 'coverage');
const githubStepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const coverageSummaryPath = path.resolve(coverageRoot, 'coverage-summary.json');

function writeOutput(text) {
  if (githubStepSummaryPath) {
    fs.appendFileSync(githubStepSummaryPath, text);
    return;
  }

  process.stdout.write(text);
}

function formatPercent(value) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : 'n/a';
}

function thresholdStatus(value, threshold) {
  if (typeof value !== 'number') {
    return 'not measured';
  }

  return value >= threshold ? 'meets target' : 'below target';
}

function readCoverageSummary() {
  if (!fs.existsSync(coverageSummaryPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
}

function findCoverageEntry(summary, filePath) {
  const normalizedPath = filePath.replaceAll(path.sep, '/');
  const summaryEntries = Object.entries(summary).filter(([entryPath]) => entryPath !== 'total');
  const directMatch = summary[normalizedPath];

  if (directMatch) {
    return directMatch;
  }

  const suffixMatch = summaryEntries.find(([entryPath]) => entryPath.endsWith(normalizedPath));
  return suffixMatch ? suffixMatch[1] : null;
}

function findHtmlCoverageReportPath() {
  const candidates = [
    path.resolve(coverageRoot, 'index.html'),
    path.resolve(coverageRoot, 'lcov-report', 'index.html'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function readLinePercent(summary, filePath) {
  if (!summary) {
    return null;
  }

  const coverageEntry = findCoverageEntry(summary, filePath);
  return typeof coverageEntry?.lines?.pct === 'number' ? coverageEntry.lines.pct : null;
}

const coverageSummary = readCoverageSummary();
const htmlCoverageReportPath = findHtmlCoverageReportPath();

if (!coverageSummary) {
  writeOutput('## Coverage advisory\n\nNo `coverage-summary.json` report was generated in `coverage/`.\n');
  process.exit(0);
}

const totalLines = typeof coverageSummary.total?.lines?.pct === 'number'
  ? coverageSummary.total.lines.pct
  : null;

const criticalFiles = [
  {
    label: 'Auth provider',
    path: 'src/components/AuthProvider.jsx',
    target: 95,
  },
  {
    label: 'Cost function',
    path: 'src/components/schedule/costFunction.js',
    target: 95,
  },
  {
    label: 'Staffing utilities',
    path: 'src/components/schedule/staffingUtils.jsx',
    target: 95,
  },
  {
    label: 'Doctor form',
    path: 'src/components/staff/DoctorForm.jsx',
    target: 80,
  },
];

const criticalRows = criticalFiles.map((file) => {
  const linesPct = readLinePercent(coverageSummary, file.path);
  return `| ${file.label} | \`${file.path}\` | ${formatPercent(linesPct)} | ${file.target}% | ${thresholdStatus(linesPct, file.target)} |`;
});

const htmlCoverageLocation = htmlCoverageReportPath
  ? `\`${path.relative(process.cwd(), htmlCoverageReportPath).replaceAll(path.sep, '/')}\``
  : 'the uploaded HTML coverage artifact';

writeOutput(`## Coverage advisory

This summary is **informational** and does not fail the workflow on its own.

### Snapshot

| Scope | Lines |
| --- | ---: |
| Overall observed coverage | ${formatPercent(totalLines)} |
| Policy target for new or changed code | 80.00% |

The overall number is context only. The **80% target applies to the code changed in the PR**, which this workflow cannot infer automatically.

### Selected critical paths

| Area | File | Lines | Target | Status |
| --- | --- | ---: | ---: | --- |
${criticalRows.join('\n')}

### Review guidance

- New or meaningfully changed code should target **>= 80% line coverage**
- Critical paths should target **>= 95% line coverage**
- Use ${htmlCoverageLocation} for file-level inspection when the summary shows a gap
`);
