const fs = require('fs');
const path = require('path');

const changelogPath = path.join(__dirname, '..', 'src', 'data', 'changelog.json');
const outPath = path.join(__dirname, '..', 'release-notes.md');

try {
  const data = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
  let md = '# Changelog\n\n';
  for (const entry of data) {
    md += `## ${entry.version} - ${entry.date}\n\n`;
    if (Array.isArray(entry.highlights)) {
      for (const h of entry.highlights) md += `- ${h}\n`;
    }
    md += '\n';
  }
  fs.writeFileSync(outPath, md, 'utf8');
  console.log('Wrote', outPath);
} catch (err) {
  console.error('Failed to generate release notes:', err.message);
  process.exit(2);
}
