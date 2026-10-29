// The vision client without a key or a network (part of npm run test:ui): the requests it builds, the parsing and
// validation of recorded answers (e2e-web/vision/recorded/), the votes, the cache, and that the key goes nowhere but
// the auth header.
import { expect, test } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ask, buildRequest, cacheKey, DEFAULT_ANTHROPIC_MODEL, majority, parseAnswer, validate, visionConfig, type VisionConfig } from './vision/client'
import { DARK_SPECTRUM, KEY_FIGURES, PROTEIN_PANEL, SPECTRUM, type SpectrumAnswer } from './vision/questions'

const recorded = (name: string) => JSON.parse(readFileSync(new URL(`./vision/recorded/${name}.json`, import.meta.url), 'utf8')) as unknown
const FAKE_KEY = 'fake-key-for-the-request-builder-test'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const anthropic: VisionConfig = { provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, key: FAKE_KEY, votes: 1, refresh: false }
const openai: VisionConfig = { provider: 'openai', model: 'gpt-test', key: FAKE_KEY, votes: 1, refresh: false }

test('the configuration comes from the environment only, and there is none without a key', () => {
  expect(visionConfig({})).toBeNull()
  expect(visionConfig({ VISION_API_KEY: '  ' })).toBeNull()
  expect(visionConfig({ VISION_API_KEY: FAKE_KEY })).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', key: FAKE_KEY, votes: 1, refresh: false })
  expect(visionConfig({ VISION_API_KEY: FAKE_KEY, VISION_PROVIDER: 'openai', VISION_MODEL: 'gpt-test', VISION_VOTES: '3' })?.votes).toBe(3)
  expect(() => visionConfig({ VISION_API_KEY: FAKE_KEY, VISION_PROVIDER: 'openai' })).toThrow(/VISION_MODEL/)
  expect(() => visionConfig({ VISION_API_KEY: FAKE_KEY, VISION_PROVIDER: 'other' })).toThrow(/anthropic or openai/)
})

test('the Anthropic request: the Messages API, the key in x-api-key only, the image and a strict JSON schema, no sampling parameters', () => {
  const { url, init } = buildRequest(anthropic, SPECTRUM, PNG)
  expect(url).toBe('https://api.anthropic.com/v1/messages')
  expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-api-key': FAKE_KEY, 'anthropic-version': '2026-10-21' })
  expect(init.body).not.toContain(FAKE_KEY)
  const body = JSON.parse(init.body)
  expect(body.model).toBe('claude-sonnet-5-5')
  expect(body.output_config.format).toEqual({ type: 'json_schema', schema: SPECTRUM.schema })
  expect(body).not.toHaveProperty('temperature')
  expect(body).not.toHaveProperty('tool_choice')
  const [image, text] = body.messages[0].content
  expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') } })
  expect(text).toEqual({ type: 'text', text: SPECTRUM.prompt })
})

test('the OpenAI request: chat completions, the key as bearer token only, json_schema strict, temperature 0', () => {
  const { url, init } = buildRequest(openai, SPECTRUM, PNG)
  expect(url).toBe('https://api.openai.com/v1/chat/completions')
  expect(init.headers.authorization).toBe(`Bearer ${FAKE_KEY}`)
  expect(init.body).not.toContain(FAKE_KEY)
  const body = JSON.parse(init.body)
  expect(body.temperature).toBe(0)
  expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'spectrum', strict: true, schema: SPECTRUM.schema } })
  expect(body.messages[1].content[0].image_url.url).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
})

test('every object of the schemas is strict: all properties required, no others', () => {
  const check = (s: unknown): void => {
    const o = s as Record<string, unknown>
    if (o.type === 'object') {
      expect(o.additionalProperties).toBe(false)
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort())
      Object.values(o.properties as object).forEach(check)
    }
    if (o.items) check(o.items)
    if (o.anyOf) (o.anyOf as unknown[]).forEach(check)
  }
  for (const q of [SPECTRUM, DARK_SPECTRUM, PROTEIN_PANEL, KEY_FIGURES]) check(q.schema)
})

