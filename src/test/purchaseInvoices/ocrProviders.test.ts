/* eslint-disable @typescript-eslint/no-explicit-any -- captured request payloads */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractInvoiceStructured, geminiBudgetMs, geminiSkipReason, GEMINI_INLINE_MAX_BYTES, normalizeMime, OcrProviderError,
  readGeminiJson, toGeminiSchema, type OcrCallOptions, type OcrDocument,
} from '../../../supabase/functions/_shared/purchaseInvoices/ocrProviders';
import { EXTRACT_TOOL, SYSTEM_PROMPT, TOTALS_TOOL } from '../../../supabase/functions/_shared/purchaseInvoices/ocrSchemas';

// Synthetic document bytes only — never a real invoice.
const PDF: OcrDocument = { mimeType: 'application/pdf', base64: 'JVBERi0xLjQKc3ludGhldGlj', byteLength: 18, filename: 'invoice.pdf' };
const JPEG: OcrDocument = { mimeType: 'image/jpg', base64: '/9j/c3ludGhldGlj', byteLength: 12, filename: 'photo.jpg' };

const GEMINI_ENV: Record<string, string> = {
  GEMINI_API_KEY: 'gemini-test-key', OPENAI_API_KEY: 'openai-test-key', GEMINI_PAID_DATA_PROCESSING_CONFIRMED: 'true',
};

const EXTRACTED = {
  document_type: 'invoice', document_kind: 'normal_invoice', confidence_score: 0.93, currency: 'HUF', vat_lines: [], items: [],
  field_confidence: {
    merchant_tax_id: 0.9, buyer_tax_id: 0.9, invoice_number: 0.9, invoice_date: 0.9, currency: 0.9, total_amount: 0.9, net_amount: 0.9, total_vat_amount: 0.9,
  },
  merchant_name: 'Teszt Beszállító Kft.', invoice_number: 'TST-2026-001', total_amount: 12700, net_amount: 10000, total_vat_amount: 2700,
};

const geminiOk = (value: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
  modelVersion: 'gemini-3.5-flash-001', ...extra,
}), { status: 200 });

const openAiOk = (value: unknown, name = 'return_invoice') => new Response(JSON.stringify({
  model: 'gpt-4o-2024-08-06',
  choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(value) } }] } }],
}), { status: 200 });

interface Captured { url: string; init: RequestInit; body: any }

function fakeFetch(handlers: { gemini?: Array<() => Response | Promise<Response>>; openai?: Array<() => Response | Promise<Response>> }) {
  const calls: Captured[] = [];
  const queues = { gemini: [...(handlers.gemini ?? [])], openai: [...(handlers.openai ?? [])] };
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) });
    const queue = href.includes('generativelanguage.googleapis.com') ? queues.gemini : href.includes('api.openai.com') ? queues.openai : null;
    const next = queue?.shift();
    if (!next) throw new Error(`unexpected request to ${href}`);
    return next();
  }) as typeof fetch;
  return { impl, calls, gemini: () => calls.filter((c) => c.url.includes('generativelanguage')), openai: () => calls.filter((c) => c.url.includes('api.openai.com')) };
}

function options(overrides: Partial<OcrCallOptions> & { envValues?: Record<string, string> } = {}): OcrCallOptions {
  const { envValues, ...rest } = overrides;
  const env = envValues ?? GEMINI_ENV;
  return {
    document: PDF,
    system: SYSTEM_PROMPT,
    userText: 'Extract structured invoice data and call return_invoice.',
    tool: { name: EXTRACT_TOOL.function.name, description: EXTRACT_TOOL.function.description, parameters: EXTRACT_TOOL.function.parameters },
    timeoutMs: 110_000,
    validate: (v) => typeof v.document_type === 'string' && Array.isArray(v.vat_lines) && Array.isArray(v.items),
    env: (name) => env[name],
    sleep: async () => {},
    ...rest,
  };
}

function walk(schema: any, visit: (node: any) => void) {
  visit(schema);
  if (schema.items) walk(schema.items, visit);
  for (const child of Object.values(schema.properties ?? {})) walk(child, visit);
}

afterEach(() => vi.restoreAllMocks());

