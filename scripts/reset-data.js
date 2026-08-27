const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'data', 'seed');
const target = path.join(root, 'data');

(async () => {
  await fs.mkdir(target, { recursive: true });
  const files = await fs.readdir(source);
  await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
    await fs.copyFile(path.join(source, file), path.join(target, file));
  }));
  console.log(`Reset ${files.length} JSON data files from seed data.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