test('recorded answers parse and validate; refusals, cut-offs and answers off the schema fail', () => {
  const a = parseAnswer('anthropic', recorded('anthropic-spectrum'), SPECTRUM.schema) as SpectrumAnswer
  expect(a.peak_labels).toContain('b4')
  expect([a.b_ion_colour, a.y_ion_colour, a.x_axis_label]).toEqual(['blue', 'orange', 'm/z'])
  expect(parseAnswer('openai', recorded('openai-spectrum'), SPECTRUM.schema)).toEqual(a)
  expect(() => parseAnswer('anthropic', recorded('anthropic-refusal'), SPECTRUM.schema)).toThrow(/declined/)
  const cut = { ...(recorded('anthropic-spectrum') as object), stop_reason: 'max_tokens' }
  expect(() => parseAnswer('anthropic', cut, SPECTRUM.schema)).toThrow(/cut off/)
  const text = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] })
  expect(() => parseAnswer('anthropic', text('not json'), SPECTRUM.schema)).toThrow(/not JSON/)
  expect(() => parseAnswer('anthropic', text(JSON.stringify({ ...a, b_ion_colour: 'teal' })), SPECTRUM.schema)).toThrow(/teal is not one of/)
  expect(() => parseAnswer('anthropic', text(JSON.stringify({ ...a, extra: 1 })), SPECTRUM.schema)).toThrow(/extra: not in the schema/)
  const { y_axis_label: _, ...missing } = a
  expect(validate(missing, SPECTRUM.schema, '$')).toEqual(['$.y_axis_label: missing'])
})

test('votes merge by majority: scalars by count, lists by the items most answers have', () => {
  expect(majority([{ c: 'blue', l: ['b2', 'b3'] }, { c: 'blue', l: ['b2'] }, { c: 'red', l: ['b2', 'b3', 'y9'] }])).toEqual({ c: 'blue', l: ['b2', 'b3'] })
  expect(majority([true, false, false])).toBe(false)
})

test('answers are cached by the screenshot and the question; the cache holds no key', async () => {
  const dir = `${mkdtempSync(join(tmpdir(), 'vision-cache-'))}/`
  try {
    let calls = 0
    const fetcher = (async (_url: string, init: { headers: Record<string, string> }) => {
      calls++
      expect(init.headers['x-api-key']).toBe(FAKE_KEY)
      return new Response(JSON.stringify(recorded('anthropic-spectrum')), { status: 200 })
    }) as unknown as typeof fetch
    const first = await ask<SpectrumAnswer>(anthropic, SPECTRUM, PNG, { fetcher, cacheDir: dir })
    const again = await ask<SpectrumAnswer>(anthropic, SPECTRUM, PNG, { fetcher, cacheDir: dir })
    expect([first.cached, again.cached, calls]).toEqual([false, true, 1])
    expect(again.answer).toEqual(first.answer)
    // another image is another question; three votes are three calls
    await ask(anthropic, SPECTRUM, Uint8Array.from([...PNG, 9]), { fetcher, cacheDir: dir })
    await ask({ ...anthropic, votes: 3 }, SPECTRUM, PNG, { fetcher, cacheDir: dir })
    expect(calls).toBe(5)
    expect(cacheKey(anthropic, SPECTRUM, PNG)).not.toBe(cacheKey({ ...anthropic, model: 'other' }, SPECTRUM, PNG))
    for (const f of readdirSync(dir)) expect(readFileSync(dir + f, 'utf8')).not.toContain(FAKE_KEY)
    // an HTTP error names the status, not the request
    const failing = (async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })) as unknown as typeof fetch
    const error = await ask({ ...anthropic, refresh: true }, SPECTRUM, PNG, { fetcher: failing, cacheDir: dir }).catch((e: Error) => e.message)
    expect(error).toMatch(/HTTP 401/)
    expect(error).not.toContain(FAKE_KEY)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
