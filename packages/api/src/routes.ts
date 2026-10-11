// Every route the app can call. cloud/src/v2.ts implements each one; the compiler rejects a
// handler whose response doesn't match. Paths use OpenAPI's {param} style.
import { createRoute, z } from '@hono/zod-openapi';
import * as S from './schemas';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const errors = { 401: json(S.ErrorBody, 'Signed out'), 404: json(S.ErrorBody, 'Not found') };
const idParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });
const stream = (description: string) => ({ content: { 'text/event-stream': { schema: z.string() } }, description });

/* you */
export const getMe = createRoute({ method: 'get', path: '/api/me', tags: ['you'],
  responses: { 200: json(S.Me, 'You, your search in one line, sidebar counts'), ...errors } });
export const patchMe = createRoute({ method: 'patch', path: '/api/me', tags: ['you'],
  request: body(S.MePatch), responses: { 200: json(S.Me, 'Your name and photo, updated'), ...errors } });
export const getAlerts = createRoute({ method: 'get', path: '/api/alerts', tags: ['you'],
  responses: { 200: json(S.Alerts, 'Alert settings'), ...errors } });
export const patchAlerts = createRoute({ method: 'patch', path: '/api/alerts', tags: ['you'],
  request: body(S.AlertsPatch),
  responses: { 200: json(S.Alerts, 'Updated. A new email address gets a verification code automatically.'), 400: json(S.ErrorBody, 'Invalid address or number'), ...errors } });
export const verifyAlerts = createRoute({ method: 'post', path: '/api/alerts/verify', tags: ['you'],
  request: body(S.AlertsVerify),
  responses: { 200: json(S.Alerts, 'Verified'), 400: json(S.ErrorBody, 'Wrong or expired code'), 429: json(S.ErrorBody, 'Too many tries'), ...errors } });
export const resendAlertCode = createRoute({ method: 'post', path: '/api/alerts/resend', tags: ['you'],
  request: body(S.AlertsChannelRequest),
  responses: { 200: json(S.CodeSent, 'Code sent'), 400: json(S.ErrorBody, 'No address yet, or already verified'), 429: json(S.ErrorBody, 'Wait before asking again'), 501: json(S.ErrorBody, 'Texts aren\'t available yet'), ...errors } });
export const testAlert = createRoute({ method: 'post', path: '/api/alerts/test', tags: ['you'],
  request: body(S.AlertsChannelRequest),
  responses: { 200: json(z.object({ sentTo: z.string() }), 'Sent an example alert'), 400: json(S.ErrorBody, 'Not verified yet'), 429: json(S.ErrorBody, 'Wait before asking again'), 501: json(S.ErrorBody, 'Texts aren\'t available yet'), ...errors } });

/* what Fred remembers (he keeps it himself; the person can correct or delete it) */
export const listMemory = createRoute({ method: 'get', path: '/api/memory', tags: ['you'],
  responses: { 200: json(S.MemoryList, 'What Fred remembers about you, newest first'), ...errors } });
export const patchMemory = createRoute({ method: 'patch', path: '/api/memory/{id}', tags: ['you'],
  request: { params: idParam, ...body(S.MemoryPatch) }, responses: { 200: json(S.Memory, 'Corrected'), ...errors } });
export const deleteMemory = createRoute({ method: 'delete', path: '/api/memory/{id}', tags: ['you'],
  request: { params: idParam }, responses: { 204: { description: 'Forgotten' }, ...errors } });

/* search */
export const getSearch = createRoute({ method: 'get', path: '/api/search', tags: ['search'],
  responses: { 200: json(S.Search, 'Your search'), ...errors } });
export const patchSearch = createRoute({ method: 'patch', path: '/api/search', tags: ['search'],
  request: body(S.SearchPatch), responses: { 200: json(S.Search, 'Updated search'), ...errors } });

