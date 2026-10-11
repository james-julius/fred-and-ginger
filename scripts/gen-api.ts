// Writes packages/api/openapi.json: the same spec the Worker serves at /api/openapi.json.
// `npm run gen:api` then turns it into web/lib/api/schema.gen.ts for the Next app.
import { writeFileSync } from 'node:fs';
import { v2, openapiDoc } from '../cloud/src/v2';

const doc = v2.getOpenAPI31Document(openapiDoc);
writeFileSync(new URL('../packages/api/openapi.json', import.meta.url), JSON.stringify(doc, null, 2) + '\n');
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths, ${Object.keys(doc.components?.schemas ?? {}).length} schemas`);
