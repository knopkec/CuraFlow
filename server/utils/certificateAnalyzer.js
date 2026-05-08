/**
 * Certificate Analyzer – nutzt OCR (Tesseract) + ein lokales Text-LLM
 * (vLLM, OpenAI-kompatible API, ohne Authentifizierung) um Zertifikat-
 * Uploads zu prüfen.
 *
 * Ablauf:
 *   1. Bild wird mit `sharp` für OCR aufbereitet (Rotation, Grayscale, Normalize)
 *   2. Tesseract extrahiert Text (deutsch + englisch)
 *   3. Reiner Text + Qualifikationsname gehen ans LLM (kein Bild!)
 *
 * Vorteile:
 *   - Funktioniert mit jedem reinen Text-LLM (z.B. gemma-4 ohne Vision-Encoder)
 *   - Deutlich weniger Tokens und GPU-Last als ein Vision-Modell
 *   - OCR liefert oft sauberere Strukturhinweise als ein heruntergerechnetes JPEG
 *
 * Konfiguration über zwei ENV-Variablen:
 *   - LLM_VISION_BASE_URL  z.B. http://10.10.199.29:9000/v1
 *   - LLM_VISION_MODEL     z.B. gemma-4
 *   (Variablennamen aus historischen Gründen mit "VISION" – Inhalt ist nun Text.)
 *
 * Wenn eine der Variablen fehlt, ist die Analyse deaktiviert (Status 'skipped').
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const execFileAsync = promisify(execFile);

const REQUEST_TIMEOUT_MS = 60_000;
const RESPONSE_MAX_TOKENS = 800;

// OCR-Vorverarbeitung: hohe Auflösung hilft Tesseract bei kleiner Schrift,
// aber > 2000px bringt kaum Mehrwert und kostet Zeit. Grayscale + Normalize
// verbessert die Erkennung bei flauen Scans / Foto-Beleuchtung deutlich.
const OCR_TARGET_LONG_EDGE = 2000;
const OCR_LANGUAGES = ['deu', 'eng'];
const PDF_RENDER_DPI = 200;
const OCR_ROTATION_FALLBACK_ANGLES = [0, 90, 270, 180];
const OCR_DESKEW_FALLBACK_OFFSETS = [-12, -8, -4, 4, 8, 12];
const OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS = 45;
const OCR_MIN_TEXT_LENGTH_FOR_SINGLE_PASS = 80;
const PDF_TEXT_MIN_LENGTH = 80;

// Auf wie viele Zeichen wir den OCR-Text vor dem LLM-Call trimmen.
// Zertifikate haben selten mehr als 2-3 KB Text; das hält die Prompt-Größe
// klein und schützt vor riesigen OCR-Outputs (Logos, Wasserzeichen, Fehler).
const MAX_OCR_CHARS = 6000;

let _ocrWorkerPromise = null;

/**
 * Lazy-initialisierter Singleton-Worker. Tesseract lädt die Sprachmodelle
 * beim ersten Aufruf herunter (~10 MB pro Sprache), danach wird gecached.
 */
async function getOcrWorker() {
  if (!_ocrWorkerPromise) {
    _ocrWorkerPromise = createWorker(OCR_LANGUAGES, undefined, {
      logger: () => {},
      errorHandler: (err) => console.error('[certificateAnalyzer] Tesseract-Fehler:', err),
    }).catch((err) => {
      _ocrWorkerPromise = null;
      throw err;
    });
  }
  return _ocrWorkerPromise;
}

export function isAnalyzerConfigured() {
  return !!(process.env.LLM_VISION_BASE_URL && process.env.LLM_VISION_MODEL);
}

function buildSystemPrompt() {
  return [
    'Du bist ein Prüfer für medizinische Fortbildungs- und Qualifikationszertifikate.',
    'Du erhältst den per OCR aus einem hochgeladenen Zertifikat extrahierten Text und den Namen einer geforderten Qualifikation.',
    'Beurteile ausschließlich auf Basis des OCR-Texts. OCR-Text kann Tipp- und Erkennungsfehler enthalten – sei tolerant bei kleinen Abweichungen.',
    'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt im definierten Schema – ohne Erklärtext, ohne Markdown-Codeblöcke.',
  ].join(' ');
}

