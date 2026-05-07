/**
 * Certificate Analyzer – nutzt ein lokales Vision-LLM (vLLM, OpenAI-kompatible
 * API, ohne Authentifizierung) um Zertifikat-Uploads zu prüfen.
 *
 * Konfiguration über zwei ENV-Variablen:
 *   - LLM_VISION_BASE_URL  z.B. http://localhost:8000/v1
 *   - LLM_VISION_MODEL     z.B. Qwen2.5-VL-7B-Instruct
 *
 * Wenn eine der Variablen fehlt, ist die Analyse deaktiviert (Status 'skipped').
 */

import sharp from 'sharp';

const MAX_TOKENS = 32768; // Modell-Kontext-Limit (vLLM)
const REQUEST_TIMEOUT_MS = 90_000; // 90s – große Bilder + lokales LLM
const RESPONSE_MAX_TOKENS = 800;

// Bild-Downscaling: Vision-Modelle (z.B. Qwen2.5-VL) erzeugen pro 28x28-Patch
// einen Token. Ein 4000x3000-Foto produziert >15k Vision-Tokens und sprengt
// schnell das 32k-Kontext-Limit. 1600px Längskante ist ein guter Kompromiss
// zwischen Lesbarkeit kleiner Schrift und Token-Budget (~3000 Vision-Tokens).
const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 80;

export function isAnalyzerConfigured() {
  return !!(process.env.LLM_VISION_BASE_URL && process.env.LLM_VISION_MODEL);
}

function buildSystemPrompt() {
  return [
    'Du bist ein Prüfer für medizinische Fortbildungs- und Qualifikationszertifikate.',
    'Du erhältst ein Bild eines Dokuments und den Namen einer Qualifikation.',
    'Beurteile ausschließlich auf Basis des sichtbaren Dokuments.',
    'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt im definierten Schema – ohne Erklärtext, ohne Markdown-Codeblöcke.',
  ].join(' ');
}

function buildUserPrompt({ qualificationName, qualificationDescription }) {
  const descLine = qualificationDescription
    ? `Beschreibung: "${qualificationDescription}"`
    : '';
  return [
    `Geforderte Qualifikation: "${qualificationName}"`,
    descLine,
    '',
    'Prüfe folgende Punkte und antworte als JSON:',
    '{',
    '  "is_certificate": boolean,            // Ist das Dokument plausibel ein offizielles Zertifikat / eine Bescheinigung?',
    '  "scope_match": boolean,               // Bestätigt das Zertifikat genau die geforderte Qualifikation (Thema/Scope passt)?',
    '  "scope_detected": string,             // Welche Qualifikation/welches Thema bescheinigt das Dokument tatsächlich? (kurz, max 120 Zeichen)',
    '  "granted_date": "YYYY-MM-DD"|null,    // Ausstellungsdatum, wenn auf dem Dokument lesbar',
    '  "expiry_date":  "YYYY-MM-DD"|null,    // Ablauf-/Gültigkeitsdatum, wenn vorhanden – sonst null',
    '  "confidence": number,                 // 0.0 – 1.0 wie sicher die Gesamtbewertung ist',
    '  "reasoning": string                   // 1-3 Sätze auf Deutsch, was du auf dem Dokument siehst',
    '}',
    '',
    'Wenn etwas nicht eindeutig erkennbar ist, setze den entsprechenden Wert auf null bzw. false und erkläre dies kurz im Feld "reasoning".',
  ].filter(Boolean).join('\n');
}

