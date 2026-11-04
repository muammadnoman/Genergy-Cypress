const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local'), quiet: true });
const { Database, assertRunId } = require('../cypress/tasks/database.cjs');
const config = require('../cypress/config/dbConfig.cjs');

(async () => {
  const all = process.argv.includes('--all');
  const id = process.argv[process.argv.indexOf('--run') + 1];
  if (!all && !process.argv.includes('--run')) throw new Error('Usage: npm run cleanup -- --run <run ID> or --all');
  if (!all) assertRunId(id);
  const db = new Database(config(), path.join(__dirname, '..'));
  try {
    await db.health();
    const fs = require('node:fs/promises');
    const files = all ? await fs.readdir(path.join(__dirname, '../.qa-runs')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }) : [`${id}.json`];
    let failed = 0;
    let deleted = 0;
    const ledgers = files.filter(x => /^[a-f0-9]{12}\.json$/.test(x));
    for (const file of ledgers) {
      const runId = file.slice(0, -5);
      try {
        await db.resume(runId);
        const result = await db.cleanup();
        deleted += result.deleted;
        let remaining = 0;
        for (const fixture of db.run.fixtures) {
          remaining += (await db.lookup(fixture.kind, fixture.number)).length;
          for (const meter of fixture.meters || []) remaining += (await db.read({ sql: 'SELECT meter_id FROM core.meter WHERE meter_number=?', params: [meter.number] })).length;
        }
        if (remaining) throw new Error('Registered test records remain after cleanup.');
        console.log(JSON.stringify({ ...result, remaining }));
      } catch (error) {
        failed++;
        console.error(JSON.stringify({ runId, cleanupFailed: true, reason: error.code || error.message }));
      }
    }
    console.log(JSON.stringify({ summary: true, runs: ledgers.length, deleted, remaining: failed ? null : 0, failed }));
    if (failed) throw new Error(`${failed} run(s) require cleanup investigation; their ledgers were preserved.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
