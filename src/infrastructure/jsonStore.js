const fs = require('node:fs/promises');
const path = require('node:path');

class JsonStore {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory;
    this.writeQueues = new Map();
  }

  filePath(name) { return path.join(this.rootDirectory, `${name}.json`); }

  async read(name, fallback = []) {
    try {
      return JSON.parse(await fs.readFile(this.filePath(name), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async write(name, value) {
    return this.enqueue(name, async () => { await this.writeImmediate(name, value); });
  }

  async mutate(name, fallback, transform) {
    let result;
    await this.enqueue(name, async () => {
      let current;
      try { current = JSON.parse(await fs.readFile(this.filePath(name), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; current = fallback; }
      result = await transform(current);
      await this.writeImmediate(name, result);
    });
    return result;
  }

  async enqueue(name, operation) {
    const previous = this.writeQueues.get(name) || Promise.resolve();
    const task = previous.then(operation);
    this.writeQueues.set(name, task.catch(() => {}));
    return task;
  }

  async writeImmediate(name, value) {
    await fs.mkdir(this.rootDirectory, { recursive: true });
    const tempPath = `${this.filePath(name)}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.filePath(name));
  }
}

module.exports = { JsonStore };
