/**
 * What went wrong with narration, said in a sentence an operator can act on.
 *
 * The Worker proxies ElevenLabs and, when the provider refuses, hands the refusal back wrapped in
 * a single `error` string. Rendering that string is how the voice flow ended up putting raw
 * provider prose in a window.alert:
 *
 *   "ElevenLabs could not produce this narration: ElevenLabs returned HTTP 402: Free users cannot
 *    use library voices via the API. Please upgrade your subscription to use this voice."
 *
 * Three nested restatements of one subscription limit, and no indication of which field to change.
 * Every refusal here resolves to a status, one operator-readable sentence, and whether the fault is
 * CONFIGURATION — a wrong id in Settings, permanent until it is changed — or an outage worth
 * retrying. The distinction is what decides whether the UI offers "try again" or "go fix this".
 *
 * The upstream status is read from a structured field when the Worker sends one and recovered from
 * the Worker's own error wording when it does not, so this keeps working against the Worker as it
 * is deployed today and gets more precise as the response gains fields.
 */

export interface VoiceSynthesisFailure {
  /** Status of the Worker's own reply. */
  status: number;
  /** Status ElevenLabs itself returned, where it can be established. */
  upstreamStatus: number | null;
  /** The voice id that failed, when the provider or the Worker names it. */
  voiceId: string | null;
  /** The credential field the Worker blamed, when it blamed one. */
  field: string | null;
  /** The Worker's message, kept for logging — never for display. */
  raw: string;
}

export interface VoiceNotice {
  tone: 'error' | 'warning';
  title: string;
  message: string;
  /** True when only a Settings change can fix it: retrying will fail identically. */
  configuration: boolean;
  voiceId: string | null;
}

const SETTINGS_PATH = 'Settings → Integrations → ElevenLabs';

/**
 * The Worker rewrites each provider status into a fixed sentence before it adds the provider's own
 * detail. Those sentences are the only reliable carrier of the upstream status on the deployed
 * Worker, whose error body is `{ error, provider }` and nothing else.
 */
const WORKER_STATUS_PHRASES: ReadonlyArray<{ pattern: RegExp; status: number }> = [
  { pattern: /rejected the configured API key/i, status: 401 },
  { pattern: /voice is not available to this account/i, status: 404 },
  { pattern: /rejected this text-to-speech request/i, status: 400 },
  { pattern: /rate limiting narration requests/i, status: 429 },
];

/** Provider wording that pins a status the Worker's phrasing does not distinguish. */
const PROVIDER_STATUS_PHRASES: ReadonlyArray<{ pattern: RegExp; status: number }> = [
  { pattern: /free users cannot use library voices/i, status: 402 },
  { pattern: /upgrade your subscription/i, status: 402 },
  { pattern: /voice_not_found/i, status: 404 },
];

function upstreamStatusFrom(message: string): number | null {
  // An explicit "HTTP 402" in the Worker's passthrough is the strongest signal, so it wins.
  const explicit = /returned HTTP (\d{3})/i.exec(message);
  if (explicit) return Number(explicit[1]);
  for (const { pattern, status } of PROVIDER_STATUS_PHRASES) {
    if (pattern.test(message)) return status;
  }
  for (const { pattern, status } of WORKER_STATUS_PHRASES) {
    if (pattern.test(message)) return status;
  }
  return null;
}

/**
 * A refusal about what the plan may USE, rather than about the request.
 *
 * Status alone cannot decide this. A Voice Library voice on a free plan returns 402, but a voice
 * gated behind a paid tier returns **400** — the same status as a malformed request — with the
 * reason only in the prose: "You need to be on the creator tier or above to use this voice."
 * Reading that as a bad request sent operators to the Model ID field to fix a voice entitlement,
 * which is the same wrong-field failure that made this bug take a whole session to find.
 *
 * So: 402 always; 400 and 403 only when the message is about a VOICE *and* about entitlement.
 * Requiring both words keeps "text is too long" and "Invalid model_id" out.
 */
function isPlanRestriction(status: number | null, message: string): boolean {
  if (status === 402) return true;
  if (status !== 400 && status !== 403) return false;
  return /voice/i.test(message) && /\b(tier|subscription|upgrade|plan|permission|entitle)/i.test(message);
}

/**
 * The id that failed, recovered from wherever it is available.
 *
 * ElevenLabs names it in its own 404 — "A voice with voice_id agent_5401… was not found" — which
 * is the one case where naming it matters most, because the id is usually a Conversational AI
 * Agent ID pasted into a voice field and seeing it is what makes that obvious.
 */
