import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const suiteWorker = () => hub('../Iron-Hub-Suite2/workers/suite-api/src/index.js');

test('the standalone Hub Pages origin has no direct provider or data functions', () => {
  assert.equal(existsSync(path.join(root, 'functions/api/send-email.js')), false);
  assert.equal(existsSync(path.join(root, 'functions/api/sync-debug.js')), false);
  assert.match(hub('functions/_middleware.js'), /Direct Iron Hub API access is disabled/);
  assert.doesNotMatch(hub('README.md'), /GEMINI_API_KEY|AI Studio|Google Cloud|Cloud Run/i);
  assert.doesNotMatch(hub('vite.config.js'), /target:\s*['"]http:\/\/localhost:3000/);
});

test('Hub workspace modules share the root React instance instead of crossing a lazy bundle boundary', () => {
  const app = hub('App.tsx');

  assert.match(app, /import \{ InvoiceSystem \} from '\.\/components\/InvoiceSystem\.tsx';/);
  assert.match(app, /import \{ AccountsSystem \} from '\.\/components\/AccountsSystem\.tsx';/);
  assert.match(app, /import \{ InventorySystem \} from '\.\/components\/InventorySystem\.tsx';/);
  assert.match(app, /import \{ Dashboard \} from '\.\/components\/Dashboard\.tsx';/);
  assert.doesNotMatch(app, /React\.lazy\(/);
  assert.doesNotMatch(app, /<Suspense\b/);
});

test('email dispatch has an enforceable deadline, idempotent retries, and only reports confirmed delivery', () => {
  const email = hub('components/EmailModule.tsx');
  const worker = suiteWorker();

  assert.match(email, /const requestWithDeadline = async/);
  assert.match(email, /return await Promise\.race\(\[fetch\(input, \{ \.\.\.init, signal: controller\.signal \}\), deadline\]\)/);
  assert.match(email, /idempotencyKey: deliveryAttemptId/);
  assert.match(email, /45_000/);
  assert.match(email, /response\.ok && result\.success === true/);
  assert.match(worker, /function hubAttachmentPayload/);
  // PDF and MP3 attachments must stay supported whether the Worker validates via
  // the legacy (application\/pdf|audio\/mpeg) regex or the newer extension map.
  assert.match(worker, /application\\?\/pdf/);
  assert.match(worker, /audio\\?\/mpeg/);
  assert.match(worker, /filename=\[A-Za-z0-9\._ -\]\{1,240\}/);
  assert.match(worker, /async function routeHubEmailDispatch/);
  assert.match(worker, /Idempotency-Key/);
  assert.match(worker, /Promise\.race\(\[/);
});

test('Hub invoice delivery prepares a canonical one-time payment link before it opens email dispatch', () => {
  const invoiceSystem = hub('components/InvoiceSystem.tsx');
  const app = hub('App.tsx');
  const email = hub('components/EmailModule.tsx');

  assert.match(invoiceSystem, /fetch\('\/api\/invoice-payment-link'/);
  assert.match(invoiceSystem, /allInvoices\.some\(\(invoice\) => invoice\.id === currentInvoice\.id\)/);
  assert.match(invoiceSystem, /if \(!url\) return;/);
  assert.match(invoiceSystem, /paymentLinkInvoiceId === currentInvoice\.id/);
  assert.match(invoiceSystem, /Stripe Checkout offers the payment methods configured for this invoice/);
  assert.match(app, /const \[invoicePaymentLink, setInvoicePaymentLink\]/);
  assert.match(app, /paymentUrl=\{invoiceToSend \? invoicePaymentLink : null\}/);
  assert.match(email, /invoice && paymentUrl && !draft\.body\.includes\(paymentUrl\)/);
  assert.match(email, /Secure payment: \$\{paymentUrl\}/);
});

test('Hub PDF generation uses its dedicated render mode so print-only content is not omitted', () => {
  const app = hub('App.tsx');
  const invoiceSystem = hub('components/InvoiceSystem.tsx');
  const quotePreview = hub('components/QuotePreview.tsx');
  const html = hub('index.html');

  assert.match(app, /element\.classList\.add\('pdf-generation-mode'\)/);
  assert.match(app, /avoid: \['tr', 'thead', '\.address-block', '\.summary-table', '\.receipt-header'\]/);
  assert.match(invoiceSystem, /\.pdf-generation-mode \.invoice-print-footer/);
  assert.match(invoiceSystem, /\.pdf-generation-mode \.terms-box/);
  assert.match(invoiceSystem, /\.totals-container-print \{[\s\S]*?break-inside: auto !important/);
  assert.match(invoiceSystem, /\.pdf-generation-mode \.invoice-notes-print/);
  assert.match(invoiceSystem, /font-size: 6px !important/);
  assert.match(quotePreview, /\.terms-box p \{ font-size: 7\.25pt !important; line-height: 1\.28 !important; \}/);
  assert.match(quotePreview, /print:p-3/);
  assert.match(html, /\.pdf-generation-mode \.terms-box,[\s\S]*?break-inside: auto !important/);
  assert.doesNotMatch(html, /\.pdf-generation-mode \.terms-box,[\s\S]*?\.pdf-generation-mode \.summary-table/);
});

test('Hub AI uses Claude first, then a scoped Cloudflare GPT fallback, and passes Whisper Turbo its documented payload', () => {
  const worker = suiteWorker();
  const claudeService = hub('services/claudeService.ts');
  const configPanel = hub('components/ConfigPanel.tsx');

  assert.match(worker, /async function callAnthropicHubGeneration/);
  assert.match(worker, /function isClaudeFallbackEligible/);
  assert.match(worker, /function hubThinkingRequested/);
  assert.match(worker, /function hubAnthropicThinking/);
  assert.match(worker, /return budgetTokens >= 1024 \? \{ type: "enabled", budget_tokens: budgetTokens, display: "omitted" \} : null/);
  assert.match(worker, /if \(thinking\) payload\.thinking = thinking/);
  assert.match(worker, /if \(!thinking && !anthropicUsesDefaultSampling\(model\)\) payload\.temperature = temperature/);
  assert.match(worker, /Math\.min\(maxTokens, HUB_MAX_GENERATION_OUTPUT_TOKENS\)/);
  assert.doesNotMatch(claudeService, /CLAUDE_TEXT_MODEL/);
  assert.match(configPanel, /Extended reasoning enabled/);
  assert.match(worker, /@cf\/openai\/gpt-oss-20b/);
  assert.match(worker, /@cf\/openai\/whisper-large-v3-turbo/);
  assert.match(worker, /audio: encoded/);
  assert.match(worker, /task: "transcribe"/);
  assert.match(worker, /\.\.\.\(language \? \{ language \} : \{\}\)/);
  assert.match(worker, /@cf\/openai\/whisper/);
  assert.match(claudeService, /signal: AbortSignal\.timeout\(90_000\)/);
  assert.match(claudeService, /signal: AbortSignal\.timeout\(60_000\)/);
  assert.match(claudeService, /Claude and the Cloudflare Workers AI fallback could not complete this request/);
});

test('canonical Hub writes resolve Suite identities securely and do not silently claim local persistence is synchronized', () => {
  const worker = suiteWorker();
  const data = hub('services/dbService.ts');
  const app = hub('App.tsx');

  assert.match(worker, /async function resolveHubIdentity/);
  assert.match(worker, /account_number/);
  assert.match(worker, /invoice_number/);
  assert.match(worker, /payment_number/);
  assert.match(data, /sync_outbox/);
  assert.match(data, /export type DataImportResult/);
  assert.match(data, /Import store-by-store so every canonical write retains its retry outbox/);
  assert.match(app, /Import is visible in this Hub session, but it is not fully synchronized/);
});

test('the embedded Hub reconciles canonical data after a missed realtime event without treating its cached connection state as authoritative', () => {
  const data = hub('services/dbService.ts');
  const app = hub('App.tsx');

  assert.match(data, /async refreshConnection\(username: string\)/);
  assert.match(data, /checkServerAvailability\(true\)/);
  assert.match(data, /flushPendingCanonicalWrites\(username\)/);
  assert.match(app, /dbService\.refreshConnection\(user\.username\)/);
  assert.match(app, /reconciliationTimer = setInterval/);
  assert.match(app, /30_000/);
  assert.match(app, /queueAllCanonicalStores\(\)/);
});

test('the embedded Hub inherits the scoped IronSuite session and has no independent credentials', () => {
  const app = hub('App.tsx');
  const worker = suiteWorker();

  assert.match(app, /fetch\('\/api\/hub-session'/);
  assert.match(app, /No separate Hub password is accepted/);
  assert.doesNotMatch(app, /localStorage\.getItem\('iron_hub_user'\)|localStorage\.setItem\('iron_hub_user'/);
  assert.doesNotMatch(app, /ironman1111|YaKareem1121@|batbout|batto123/);
  assert.equal(existsSync(path.join(root, 'components/Login.tsx')), false);
  assert.match(worker, /async function routeHubSessionProfile/);
  assert.match(worker, /"hub-session"/);
});

test('the production Hub avoids the oversized city bundle and serves local country options', () => {
  const configPanel = hub('components/ConfigPanel.tsx');
  const quotePreview = hub('components/QuotePreview.tsx');
  const countries = hub('services/countryOptions.ts');

  assert.doesNotMatch(configPanel, /country-state-city/);
  assert.doesNotMatch(quotePreview, /country-state-city/);
  assert.match(countries, /ISO_COUNTRY_CODES/);
  assert.match(countries, /new Intl\.DisplayNames/);
});

test('Hub actions expose failures and do not retain inert controls or browser-console debugging', () => {
  const app = hub('App.tsx');
  const configPanel = hub('components/ConfigPanel.tsx');
  const email = hub('components/EmailModule.tsx');
  const accounts = hub('components/AccountsSystem.tsx');

  assert.doesNotMatch(app, /onSaveDraft=\{\(\) => \{\}\}|onResumeDraft=\{\(\) => \{\}\}|onDeleteFromArchive=\{\(\) => \{\}\}/);
  assert.doesNotMatch(configPanel, /onSaveDraft|onResumeDraft|onDeleteFromArchive|console\.(log|warn|error)/);
  assert.match(configPanel, /const handleIntelligentTask = async/);
  assert.match(configPanel, /onClick=\{\(\) => \{ void handleIntelligentTask\(\); \}\}/);
  assert.match(configPanel, /role="alert"/);
  assert.match(email, /const autoAttachedDocumentRef/);
  assert.doesNotMatch(email, /eslint-disable/);
  assert.doesNotMatch(email, /console\.(log|warn|error)/);
  assert.match(accounts, /signal: AbortSignal\.timeout\(90_000\)/);
  assert.match(accounts, /!res\.ok \|\| result\.success !== true/);
});
