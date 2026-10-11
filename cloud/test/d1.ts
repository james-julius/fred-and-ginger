// The slice of D1 the Worker uses, over a real SQLite built from the migrations.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);

export function d1() {
  const sql = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', here);
  for (const f of readdirSync(dir).sort()) sql.exec(readFileSync(new URL(f, dir), 'utf8'));
  const prepare = (q: string) => {
    let args: any[] = [];
    const st = {
      bind: (...a: any[]) => ((args = a), st),
      first: async () => sql.prepare(q).get(...args) ?? null,
      all: async () => ({ results: sql.prepare(q).all(...args) }),
      run: async () => {
        const r = sql.prepare(q).run(...args);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return st;
  };
  // like D1, a batch runs in order and returns each statement's results
  const db = { prepare, batch: async (sts: any[]) => { const out = []; for (const s of sts) out.push(await s.all()); return out; } };
  return { env: { DB: db } as any, sql };
}