function voiceIdFrom(message: string): string | null {
  const named = /voice[_\s]?id[:\s]+([A-Za-z0-9_-]{8,})/i.exec(message);
  if (named) return named[1];
  const agent = /\b((?:agent|convai)_[A-Za-z0-9_-]{6,})\b/i.exec(message);
  if (agent) return agent[1];
  return null;
}

function textOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readVoiceFailure(error: unknown): VoiceSynthesisFailure {
  const source = (error ?? {}) as Record<string, unknown>;
  const raw = textOf(error);
  return {
    status: numberOrNull(source.status) ?? 0,
    upstreamStatus: numberOrNull(source.upstreamStatus) ?? upstreamStatusFrom(raw),
    voiceId: stringOrNull(source.voiceId) ?? voiceIdFrom(raw),
    field: stringOrNull(source.field),
    raw,
  };
}

const VOICE_FIELD_LABELS: Record<string, string> = {
  voiceIdEn: 'English voice ID',
  voiceIdAr: 'Arabic voice ID',
  modelId: 'Model ID',
};

/**
 * An Agent ID in a voice field, which is a paste error rather than an outage.
 *
 * Conversational AI hands out `agent_…` and the dashboard keeps it in easy reach, so it is the id
 * an operator has to hand. Text-to-speech answers it with a missing-VOICE 404 that reads like the
 * provider is down. Say what was pasted and what belongs there instead.
 */
function agentIdNotice(voiceId: string, field: string | null, language: 'en' | 'ar'): VoiceNotice {
  const label = (field && VOICE_FIELD_LABELS[field]) || `${language === 'ar' ? 'Arabic' : 'English'} voice ID`;
  return {
    tone: 'error',
    title: 'That is an Agent ID, not a Voice ID',
    message:
      `${label} holds ${voiceId}, which is a Conversational AI Agent ID. Narration speaks through a voice, not an agent. ` +
      `In ElevenLabs open Voices, copy the Voice ID of the voice that agent speaks with, and paste it into ${SETTINGS_PATH}.`,
    configuration: true,
    voiceId,
  };
}

/**
 * Turn a narration failure into something worth showing a person.
 *
 * `language` is the narration that was asked for, so a message can name the field to correct
 * rather than making an operator work out which of the two voices refused.
 */