/* places */
export const listOpportunities = createRoute({ method: 'get', path: '/api/opportunities', tags: ['places'],
  request: { query: z.object({
    view: z.enum(['new', 'saved', 'hidden', 'all']).default('new'),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }) },
  responses: { 200: json(S.OpportunityPage, 'Newest first. Group by foundAt in the user\'s time zone.'), ...errors } });
export const getOpportunity = createRoute({ method: 'get', path: '/api/opportunities/{id}', tags: ['places'],
  request: { params: idParam }, responses: { 200: json(S.OpportunityDetail, 'The open listing'), ...errors } });
export const patchOpportunity = createRoute({ method: 'patch', path: '/api/opportunities/{id}', tags: ['places'],
  request: { params: idParam, ...body(S.OpportunityPatch) }, responses: { 200: json(S.OpportunityCard, 'Updated card'), ...errors } });

/* saved places */
export const listSaved = createRoute({ method: 'get', path: '/api/saved', tags: ['saved'],
  responses: { 200: json(z.array(S.SavedPlace), 'Most recently saved first'), ...errors } });
export const createSaved = createRoute({ method: 'post', path: '/api/saved', tags: ['saved'],
  request: body(S.SavedPlaceCreate),
  responses: { 201: json(S.SavedPlace, 'Saved'), 200: json(S.SavedPlace, 'Already saved; the note is updated if one was sent'), ...errors } });
export const getSaved = createRoute({ method: 'get', path: '/api/saved/{id}', tags: ['saved'],
  request: { params: idParam }, responses: { 200: json(S.SavedPlace, 'The saved place'), ...errors } });
export const patchSaved = createRoute({ method: 'patch', path: '/api/saved/{id}', tags: ['saved'],
  request: { params: idParam, ...body(S.SavedPlacePatch) }, responses: { 200: json(S.SavedPlace, 'Updated'), ...errors } });
export const deleteSaved = createRoute({ method: 'delete', path: '/api/saved/{id}', tags: ['saved'],
  request: { params: idParam }, responses: { 204: { description: 'Unsaved. The place goes back to the inbox, marked seen.' }, ...errors } });

/* tours */
export const listTours = createRoute({ method: 'get', path: '/api/tours', tags: ['tours'],
  request: { query: z.object({ when: z.enum(['upcoming', 'past', 'all']).default('upcoming') }) },
  responses: { 200: json(z.array(S.Tour), 'Soonest first'), ...errors } });
export const createTour = createRoute({ method: 'post', path: '/api/tours', tags: ['tours'],
  request: body(S.TourRequest), responses: { 201: json(S.Tour, 'Draft tour. Fred drafts the message; nothing is sent until you say so.'), ...errors } });
export const patchTour = createRoute({ method: 'patch', path: '/api/tours/{id}', tags: ['tours'],
  request: { params: idParam, ...body(S.TourPatch) }, responses: { 200: json(S.Tour, 'Updated tour'), ...errors } });

/* application packet */
export const getPacket = createRoute({ method: 'get', path: '/api/packet', tags: ['packet'],
  responses: { 200: json(S.Packet, 'Checklist and what is uploaded'), ...errors } });

/* chat */
export const listThreads = createRoute({ method: 'get', path: '/api/threads', tags: ['chat'],
  responses: { 200: json(z.array(S.Thread), 'Newest first'), ...errors } });
export const getThread = createRoute({ method: 'get', path: '/api/threads/{id}', tags: ['chat'],
  request: { params: idParam },
  responses: { 200: json(z.object({ thread: S.Thread, messages: z.array(z.unknown()) }), 'Messages as AI SDK UIMessage[]'), ...errors } });
export const chat = createRoute({ method: 'post', path: '/api/chat', tags: ['chat'],
  request: body(S.ChatRequest),
  responses: { 200: stream('AI SDK UI message stream. Custom parts: data-search-updated, data-scan, data-suggestions, data-watch'), ...errors } });

/* live */
export const events = createRoute({ method: 'get', path: '/api/events', tags: ['live'],
  responses: { 200: stream('Server-sent events; each data line is one Event'), ...errors } });