function buildUserPrompt({ qualificationName, qualificationDescription, ocrText }) {
  const descLine = qualificationDescription
    ? `Beschreibung: "${qualificationDescription}"`
    : '';
  return [
    `Geforderte Qualifikation: "${qualificationName}"`,
    descLine,
    '',
    'OCR-Text des hochgeladenen Dokuments (zwischen den Markern):',
    '<<<OCR',
    ocrText || '(kein Text erkannt)',
    'OCR>>>',
    '',
    'Prüfe folgende Punkte und antworte als JSON:',
    '{',
    '  "is_certificate": boolean,            // Wirkt der Text plausibel wie ein offizielles Zertifikat / eine Bescheinigung (Aussteller, Empfänger, Thema, Datum)?',
    '  "scope_match": boolean,               // Bestätigt das Zertifikat die geforderte Qualifikation (Thema/Scope passt – Synonyme und Fachbegriffe akzeptieren)?',
    '  "scope_detected": string,             // Welche Qualifikation/welches Thema bescheinigt das Dokument tatsächlich? (kurz, max 120 Zeichen)',
    '  "granted_date": "YYYY-MM-DD"|null,    // Ausstellungsdatum, wenn aus dem Text ableitbar (deutsche Datumsformate wie "12.03.2024" konvertieren)',
    '  "expiry_date":  "YYYY-MM-DD"|null,    // Ablauf-/Gültigkeitsdatum, wenn vorhanden – sonst null',
    '  "confidence": number,                 // 0.0 – 1.0 wie sicher die Gesamtbewertung ist (niedrig wenn OCR-Text wirr/unvollständig)',
    '  "reasoning": string                   // 1-3 Sätze auf Deutsch, was du im Text erkannt hast und warum du so entschieden hast',
    '}',
    '',
    'Wenn etwas nicht eindeutig erkennbar ist, setze den entsprechenden Wert auf null bzw. false und erkläre dies kurz im Feld "reasoning".',
  ].filter(Boolean).join('\n');
}

