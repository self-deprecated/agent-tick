import fs from 'node:fs';
import path from 'node:path';

const entry = path.resolve('dist/index.js');
if (fs.existsSync(entry)) {
  const source = fs.readFileSync(entry, 'utf8');
  if (!source.startsWith('#!/usr/bin/env node')) {
    fs.writeFileSync(entry, `#!/usr/bin/env node\n${source}`);
  }
  fs.chmodSync(entry, 0o755);
}
