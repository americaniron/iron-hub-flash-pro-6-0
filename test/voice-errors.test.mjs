/**
 * What an operator is told when narration is refused.
 *
 * The rest of the suite asserts on source text. This one runs the mapping, because the thing that
 * broke was never the presence of a branch — it was which branch a real ElevenLabs refusal landed
 * in. Every payload below is one the deployed Worker actually produces: the wrapped provider
 * sentences from elevenLabsProviderError, the up-front agent-id refusal from
 * routeHubVoiceSynthesis, and the exact 402 recorded against the live credential row.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'services/voiceErrors.ts');

// Node strips TypeScript types natively from 22.18 on. Older runtimes cannot import the module at
// all, and a suite that dies on the import would hide every other test in the file.
const canImportTypeScript = process.features?.typescript !== undefined && process.features.typescript !== false;

const load = () => import(modulePath);

/** The Worker's own wrapper around a provider refusal. */
const wrap = (message) => `ElevenLabs could not produce this narration: ${message}`;

const workerError = (message, extra = {}) => Object.assign(new Error(message), { status: 502, ...extra });

test('every ElevenLabs refusal maps to a message that names the field to change', { skip: !canImportTypeScript && 'requires Node with TypeScript type stripping' }, async () => {
  const { describeVoiceFailure, readVoiceFailure } = await load();

  // The 402 stored against the live credential row. No structured fields: this is the shape the
  // Worker returned before it learned to send `status`, and the client must still explain it.
  const libraryVoice = workerError(wrap('ElevenLabs returned HTTP 402: Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.'));
  assert.equal(readVoiceFailure(libraryVoice).upstreamStatus, 402);
  const plan = describeVoiceFailure(libraryVoice, 'en');
  assert.equal(plan.configuration, true);
  assert.match(plan.message, /premade voice in English voice ID/);

  // A Conversational AI Agent ID pasted into a voice field. ElevenLabs names the id in its 404 and
  // showing it is what makes the mistake obvious, so it has to survive into the message.
  const agentId = workerError(wrap('The configured ElevenLabs voice is not available to this account: A voice with voice_id agent_5401kq1w1ecxed28a144qm9btd40 was not found.'));
  const agent = describeVoiceFailure(agentId, 'en');
  assert.match(agent.title, /Agent ID/);
  assert.match(agent.message, /agent_5401kq1w1ecxed28a144qm9btd40/);
  assert.equal(agent.configuration, true);

  // A 404 for an id that is merely unknown reads differently from one that is an agent id.
  const unknownVoice = workerError(wrap('The configured ElevenLabs voice is not available to this account: A voice with voice_id XbQ7z9kL2mNpR4tV6wYa was not found.'));
  const unknown = describeVoiceFailure(unknownVoice, 'ar');
  assert.match(unknown.message, /Arabic voice ID is set to XbQ7z9kL2mNpR4tV6wYa/);
  assert.doesNotMatch(unknown.title, /Agent ID/);

  // The Worker refuses before it calls the provider when a voice field holds an agent id. It names
  // the field and has no id to quote, because it never sent one.
  const refusedUpFront = Object.assign(
    new Error('ElevenLabs is configured with a Conversational AI Agent ID where a voice belongs.'),
    { status: 503, field: 'voiceIdAr' },
  );
  assert.match(describeVoiceFailure(refusedUpFront, 'ar').message, /Arabic voice ID/);

  // A rejected key and a rate limit are different kinds of problem: one is permanent until a
  // setting changes, the other resolves on its own. The UI decides what to offer from that flag.
  const badKey = workerError('ElevenLabs rejected the configured API key: Invalid API key', { upstreamStatus: 401 });
  assert.equal(describeVoiceFailure(badKey, 'en').configuration, true);
  const rateLimited = workerError(wrap('ElevenLabs is rate limiting narration requests: Too many requests'));
  const limited = describeVoiceFailure(rateLimited, 'en');
  assert.equal(limited.configuration, false);
  assert.equal(limited.tone, 'warning');

  // A bad model is the one failure whose fix is a specific value, so the message states it.
  const badModel = workerError(wrap('ElevenLabs returned HTTP 422: model_id does not exist'), { upstreamStatus: 422 });
  assert.match(describeVoiceFailure(badModel, 'ar').message, /eleven_multilingual_v2/);
});

test('the structured fields the Worker now sends win over parsing its prose', { skip: !canImportTypeScript && 'requires Node with TypeScript type stripping' }, async () => {
  const { readVoiceFailure } = await load();

  // Prose says 404, the field says 402. The field is authoritative — parsing exists only for
  // Worker versions that send no fields at all.
  const conflicting = Object.assign(
    new Error('The configured ElevenLabs voice is not available to this account'),
    { status: 502, upstreamStatus: 402, voiceId: 'kjBRlibrary000000000' },
  );
  const parsed = readVoiceFailure(conflicting);
  assert.equal(parsed.upstreamStatus, 402);
  assert.equal(parsed.voiceId, 'kjBRlibrary000000000');
});