describe('Gemini response schema conversion', () => {
  it('maps nullable JSON Schema types, null enums and drops additionalProperties', () => {
    const converted = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      required: ['a', 'missing'],
      properties: {
        a: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        b: { type: ['string', 'null'], enum: ['X', 'Y', null] },
        c: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['d'], properties: { d: { type: 'string' } } } },
      },
    });
    expect(converted).toEqual({
      type: 'OBJECT',
      required: ['a'],
      propertyOrdering: ['a', 'b', 'c'],
      properties: {
        a: { type: 'NUMBER', nullable: true, minimum: 0, maximum: 1 },
        b: { type: 'STRING', nullable: true, enum: ['X', 'Y'] },
        c: { type: 'ARRAY', items: { type: 'OBJECT', required: ['d'], propertyOrdering: ['d'], properties: { d: { type: 'STRING' } } } },
      },
    });
  });

  it('rejects union types Gemini cannot express', () => {
    expect(() => toGeminiSchema({ type: ['string', 'number'] })).toThrow(/one type per field/);
  });

  it('converts the real extraction and totals schemas into the supported subset', () => {
    for (const tool of [EXTRACT_TOOL, TOTALS_TOOL]) {
      const converted = toGeminiSchema(tool.function.parameters);
      walk(converted, (node) => {
        expect(node).not.toHaveProperty('additionalProperties');
        expect(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT']).toContain(node.type);
        if (node.enum) expect(node.enum.every((v: unknown) => typeof v === 'string')).toBe(true);
      });
    }
    const extract = toGeminiSchema(EXTRACT_TOOL.function.parameters) as any;
    expect(extract.properties.error_code).toMatchObject({ type: 'STRING', nullable: true });
    expect(extract.properties.error_code.enum).not.toContain(null);
    expect(extract.properties.total_amount).toEqual({ type: 'NUMBER', nullable: true });
    expect(extract.required).toEqual(EXTRACT_TOOL.function.parameters.required);
  });
});

describe('Gemini eligibility for confidential invoices', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it('requires a key, no kill switch and confirmed paid data-processing terms', () => {
    expect(geminiSkipReason(PDF, env({}))).toBe('gemini_not_configured');
    expect(geminiSkipReason(PDF, env({ ...GEMINI_ENV, GEMINI_DISABLED: 'true' }))).toBe('gemini_disabled');
    expect(geminiSkipReason(PDF, env({ GEMINI_API_KEY: 'k' }))).toBe('paid_data_processing_not_confirmed');
    expect(geminiSkipReason(PDF, env(GEMINI_ENV))).toBeNull();
  });

  it('only sends file types and sizes Gemini accepts inline', () => {
    expect(geminiSkipReason({ ...JPEG, mimeType: 'image/gif' }, env(GEMINI_ENV))).toBe('unsupported_file_type');
    expect(geminiSkipReason({ ...PDF, byteLength: GEMINI_INLINE_MAX_BYTES + 1 }, env(GEMINI_ENV))).toBe('file_too_large_for_inline');
    expect(geminiSkipReason({ ...JPEG, mimeType: 'image/heic' }, env(GEMINI_ENV))).toBeNull();
    expect(normalizeMime('image/JPG')).toBe('image/jpeg');
  });

  it('leaves the OpenAI fallback a fair share of the time budget', () => {
    expect(geminiBudgetMs(110_000, true)).toBe(50_000);
    expect(geminiBudgetMs(40_000, true)).toBe(22_000);
    expect(geminiBudgetMs(20_000, true)).toBe(15_000);
    expect(geminiBudgetMs(110_000, false)).toBe(110_000);
  });
});

describe('Gemini response parsing', () => {
  it('reads JSON text parts and ignores thought parts', () => {
    expect(readGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":1}' }] } }] }))
      .toEqual({ value: { a: 1 } });
  });

  it('reports blocked, truncated and malformed answers', () => {
    expect(readGeminiJson({ promptFeedback: { blockReason: 'SAFETY' } })).toEqual({ failure: 'blocked_prompt' });
    expect(readGeminiJson({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })).toEqual({ failure: 'finish_safety' });
    expect(readGeminiJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }] })).toEqual({ failure: 'max_tokens' });
    expect(readGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] })).toEqual({ failure: 'invalid_json' });
    expect(readGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[1,2]' }] } }] })).toEqual({ failure: 'invalid_json' });
    expect(readGeminiJson({ candidates: [] })).toEqual({ failure: 'empty_response' });
  });
});