function bufferToDataUrl(buffer, mimeType) {
  const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Skaliert große Bilder herunter, damit sie das Vision-Token-Budget nicht
 * sprengen. Bilder, deren Längskante bereits klein genug ist, werden
 * unverändert zurückgegeben (kein Re-Encoding).
 */
async function downscaleForVision(buffer, mimeType) {
  if (!mimeType?.startsWith('image/')) {
    return { buffer, mimeType };
  }
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const meta = await image.metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    if (!longEdge || longEdge <= TARGET_LONG_EDGE) {
      return { buffer, mimeType };
    }
    const resized = await image
      .rotate() // EXIF-Orientierung anwenden
      .resize({
        width: meta.width >= meta.height ? TARGET_LONG_EDGE : null,
        height: meta.height > meta.width ? TARGET_LONG_EDGE : null,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { buffer: resized, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[certificateAnalyzer] Downscale fehlgeschlagen, sende Original:', err.message);
    return { buffer, mimeType };
  }
}

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip optional ```json ... ``` fences
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  // Find first { and last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function classifyStatus(parsed) {
  if (!parsed) return 'error';
  const isCert = parsed.is_certificate === true;
  const scope = parsed.scope_match === true;
  if (!isCert) return 'failed';
  if (!scope) return 'warning';
  return 'passed';
}

/**
 * Analysiert eine Datei mit dem konfigurierten Vision-LLM.
 *
 * @param {object} args
 * @param {Buffer} args.buffer        Datei-Inhalt
 * @param {string} args.mimeType      z.B. image/jpeg, application/pdf
 * @param {string} args.qualificationName
 * @param {string} [args.qualificationDescription]
 * @returns {Promise<{
 *   status: 'passed'|'warning'|'failed'|'skipped'|'error',
 *   is_certificate: boolean|null,
 *   scope_match: boolean|null,
 *   scope_detected: string|null,
 *   granted_date: string|null,
 *   expiry_date: string|null,
 *   confidence: number|null,
 *   reasoning: string|null,
 *   raw: string|null,
 *   error: string|null,
 * }>}
 */
export async function analyzeCertificate({
  buffer,
  mimeType,
  qualificationName,
  qualificationDescription,
}) {
  if (!isAnalyzerConfigured()) {
    return {
      status: 'skipped',
      is_certificate: null,
      scope_match: null,
      scope_detected: null,
      granted_date: null,
      expiry_date: null,
      confidence: null,
      reasoning: 'Vision-LLM nicht konfiguriert (LLM_VISION_BASE_URL / LLM_VISION_MODEL).',
      raw: null,
      error: null,
    };
  }

  // PDFs werden vom Bild-Modell typischerweise nicht direkt unterstützt.
  // In diesem Fall überspringen wir mit Hinweis – eine spätere Erweiterung
  // könnte PDFs serverseitig in PNG konvertieren (z.B. via pdf-poppler).
  if (mimeType === 'application/pdf') {
    return {
      status: 'skipped',
      is_certificate: null,
      scope_match: null,
      scope_detected: null,
      granted_date: null,
      expiry_date: null,
      confidence: null,
      reasoning: 'PDF kann nicht automatisch geprüft werden – bitte Daten manuell eintragen.',
      raw: null,
      error: null,
    };
  }

  const baseUrl = process.env.LLM_VISION_BASE_URL.replace(/\/$/, '');
  const model = process.env.LLM_VISION_MODEL;
  const { buffer: visionBuffer, mimeType: visionMime } = await downscaleForVision(buffer, mimeType);
  const dataUrl = bufferToDataUrl(visionBuffer, visionMime);

  console.info('[certificateAnalyzer] LLM-Aufruf', {
    baseUrl,
    model,
    qualificationName,
    originalSize: buffer.length,
    visionSize: visionBuffer.length,
    visionMime,
  });

  const userText = buildUserPrompt({ qualificationName, qualificationDescription });

  // Manche Modelle erwarten `type: "image_url"` (Qwen2.5-VL, LLaVA), andere
  // `type: "image"` (Gemma 3). vLLM akzeptiert beide am OpenAI-Endpoint, aber
  // das gerenderte Chat-Template emitiert den Image-Platzhalter nur für den
  // vom Modell unterstützten Typ. Wir probieren primär `image_url`, fallen
  // bei "Failed to apply prompt replacement"-Fehlern auf `image` zurück.
  // WICHTIG: Bild MUSS vor dem Text stehen.
  const buildBody = (variant) => {
    const imagePart = variant === 'image'
      ? { type: 'image', image: dataUrl }
      : { type: 'image_url', image_url: { url: dataUrl } };
    return {
      model,
      max_tokens: RESPONSE_MAX_TOKENS,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: [imagePart, { type: 'text', text: userText }],
        },
      ],
    };
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  const callLlm = async (variant) => {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(variant)),
      signal: controller.signal,
    });
  };

  try {
    let variantUsed = 'image_url';
    let response = await callLlm(variantUsed);

    // Retry mit `type: "image"` falls vLLM das Image-Placeholder im
    // Chat-Template nicht ersetzen konnte (typisch für Gemma).
    if (response.status === 500) {
      const errBody = await response.text().catch(() => '');
      if (/Failed to apply prompt replacement|mm_items/i.test(errBody)) {
        console.warn('[certificateAnalyzer] image_url-Variante abgelehnt, retry mit image-Typ', { snippet: errBody.slice(0, 200) });
        variantUsed = 'image';
        response = await callLlm(variantUsed);
      } else {
        // Body wieder verfügbar machen, indem wir aus dem bereits gelesenen Text einen Pseudo-Response bauen.
        const errMsg = `LLM HTTP 500: ${errBody.slice(0, 400)}`;
        console.error('[certificateAnalyzer] HTTP 500 vom LLM', { body: errBody.slice(0, 1000) });
        return {
          status: 'error',
          is_certificate: null,
          scope_match: null,
          scope_detected: null,
          granted_date: null,
          expiry_date: null,
          confidence: null,
          reasoning: errMsg,
          raw: null,
          error: errMsg,
        };
      }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const errMsg = `LLM HTTP ${response.status} (variant=${variantUsed}): ${text.slice(0, 400)}`;
      console.error('[certificateAnalyzer] HTTP-Fehler vom LLM', { status: response.status, variant: variantUsed, body: text.slice(0, 1000) });
      return {
        status: 'error',
        is_certificate: null,
        scope_match: null,
        scope_detected: null,
        granted_date: null,
        expiry_date: null,
        confidence: null,
        reasoning: errMsg,
        raw: null,
        error: errMsg,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = tryParseJson(typeof content === 'string' ? content : '');

    console.info('[certificateAnalyzer] LLM-Antwort', {
      durationMs: Date.now() - startedAt,
      finishReason: data?.choices?.[0]?.finish_reason,
      usage: data?.usage,
      parsed: !!parsed,
    });

    if (!parsed) {
      const rawSnippet = typeof content === 'string' ? content.slice(0, 2000) : '';
      console.error('[certificateAnalyzer] JSON-Parse fehlgeschlagen', { rawSnippet });
      return {
        status: 'error',
        is_certificate: null,
        scope_match: null,
        scope_detected: null,
        granted_date: null,
        expiry_date: null,
        confidence: null,
        reasoning: `LLM-Antwort war kein gültiges JSON: ${rawSnippet.slice(0, 300)}`,
        raw: rawSnippet,
        error: 'Antwort des LLM konnte nicht als JSON geparst werden.',
      };
    }

    return {
      status: classifyStatus(parsed),
      is_certificate: typeof parsed.is_certificate === 'boolean' ? parsed.is_certificate : null,
      scope_match: typeof parsed.scope_match === 'boolean' ? parsed.scope_match : null,
      scope_detected: parsed.scope_detected ? String(parsed.scope_detected).slice(0, 250) : null,
      granted_date: normalizeDate(parsed.granted_date),
      expiry_date: normalizeDate(parsed.expiry_date),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : null,
      reasoning: parsed.reasoning ? String(parsed.reasoning).slice(0, 1500) : null,
      raw: null,
      error: null,
    };
  } catch (err) {
    const errMsg = err.name === 'AbortError'
      ? `LLM-Anfrage Timeout nach ${REQUEST_TIMEOUT_MS / 1000}s`
      : (err.message || 'Unbekannter Fehler beim LLM-Aufruf');
    console.error('[certificateAnalyzer] Aufruf fehlgeschlagen', {
      durationMs: Date.now() - startedAt,
      name: err.name,
      message: err.message,
      cause: err.cause?.message || err.cause?.code,
    });
    return {
      status: 'error',
      is_certificate: null,
      scope_match: null,
      scope_detected: null,
      granted_date: null,
      expiry_date: null,
      confidence: null,
      reasoning: errMsg,
      raw: null,
      error: errMsg,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const ANALYZER_MAX_TOKENS = MAX_TOKENS;
