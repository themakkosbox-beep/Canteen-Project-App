#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).toString().trim();
  } catch (err) {
    return '';
  }
}

function generate() {
  const outPath = path.join(__dirname, '..', 'src', 'data', 'changelog.json');
  const tagsRaw = safeExec('git tag --sort=-creatordate');
  const tags = tagsRaw ? tagsRaw.split('\n').filter(Boolean) : [];

  const entries = [];

  // Unreleased (commits after latest tag)
  if (tags.length > 0) {
    const latest = tags[0];
    const unreleasedRaw = safeExec(`git log ${latest}..HEAD --pretty=format:%s`);
    const unreleased = unreleasedRaw ? unreleasedRaw.split('\n').slice(0, 8) : [];
    if (unreleased.length > 0) {
      entries.push({ version: 'Unreleased', date: new Date().toDateString(), highlights: unreleased });
    }
  }

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const next = tags[i + 1];
    let commitsRaw = '';
    if (next) {
      commitsRaw = safeExec(`git log ${next}..${tag} --pretty=format:%s`);
    } else {
      // Oldest tag: include its history (limit)
      commitsRaw = safeExec(`git log ${tag} --pretty=format:%s -n 50`);
    }
    const highlights = commitsRaw ? commitsRaw.split('\n').filter(Boolean).slice(0, 8) : [];
    const dateRaw = safeExec(`git show -s --format=%ai ${tag}`) || '';
    const date = dateRaw ? new Date(dateRaw).toDateString() : '';
    entries.push({ version: tag, date, highlights });
  }

  // Fallback: if nothing found, preserve a minimal history
  if (entries.length === 0) {
    entries.push({
      version: 'v1.0.0',
      date: new Date().toDateString(),
      highlights: ['Initial public release'],
    });
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf8');
    console.log('Wrote changelog to', outPath);
  } catch (err) {
    console.error('Failed to write changelog:', err);
    process.exit(2);
  }
}

generate();