describe('Gemini first, OpenAI fallback', () => {
  it('reads a PDF with native Gemini and never calls OpenAI when the answer validates', async () => {
    const f = fakeFetch({ gemini: [() => geminiOk(EXTRACTED)] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl }));
    expect(result).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash-001', geminiFallbackReason: null });
    expect(result.parsed.invoice_number).toBe('TST-2026-001');
    expect(f.openai()).toHaveLength(0);
    const [call] = f.gemini();
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-test-key');
    expect(call.body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'application/pdf', data: PDF.base64 } });
    expect(call.body.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
    expect(call.body.generationConfig.responseSchema.type).toBe('OBJECT');
    expect(call.body.systemInstruction.parts[0].text).toContain("replaces the 'return_invoice' tool call");
  });

  it('honours GEMINI_OCR_MODEL and normalizes image/jpg', async () => {
    const f = fakeFetch({ gemini: [() => geminiOk(EXTRACTED, { modelVersion: undefined })] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl, document: JPEG, envValues: { ...GEMINI_ENV, GEMINI_OCR_MODEL: 'gemini-ocr-test' } }));
    expect(result.model).toBe('gemini-ocr-test');
    expect(f.gemini()[0].url).toContain('/models/gemini-ocr-test:generateContent');
    expect(f.gemini()[0].body.contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg');
  });

  it('skips Gemini without confirmed paid terms and sends the PDF to OpenAI as a file part', async () => {
    const f = fakeFetch({ openai: [() => openAiOk(EXTRACTED)] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl, envValues: { GEMINI_API_KEY: 'k', OPENAI_API_KEY: 'o' } }));
    expect(result).toMatchObject({ provider: 'openai', model: 'gpt-4o-2024-08-06', geminiFallbackReason: 'paid_data_processing_not_confirmed' });
    expect(f.gemini()).toHaveLength(0);
    const [call] = f.openai();
    expect(call.body.model).toBe('gpt-4o');
    expect(call.body.tool_choice).toEqual({ type: 'function', function: { name: 'return_invoice' } });
    expect(call.body.messages[1].content[1]).toEqual({ type: 'file', file: { filename: 'invoice.pdf', file_data: `data:application/pdf;base64,${PDF.base64}` } });
  });

  it('sends unsupported image types to OpenAI as image_url', async () => {
    const f = fakeFetch({ openai: [() => openAiOk(EXTRACTED)] });
    const gif = { ...JPEG, mimeType: 'image/gif' };
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl, document: gif }));
    expect(result.geminiFallbackReason).toBe('unsupported_file_type');
    expect(f.openai()[0].body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/gif;base64,${JPEG.base64}` } });
  });

  it('retries one transient Gemini error before falling back', async () => {
    const sleep = vi.fn(async () => {});
    const f = fakeFetch({ gemini: [() => new Response('busy', { status: 503 }), () => geminiOk(EXTRACTED)] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl, sleep }));
    expect(result.provider).toBe('gemini');
    expect(f.gemini()).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('falls back to OpenAI after repeated transient Gemini errors', async () => {
    const f = fakeFetch({
      gemini: [() => new Response('busy', { status: 503 }), () => new Response('busy', { status: 503 })],
      openai: [() => openAiOk(EXTRACTED)],
    });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl }));
    expect(result).toMatchObject({ provider: 'openai', geminiFallbackReason: 'http_503' });
    expect(f.gemini()).toHaveLength(2);
  });

  it('does not retry a Gemini request error and falls back at once', async () => {
    const f = fakeFetch({ gemini: [() => new Response('bad', { status: 400 })], openai: [() => openAiOk(EXTRACTED)] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl }));
    expect(result.geminiFallbackReason).toBe('http_400');
    expect(f.gemini()).toHaveLength(1);
  });

  it.each([
    ['invalid JSON', () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'no' }] } }] })), 'invalid_json'],
    ['a safety stop', () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })), 'finish_safety'],
    ['missing required fields', () => geminiOk({ document_type: 'invoice' }), 'output_validation_failed'],
    ['a failed business check', () => geminiOk({ ...EXTRACTED, items: 'none' }), 'output_validation_failed'],
  ])('rejects Gemini output with %s and asks OpenAI instead', async (_label, gemini, reason) => {
    const f = fakeFetch({ gemini: [gemini], openai: [() => openAiOk(EXTRACTED)] });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl }));
    expect(result).toMatchObject({ provider: 'openai', geminiFallbackReason: reason });
  });

  it('keeps the fallback inside the overall budget after a Gemini timeout', async () => {
    let clock = 0;
    const f = fakeFetch({
      gemini: [async () => { clock += 50_000; throw new DOMException('timed out', 'TimeoutError'); }],
      openai: [() => openAiOk(EXTRACTED)],
    });
    const result = await extractInvoiceStructured(options({ fetchImpl: f.impl, now: () => clock }));
    expect(result.geminiFallbackReason).toBe('timeout');
    expect(f.openai()).toHaveLength(1);

    clock = 0;
    const tight = fakeFetch({ gemini: [async () => { clock += 30_000; throw new DOMException('timed out', 'TimeoutError'); }] });
    await expect(extractInvoiceStructured(options({ fetchImpl: tight.impl, now: () => clock, timeoutMs: 35_000 })))
      .rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(tight.openai()).toHaveLength(0);
  });

  it('reports a configuration error when no provider may read the invoice', async () => {
    const f = fakeFetch({});
    await expect(extractInvoiceStructured(options({ fetchImpl: f.impl, envValues: { GEMINI_API_KEY: 'k' } })))
      .rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', httpStatus: 503 });
    expect(f.calls).toHaveLength(0);
  });

  it('respects GEMINI_OPENAI_FALLBACK_DISABLED after a Gemini failure', async () => {
    const f = fakeFetch({ gemini: [() => new Response('bad', { status: 400 })] });
    await expect(extractInvoiceStructured(options({ fetchImpl: f.impl, envValues: { ...GEMINI_ENV, GEMINI_OPENAI_FALLBACK_DISABLED: 'true' } })))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(f.openai()).toHaveLength(0);
  });

  it.each([
    [429, 'AI_RATE_LIMIT'],
    [402, 'AI_CREDITS'],
    [500, 'AI_UNAVAILABLE'],
    [400, 'AI_REJECTED'],
  ])('maps OpenAI HTTP %s to %s', async (status, code) => {
    const f = fakeFetch({ openai: [() => new Response('error', { status })] });
    const error = await extractInvoiceStructured(options({ fetchImpl: f.impl, envValues: { OPENAI_API_KEY: 'o' } })).catch((e) => e);
    expect(error).toBeInstanceOf(OcrProviderError);
    expect(error.code).toBe(code);
  });

  it('maps an OpenAI timeout to a retryable AI_TIMEOUT and a wrong tool to AI_NO_DATA', async () => {
    const slow = fakeFetch({ openai: [async () => { throw new DOMException('timed out', 'TimeoutError'); }] });
    await expect(extractInvoiceStructured(options({ fetchImpl: slow.impl, envValues: { OPENAI_API_KEY: 'o' } })))
      .rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    const wrong = fakeFetch({ openai: [() => openAiOk(EXTRACTED, 'something_else')] });
    await expect(extractInvoiceStructured(options({ fetchImpl: wrong.impl, envValues: { OPENAI_API_KEY: 'o' } })))
      .rejects.toMatchObject({ code: 'AI_NO_DATA' });
  });

  it('never logs document content or model output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeFetch({ gemini: [() => geminiOk({ document_type: 'invoice', secret: 'TST-2026-001' })], openai: [() => openAiOk(EXTRACTED)] });
    await extractInvoiceStructured(options({ fetchImpl: f.impl }));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(PDF.base64);
    expect(logged).not.toContain('TST-2026-001');
    expect(logged).toContain('output_validation_failed');
  });
});