test('nothing a person reads carries provider JSON or a bare HTTP status', { skip: !canImportTypeScript && 'requires Node with TypeScript type stripping' }, async () => {
  const { describeVoiceFailure } = await load();

  // The original defect was a window.alert printing the provider's own sentence. Whatever the
  // Worker hands over, what reaches the screen has to be this app's words.
  const rawProviderBody = workerError(wrap('ElevenLabs returned HTTP 402: {"detail":{"status":"voice_limit_reached","message":"Free users cannot use library voices via the API."}}'));
  for (const language of ['en', 'ar']) {
    const notice = describeVoiceFailure(rawProviderBody, language);
    assert.doesNotMatch(notice.message, /[{}]|"detail"|HTTP \d{3}/);
    assert.doesNotMatch(notice.title, /[{}]|HTTP \d{3}/);
  }

  // An unrecognised failure still has to say something an operator can act on.
  const unrecognised = workerError(wrap('ElevenLabs returned HTTP 418: teapot'));
  const fallback = describeVoiceFailure(unrecognised, 'en');
  assert.match(fallback.message, /Settings → Integrations → ElevenLabs/);
  assert.doesNotMatch(fallback.message, /418/);
});

test('a substituted voice is reported rather than passed off as the configured one', { skip: !canImportTypeScript && 'requires Node with TypeScript type stripping' }, async () => {
  const { describeVoiceDegradation } = await load();

  const notice = describeVoiceDegradation(
    { requestedVoiceId: 'GnoVlibraryvoice0000', voiceId: '21m00Tcm4TlvDq8ikWAM', warning: null },
    'ar',
  );
  assert.equal(notice.tone, 'warning');
  // Both ids: the one that was asked for and the one that actually spoke. Naming only the
  // substitute would leave an operator unable to tell which setting is wrong.
  assert.match(notice.message, /GnoVlibraryvoice0000/);
  assert.match(notice.message, /21m00Tcm4TlvDq8ikWAM/);
  assert.equal(notice.configuration, true);

  // The Worker's own sentence is preferred when it sends one, so the two surfaces cannot drift.
  const withWarning = describeVoiceDegradation(
    { requestedVoiceId: 'a', voiceId: 'b', warning: 'The configured voice could not be used on this ElevenLabs plan.' },
    'en',
  );
  assert.equal(withWarning.message, 'The configured voice could not be used on this ElevenLabs plan.');
});

test('a voice gated behind a paid tier is a plan limit, not a bad request', { skip: !canImportTypeScript && 'requires Node with TypeScript type stripping' }, async () => {
  const { describeVoiceFailure } = await load();
  const PLAN = 'This voice needs a paid ElevenLabs plan';

  // ElevenLabs answers a Voice Library voice with 402 but a tier-gated voice with 400 — the same
  // status as a malformed request, with the reason only in the prose. Reading 400 as "bad model or
  // text" told operators to check the Model ID in order to fix a voice entitlement. This is the
  // exact string that was live against the Arabic voice on this account.
  const creatorTier = workerError(wrap('ElevenLabs rejected this text-to-speech request: You need to be on the creator tier or above to use this voice.'));
  const tiered = describeVoiceFailure(creatorTier, 'ar');
  assert.equal(tiered.title, PLAN);
  assert.match(tiered.message, /Arabic voice ID/);
  assert.doesNotMatch(tiered.message, /Model ID/, 'a voice entitlement must not send an operator to the model field');

  // 403 phrased as a permission problem about a voice is the same class.
  const forbidden = workerError(wrap('ElevenLabs returned HTTP 403: This voice requires a higher plan permission.'), { upstreamStatus: 403 });
  assert.equal(describeVoiceFailure(forbidden, 'en').title, PLAN);

  // The reclassification must stay narrow. A 400 that is genuinely about the request keeps its own
  // answer — requiring BOTH a voice word and an entitlement word is what holds this line.
  for (const detail of ['The text is too long.', 'Invalid model_id.']) {
    const badRequest = workerError(wrap(`ElevenLabs rejected this text-to-speech request: ${detail}`));
    assert.notEqual(describeVoiceFailure(badRequest, 'en').title, PLAN, `"${detail}" is not a plan limit`);
  }
  // And a rejected key or a rate limit must never be reported as a subscription problem.
  assert.notEqual(describeVoiceFailure(workerError(wrap('ElevenLabs rejected the configured API key: Invalid API key')), 'en').title, PLAN);
  assert.notEqual(describeVoiceFailure(workerError(wrap('ElevenLabs is rate limiting narration requests: Too many requests')), 'en').title, PLAN);

  // The library-voice case keeps its extra explanation; the generic tier case must not claim to
  // know the voice came from the library.
  const library = describeVoiceFailure(workerError(wrap('ElevenLabs returned HTTP 402: Free users cannot use library voices via the API.')), 'en');
  assert.match(library.message, /Voice Library voice/);
  assert.doesNotMatch(tiered.message, /Voice Library/);
});