export function describeVoiceFailure(error: unknown, language: 'en' | 'ar' = 'en'): VoiceNotice {
  const failure = readVoiceFailure(error);
  const spoken = language === 'ar' ? 'Arabic' : 'English';
  const field = failure.field ?? (language === 'ar' ? 'voiceIdAr' : 'voiceIdEn');
  const fieldLabel = VOICE_FIELD_LABELS[field] ?? `${spoken} voice ID`;

  if (failure.voiceId && /^(agent|convai)_/i.test(failure.voiceId)) {
    return agentIdNotice(failure.voiceId, failure.field, language);
  }

  // The Worker refuses outright, before it calls the provider, when a voice field holds an agent
  // id. It names the field but has no id to quote, because it never sent one.
  if (failure.field && /agent/i.test(failure.raw)) {
    return {
      tone: 'error',
      title: 'That is an Agent ID, not a Voice ID',
      message:
        `${fieldLabel} holds a Conversational AI Agent ID. Narration speaks through a voice: in ElevenLabs open Voices, ` +
        `copy the Voice ID of the voice that agent speaks with, and paste it into ${SETTINGS_PATH}.`,
      configuration: true,
      voiceId: null,
    };
  }

  // Checked before the status switch, because a tier-gated voice arrives as a 400 and would
  // otherwise be answered as a malformed request.
  if (isPlanRestriction(failure.upstreamStatus, failure.raw)) {
    const library = /library/i.test(failure.raw);
    return {
      tone: 'error',
      title: 'This voice needs a paid ElevenLabs plan',
      message:
        `The configured ${spoken} voice is not available on this ElevenLabs plan` +
        `${library ? ' — it is a Voice Library voice, and a free plan cannot use library voices through the API' : ''}. ` +
        `Open ${SETTINGS_PATH} and put a premade voice in ${fieldLabel} — premade voices work on the free plan — ` +
        `or upgrade the ElevenLabs subscription.`,
      configuration: true,
      voiceId: failure.voiceId,
    };
  }

  switch (failure.upstreamStatus) {
    case 401:
    case 403:
      return {
        tone: 'error',
        title: 'ElevenLabs rejected the API key',
        message:
          `The stored ElevenLabs key was refused. Create or rotate a key in ElevenLabs and paste the sk_… value into ${SETTINGS_PATH}. ` +
          `The value the dashboard leaves on screen after creation is the key's ID, not the key.`,
        configuration: true,
        voiceId: failure.voiceId,
      };

    case 404:
      return {
        tone: 'error',
        title: 'That voice is not on this ElevenLabs account',
        message:
          failure.voiceId
            ? `${fieldLabel} is set to ${failure.voiceId}, and ElevenLabs has no voice with that id. Open ${SETTINGS_PATH} and replace it with a Voice ID from the account's Voices list.`
            : `${fieldLabel} names a voice ElevenLabs cannot find. Open ${SETTINGS_PATH} and replace it with a Voice ID from the account's Voices list.`,
        configuration: true,
        voiceId: failure.voiceId,
      };

    case 400:
    case 422:
      return {
        tone: 'error',
        title: 'ElevenLabs refused this narration request',
        message:
          `The model or the text was rejected. Confirm ${SETTINGS_PATH} has Model ID set to eleven_multilingual_v2 — it is the model that speaks both English and Arabic — and re-run the analysis if the brief was edited.`,
        configuration: true,
        voiceId: failure.voiceId,
      };

    case 429:
      return {
        tone: 'warning',
        title: 'ElevenLabs is rate limiting narration',
        message: 'Too many narration requests reached ElevenLabs at once. Wait a moment and press AI Voice Brief again.',
        configuration: false,
        voiceId: failure.voiceId,
      };

    default:
      break;
  }

  // Failures the Worker raises on its own behalf, before or instead of calling the provider.
  if (failure.status === 422 || /requires (?:a verified )?Arabic|requires (?:a verified )?English/i.test(failure.raw)) {
    return {
      tone: 'error',
      title: `${spoken} narration needs ${spoken} text`,
      message: `The analysis could not be prepared in ${spoken}. Run the AI analysis again, then switch to ${language.toUpperCase()} and retry.`,
      configuration: false,
      voiceId: null,
    };
  }
  if (failure.status === 429) {
    return {
      tone: 'warning',
      title: 'Too many narration requests',
      message: 'This workspace has asked for narration too quickly. Wait a moment and press AI Voice Brief again.',
      configuration: false,
      voiceId: null,
    };
  }
  if (failure.status === 400 && /8,000 characters/i.test(failure.raw)) {
    return {
      tone: 'error',
      title: 'The analysis is too long to narrate',
      message: 'Voice briefs are limited to 8,000 characters. Shorten the AI analysis and try again.',
      configuration: false,
      voiceId: null,
    };
  }
  if (failure.status === 401 || failure.status === 403) {
    return {
      tone: 'error',
      title: 'Your session has expired',
      message: 'Sign in to Iron Hub again, then retry the voice brief.',
      configuration: false,
      voiceId: null,
    };
  }

  return {
    tone: 'error',
    title: 'Voice narration is unavailable',
    message:
      'ElevenLabs could not produce this narration and the reason was not one this app recognises. ' +
      `Check ${SETTINGS_PATH} — Test connection reports which voice failed — then try again.`,
    configuration: false,
    voiceId: failure.voiceId,
  };
}

/**
 * Narration played, but not in the voice that was asked for.
 *
 * The Worker substitutes a premade voice when the configured one is refused, so the brief is still
 * spoken. Saying nothing would leave an operator believing their configured voice works.
 */
export function describeVoiceDegradation(
  detail: { requestedVoiceId?: string | null; voiceId?: string | null; warning?: string | null },
  language: 'en' | 'ar' = 'en',
): VoiceNotice {
  const spoken = language === 'ar' ? 'Arabic' : 'English';
  const requested = stringOrNull(detail.requestedVoiceId);
  const used = stringOrNull(detail.voiceId);
  return {
    tone: 'warning',
    title: `Played in a substitute ${spoken} voice`,
    message:
      stringOrNull(detail.warning) ??
      `${requested ? `The configured voice ${requested}` : 'The configured voice'} was refused by ElevenLabs, so this brief was spoken by ` +
        `${used ? `the premade voice ${used}` : 'a premade voice'} instead. Fix the voice in ${SETTINGS_PATH} to hear the intended one.`,
    configuration: true,
    voiceId: used ?? requested,
  };
}
