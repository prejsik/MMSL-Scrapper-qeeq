const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeDiagnosticText } = require('./utils');

const MAX_EVENTS = 50;
const MAX_EVENTS_PER_KIND = 25;
const MAX_MESSAGE_LENGTH = 500;
const MAX_DOM_TEXT_LENGTH = 20000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const REDACTED_NAMES = /\b(?:id|bid|clid|_vv_|fpt|ticket|ts|qeeq_fpt|cookie|authorization)\b\s*=\s*\[redacted\]/gi;
const UNSAFE_TEXT = /(?:[?&](?:id|bid|clid|_vv_|fpt|ticket|ts|qeeq_fpt)=|\b(?:cookie|authorization)\b\s*[:=]|\bbearer\s+|[A-Za-z0-9_-]{24,})/i;

function artifactText(value) {
  return sanitizeDiagnosticText(typeof value === 'string' ? value : '')
    .replace(REDACTED_NAMES, '[redacted]')
    .replace(/\bbearer\s+\[redacted\]/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function safeCall(callback, fallback = '') {
  try {
    return callback();
  } catch {
    return fallback;
  }
}

function safeArtifactRoot(relativeDirectory) {
  if (typeof relativeDirectory !== 'string' || !relativeDirectory.trim() || path.isAbsolute(relativeDirectory)) {
    throw new Error('artifactsDir must be a safe relative path');
  }
  const workspace = fs.realpathSync.native(process.cwd());
  const target = path.resolve(workspace, relativeDirectory);
  const relative = path.relative(workspace, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {
    throw new Error('artifactsDir must be a safe relative path');
  }
  fs.mkdirSync(target, { recursive: true });
  let cursor = workspace;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('artifactsDir must not contain symbolic links or junctions');
  }
  const canonical = fs.realpathSync.native(target);
  const canonicalRelative = path.relative(workspace, canonical);
  if (path.isAbsolute(canonicalRelative) || canonicalRelative.split(path.sep)[0] === '..') {
    throw new Error('artifactsDir must remain inside the workspace');
  }
  return canonical;
}

function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function htmlEscape(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizedDomDocument(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > MAX_DOM_TEXT_LENGTH) return null;
  const clean = artifactText(rawText);
  if (!clean || UNSAFE_TEXT.test(clean)) return null;
  return `<!doctype html><meta charset="utf-8"><title>Sanitized QEEQ diagnostic</title><pre>${htmlEscape(clean)}</pre>\n`;
}

function relativeReference(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function stableHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function createFailureArtifactSession(config = {}, scenario = {}, attempt = 0, now = () => new Date()) {
  const enabled = typeof config.artifactsDir === 'string' && config.artifactsDir.trim();
  const events = [];
  const counts = new Map();
  let page = null;
  let consoleListener = null;
  let requestFailedListener = null;

  const append = (kind, entry) => {
    const count = counts.get(kind) || 0;
    if (events.length >= MAX_EVENTS || count >= MAX_EVENTS_PER_KIND) return;
    counts.set(kind, count + 1);
    events.push({ kind, ...entry });
  };

  const dispose = () => {
    if (!page) return;
    try { if (consoleListener) page.off?.('console', consoleListener); } catch {}
    try { if (requestFailedListener) page.off?.('requestfailed', requestFailedListener); } catch {}
    page = null;
  };

  return {
    attach(nextPage) {
      if (!enabled || !nextPage) return;
      page = nextPage;
      consoleListener = message => append('console', {
        level: artifactText(safeCall(() => message.type(), 'unknown')) || 'unknown',
        message: artifactText(safeCall(() => message.text(), ''))
      });
      requestFailedListener = request => append('requestfailed', {
        method: artifactText(safeCall(() => request.method(), '')),
        url: stableHttpUrl(safeCall(() => request.url(), '')),
        message: artifactText(safeCall(() => request.failure()?.errorText, ''))
      });
      page.on?.('console', consoleListener);
      page.on?.('requestfailed', requestFailedListener);
    },
    async capture(error) {
      if (!enabled) return [];
      const activePage = page;
      dispose();
      const root = safeArtifactRoot(config.artifactsDir);
      const scenarioRef = crypto.createHash('sha256').update(String(scenario?.key || 'unknown')).digest('hex').slice(0, 16);
      const capturedAt = new Date(now()).toISOString();
      const suffix = `${capturedAt.replace(/[^0-9]/g, '')}-${crypto.randomUUID()}`;
      const directory = path.join(root, `scenario-${scenarioRef}-attempt-${Number(attempt) || 0}-${suffix}`);
      fs.mkdirSync(directory, { recursive: false });
      const references = [];
      const rawErrorCode = safeCall(() => error?.code, '');
      const errorCode = typeof rawErrorCode === 'string' && /^[a-z0-9_:-]+$/i.test(rawErrorCode) && !UNSAFE_TEXT.test(rawErrorCode)
        ? rawErrorCode : 'scenario_failed';
      const currentUrl = stableHttpUrl(safeCall(() => activePage?.url?.(), ''));

      const logPath = path.join(directory, 'browser.log');
      atomicWrite(logPath, events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
      references.push(relativeReference(logPath));

      try {
        const screenshot = await activePage?.screenshot?.({ type: 'png' });
        if (Buffer.isBuffer(screenshot) && screenshot.length > 0 && screenshot.length <= MAX_SCREENSHOT_BYTES) {
          const screenshotPath = path.join(directory, 'screenshot.png');
          atomicWrite(screenshotPath, screenshot);
          references.push(relativeReference(screenshotPath));
        }
      } catch {}

      try {
        const visibleText = await activePage?.evaluate?.(() => document.body?.innerText || '');
        const sanitizedDom = sanitizedDomDocument(visibleText);
        if (sanitizedDom) {
          const domPath = path.join(directory, 'sanitized-dom.html');
          atomicWrite(domPath, sanitizedDom);
          references.push(relativeReference(domPath));
        }
      } catch {}

      const errorPath = path.join(directory, 'error.json');
      atomicWrite(errorPath, `${JSON.stringify({
        schema_version: 1,
        artifact_type: 'qeeq_failure',
        scenario_ref: scenarioRef,
        attempt: Number(attempt) || 0,
        captured_at: capturedAt,
        error_code: errorCode,
        message: artifactText(safeCall(() => error?.message, '')),
        current_url: currentUrl,
        files: references.map(reference => path.posix.basename(reference))
      }, null, 2)}\n`);
      references.push(relativeReference(errorPath));
      return references;
    },
    dispose
  };
}

module.exports = { createFailureArtifactSession };
