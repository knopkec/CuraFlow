import fs from 'node:fs';
import path from 'node:path';

const coverageRoot = path.resolve(process.cwd(), 'coverage');
const githubStepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

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

function parseLinePercentFromHtml(html) {
  const match = html.match(/<span class="strong">([0-9.]+)%\s*<\/span>\s*<span class="quiet">Lines<\/span>/);
  return match ? Number.parseFloat(match[1]) : null;
}

function readLinePercent(relativeHtmlPath) {
  const absolutePath = path.resolve(coverageRoot, relativeHtmlPath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return parseLinePercentFromHtml(fs.readFileSync(absolutePath, 'utf8'));
}

if (!fs.existsSync(path.resolve(coverageRoot, 'index.html'))) {
  writeOutput('## Coverage advisory\n\nNo HTML coverage report was generated in `coverage/`.\n');
  process.exit(0);
}

const totalLines = readLinePercent('index.html');

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
  const linesPct = readLinePercent(`${file.path}.html`);
  return `| ${file.label} | \`${file.path}\` | ${formatPercent(linesPct)} | ${file.target}% | ${thresholdStatus(linesPct, file.target)} |`;
});

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
- Use the HTML coverage artifact for file-level inspection when the summary shows a gap
`);
