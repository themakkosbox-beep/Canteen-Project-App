const fs = require('fs');
const path = require('path');

const OWNER = 'themakkosbox-beep';
const REPO = 'Canteen-Project-App';
const { version } = require(path.join(__dirname, '..', 'package.json'));
const TAG = process.env.RELEASE_TAG ?? `v${version}`;

async function run() {
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN environment variable is required');
    process.exit(2);
  }

  const notesPath = path.join(__dirname, '..', 'release-notes.md');
  if (!fs.existsSync(notesPath)) {
    console.error('release-notes.md not found - run generate-release-notes.js first');
    process.exit(2);
  }
  const body = fs.readFileSync(notesPath, 'utf8');

  const headers = {
    'Authorization': `token ${token}`,
    'User-Agent': `${OWNER}/${REPO}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  };

  // Fetch release by tag
  const tagUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`;
  const releaseResp = await fetch(tagUrl, { headers });
  if (!releaseResp.ok) {
    console.error('Failed to fetch release by tag', releaseResp.status, await releaseResp.text());
    process.exit(2);
  }
  const release = await releaseResp.json();

  const patchUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`;
  const patchResp = await fetch(patchUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body }),
  });
  if (!patchResp.ok) {
    console.error('Failed to patch release', patchResp.status, await patchResp.text());
    process.exit(2);
  }
  const patched = await patchResp.json();
  console.log('Patched release:', patched.html_url);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