async function renderPdfFirstPageToPng(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curaflow-pdf-'));
  const inputPath = path.join(tempDir, 'document.pdf');
  const outputBase = path.join(tempDir, 'page');
  const outputPath = `${outputBase}.png`;

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync('pdftoppm', [
      '-png',
      '-singlefile',
      '-f', '1',
      '-l', '1',
      '-r', String(PDF_RENDER_DPI),
      inputPath,
      outputBase,
    ]);
    return await fs.readFile(outputPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('PDF-Prüfung nicht verfügbar: pdftoppm fehlt im Server-Image');
    }
    throw new Error(`PDF-Konvertierung fehlgeschlagen: ${err.stderr?.slice(0, 300) || err.message || err}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractPdfFirstPageText(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curaflow-pdf-text-'));
  const inputPath = path.join(tempDir, 'document.pdf');

  try {
    await fs.writeFile(inputPath, buffer);
    const { stdout } = await execFileAsync('pdftotext', [
      '-f', '1',
      '-l', '1',
      '-layout',
      inputPath,
      '-',
    ]);
    return normalizeOcrText(stdout || '');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[certificateAnalyzer] pdftotext fehlt im Server-Image, falle auf OCR zurück');
      return '';
    }
    console.warn('[certificateAnalyzer] PDF-Text konnte nicht direkt extrahiert werden, falle auf OCR zurück:', err.message);
    return '';
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function prepareFileForOcr(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const pngBuffer = await renderPdfFirstPageToPng(buffer);
    return {
      buffer: pngBuffer,
      mimeType: 'image/png',
      sourceType: 'pdf',
    };
  }

  return {
    buffer,
    mimeType,
    sourceType: 'image',
  };
}

/**
 * Bereitet ein Bild für OCR auf: EXIF-Rotation, auf max 2000px skalieren,
 * Graustufen + Normalize für besseren Kontrast.
 */
async function preprocessForOcr(buffer, mimeType) {
  return preprocessForOcrAngle(buffer, mimeType, 0);
}

async function preprocessForOcrAngle(buffer, mimeType, rotationAngle = 0) {
  if (!mimeType?.startsWith('image/')) {
    return buffer;
  }
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const meta = await image.metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    let pipeline = image.rotate();
    if (longEdge > OCR_TARGET_LONG_EDGE) {
      pipeline = pipeline.resize({
        width: meta.width >= meta.height ? OCR_TARGET_LONG_EDGE : null,
        height: meta.height > meta.width ? OCR_TARGET_LONG_EDGE : null,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    if (rotationAngle) {
      pipeline = pipeline.rotate(rotationAngle, { background: '#ffffff' });
    }

    return await pipeline
      .grayscale()
      .normalize()
      .png()
      .toBuffer();
  } catch (err) {
    console.warn('[certificateAnalyzer] OCR-Preprocessing fehlgeschlagen, sende Original:', err.message);
    return buffer;
  }
}

async function runOcr(buffer, mimeType) {
  const prepped = await preprocessForOcr(buffer, mimeType);
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(prepped);
  const text = normalizeOcrText(data?.text || '');
  return {
    text: text.slice(0, MAX_OCR_CHARS),
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    truncated: text.length > MAX_OCR_CHARS,
    fullLength: text.length,
    angle: 0,
  };
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scoreOcrResult(result) {
  const confidence = typeof result?.confidence === 'number' ? result.confidence : 0;
  const textLength = result?.fullLength || result?.text?.length || 0;
  return (confidence * 20) + Math.min(textLength, 4000);
}

function shouldTryRotatedOcr(result) {
  if (!result) return true;
  const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
  const textLength = result.fullLength || result.text?.length || 0;
  return confidence < OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS || textLength < OCR_MIN_TEXT_LENGTH_FOR_SINGLE_PASS;
}

function buildDeskewAngles(baseAngle) {
  return OCR_DESKEW_FALLBACK_OFFSETS.map((offset) => baseAngle + offset);
}

async function recognizeOcrCandidate(worker, buffer, mimeType, angle) {
  const prepped = angle === 0
    ? await preprocessForOcr(buffer, mimeType)
    : await preprocessForOcrAngle(buffer, mimeType, angle);
  const { data } = await worker.recognize(prepped);
  const text = normalizeOcrText(data?.text || '');

  return {
    text: text.slice(0, MAX_OCR_CHARS),
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    truncated: text.length > MAX_OCR_CHARS,
    fullLength: text.length,
    angle,
  };
}

async function runOcrWithRotationFallback(buffer, mimeType) {
  const worker = await getOcrWorker();
  const attemptedAngles = [];
  let bestResult = null;

  for (const angle of OCR_ROTATION_FALLBACK_ANGLES) {
    const candidate = await recognizeOcrCandidate(worker, buffer, mimeType, angle);
    attemptedAngles.push({ angle, confidence: candidate.confidence, chars: candidate.fullLength });

    if (!bestResult || scoreOcrResult(candidate) > scoreOcrResult(bestResult)) {
      bestResult = candidate;
    }

    if (angle === 0 && !shouldTryRotatedOcr(candidate)) {
      return {
        ...candidate,
        attemptedAngles,
      };
    }
  }

  if (bestResult && shouldTryRotatedOcr(bestResult)) {
    for (const angle of buildDeskewAngles(bestResult.angle || 0)) {
      const candidate = await recognizeOcrCandidate(worker, buffer, mimeType, angle);
      attemptedAngles.push({ angle, confidence: candidate.confidence, chars: candidate.fullLength });

      if (scoreOcrResult(candidate) > scoreOcrResult(bestResult)) {
        bestResult = candidate;
      }
    }
  }

  return {
    ...bestResult,
    attemptedAngles,
  };
}

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
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
 * Analysiert eine Datei mit OCR + Text-LLM.
 *
 * @param {object} args
 * @param {Buffer} args.buffer        Datei-Inhalt
 * @param {string} args.mimeType      z.B. image/jpeg, application/pdf
 * @param {string} args.qualificationName
 * @param {string} [args.qualificationDescription]
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
      reasoning: 'LLM nicht konfiguriert (LLM_VISION_BASE_URL / LLM_VISION_MODEL).',
      raw: null,
      error: null,
    };
  }

  if (mimeType !== 'application/pdf' && !mimeType?.startsWith('image/')) {
    return {
      status: 'skipped',
      is_certificate: null,
      scope_match: null,
      scope_detected: null,
      granted_date: null,
      expiry_date: null,
      confidence: null,
      reasoning: `Dateityp ${mimeType || 'unbekannt'} wird nicht automatisch geprüft.`,
      raw: null,
      error: null,
    };
  }

  const baseUrl = process.env.LLM_VISION_BASE_URL.replace(/\/$/, '');
  const model = process.env.LLM_VISION_MODEL;

  // ---- OCR ----
  let ocrResult;
  let ocrInput;
  const ocrStartedAt = Date.now();
  try {
    const directPdfText = mimeType === 'application/pdf'
      ? await extractPdfFirstPageText(buffer)
      : '';

    if (directPdfText.length >= PDF_TEXT_MIN_LENGTH) {
      ocrResult = {
        text: directPdfText.slice(0, MAX_OCR_CHARS),
        confidence: 100,
        truncated: directPdfText.length > MAX_OCR_CHARS,
        fullLength: directPdfText.length,
        angle: 0,
        attemptedAngles: [{ angle: 0, confidence: 100, chars: directPdfText.length }],
        extractionMode: 'pdf-text',
      };
    } else {
      ocrInput = await prepareFileForOcr(buffer, mimeType);
      ocrResult = await runOcrWithRotationFallback(ocrInput.buffer, ocrInput.mimeType);
      ocrResult = {
        ...ocrResult,
        extractionMode: directPdfText.length > 0 ? 'pdf-ocr-fallback' : 'ocr',
      };

      if (directPdfText.length > 0 && directPdfText.length > ocrResult.fullLength) {
        ocrResult = {
          text: directPdfText.slice(0, MAX_OCR_CHARS),
          confidence: Math.max(ocrResult.confidence || 0, 100),
          truncated: directPdfText.length > MAX_OCR_CHARS,
          fullLength: directPdfText.length,
          angle: 0,
          attemptedAngles: [
            ...(ocrResult.attemptedAngles || []),
            { angle: 0, confidence: 100, chars: directPdfText.length, mode: 'pdf-text' },
          ],
          extractionMode: 'pdf-text-preferred',
        };
      }
    }
  } catch (err) {
    const errMsg = `OCR fehlgeschlagen: ${err.message || err}`;
    console.error('[certificateAnalyzer] OCR-Fehler', { name: err.name, message: err.message });
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

  console.info('[certificateAnalyzer] OCR fertig', {
    durationMs: Date.now() - ocrStartedAt,
    sourceType: ocrInput?.sourceType,
    extractionMode: ocrResult.extractionMode,
    chars: ocrResult.text.length,
    fullChars: ocrResult.fullLength,
    truncated: ocrResult.truncated,
    ocrConfidence: ocrResult.confidence,
    ocrAngle: ocrResult.angle,
    attemptedAngles: ocrResult.attemptedAngles,
  });

  if (!ocrResult.text || ocrResult.text.length < 10) {
    const errMsg = 'OCR konnte keinen lesbaren Text aus dem Bild extrahieren (zu unscharf, zu klein oder kein Text-Dokument?).';
    return {
      status: 'error',
      is_certificate: null,
      scope_match: null,
      scope_detected: null,
      granted_date: null,
      expiry_date: null,
      confidence: null,
      reasoning: errMsg,
      raw: ocrResult.text || null,
      error: errMsg,
    };
  }

  // ---- LLM ----
  const userText = buildUserPrompt({
    qualificationName,
    qualificationDescription,
    ocrText: ocrResult.text,
  });

  const body = {
    model,
    max_tokens: RESPONSE_MAX_TOKENS,
    temperature: 0.1,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userText },
    ],
  };

  console.info('[certificateAnalyzer] LLM-Aufruf', {
    baseUrl,
    model,
    qualificationName,
    promptChars: userText.length,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const errMsg = `LLM HTTP ${response.status}: ${text.slice(0, 400)}`;
      console.error('[certificateAnalyzer] HTTP-Fehler vom LLM', { status: response.status, body: text.slice(0, 1000) });
      return {
        status: 'error',
        is_certificate: null,
        scope_match: null,
        scope_detected: null,
        granted_date: null,
        expiry_date: null,
        confidence: null,
        reasoning: errMsg,
        raw: ocrResult.text,
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
