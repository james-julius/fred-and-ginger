// Writes packages/api/openapi.json from the routes cloud/src/v2.ts implements.
// `npm run gen:api` then turns it into web/lib/api/schema.gen.ts for the Next app.
import { writeFileSync } from 'node:fs';
import * as S from '../packages/api/src/schemas';
import { v2, openapiDoc } from '../cloud/src/v2';

// Chat parts and live events aren't request or response bodies, so list them explicitly
// to get them into the generated types.
for (const [name, schema] of Object.entries({
  DataSearchUpdated: S.DataSearchUpdated, DataScan: S.DataScan, DataSuggestions: S.DataSuggestions,
  DataWatch: S.DataWatch, Event: S.Event,
})) v2.openAPIRegistry.register(name, schema);

const doc = v2.getOpenAPI31Document(openapiDoc);
writeFileSync(new URL('../packages/api/openapi.json', import.meta.url), JSON.stringify(doc, null, 2) + '\n');
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths, ${Object.keys(doc.components?.schemas ?? {}).length} schemas`);
