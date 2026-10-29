// Vision checks of screenshots: a structured question about a PNG to a vision-capable model through its HTTP API,
// answered as JSON of a fixed schema, cached by the hash of what was asked.
//
// The key comes ONLY from the environment (VISION_API_KEY), never from a file; it is sent in a request header and
// nowhere else: not logged, not in an error message, not in the cache. Without it the vision tests skip.
//   VISION_PROVIDER  anthropic (default) | openai
//   VISION_MODEL     anthropic: claude-sonnet-5-5 (default); openai: required (no default is guessed)
//   VISION_VOTES     answers per question, merged by majority (default 1)
//   VISION_REFRESH   1: ask again although an answer is cached
//
// Flakiness control: a fixed prompt and schema per screen, a strict JSON schema the API enforces (Anthropic
// output_config.format, OpenAI response_format json_schema strict), validation of the answer here, majority votes,
// and the cache: one answer per exact screenshot, so a rerun of unchanged screens asks nothing and answers the same.
// (Anthropic's API version 2026-10-21 rejects temperature, so determinism comes from the cache and the votes there;
// OpenAI gets temperature 0.)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Provider = 'anthropic' | 'openai'
export interface VisionConfig {
  provider: Provider
  model: string
  /** the API key: only ever put into the request's auth header */
  key: string
  votes: number
  refresh: boolean
}

/** A JSON schema of the subset the answers use (objects with all properties required, arrays, enums). */
export type Schema =
  | { type: 'object'; properties: Record<string, Schema>; required: string[]; additionalProperties: false; description?: string }
  | { type: 'array'; items: Schema; description?: string }
  | { type: 'string'; enum?: string[]; description?: string }
  | { type: 'number' | 'integer' | 'boolean'; description?: string }
  | { anyOf: Schema[]; description?: string }
  | { type: 'null' }

export interface Question {
  /** what the answer is about (the cache file's name prefix) */
  name: string
  prompt: string
  schema: Schema & { type: 'object' }
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

const SYSTEM =
  'You inspect screenshots of a scientific desktop application (proteomics search results) for a software test. ' +
  'Answer only from what is visible in the image. Do not guess values that are not legible; use null or an empty list. ' +
  'Answer with JSON that follows the given schema exactly.'

/** The configuration from the environment, or null without VISION_API_KEY (the vision tests skip then). */
export function visionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig | null {
  const key = env.VISION_API_KEY?.trim()
  if (!key) return null
  const provider = (env.VISION_PROVIDER?.trim().toLowerCase() || 'anthropic') as Provider
  if (provider !== 'anthropic' && provider !== 'openai') throw new Error(`VISION_PROVIDER must be anthropic or openai, not ${provider}`)
  const model = env.VISION_MODEL?.trim() || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '')
  if (!model) throw new Error('VISION_MODEL is required with VISION_PROVIDER=openai')
  const votes = Math.max(1, Math.floor(Number(env.VISION_VOTES ?? 1)) || 1)
  return { provider, model, key, votes, refresh: env.VISION_REFRESH === '1' }
}

/** The HTTP request that asks `q` about the PNG `image`. */
export function buildRequest(cfg: VisionConfig, q: Question, image: Uint8Array): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const data = Buffer.from(image).toString('base64')
  if (cfg.provider === 'anthropic') {
    return {
      url: ANTHROPIC_URL,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2026-10-21' },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 4096,
          system: SYSTEM,
          // a perception task: little thinking needed
          output_config: { effort: 'low', format: { type: 'json_schema', schema: q.schema } },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
                { type: 'text', text: q.prompt },
              ],
            },
          ],
        }),
      },
    }
  }
  return {
    url: OPENAI_URL,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: q.name.replace(/[^a-zA-Z0-9_-]/g, '_'), strict: true, schema: q.schema } },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${data}`, detail: 'high' } },
              { type: 'text', text: q.prompt },
            ],
          },
        ],
      }),
    },
  }
}

/** The answer of an API response body (parsed JSON), validated against `schema`. Throws on a refusal, a cut-off or a bad answer. */
export function parseAnswer(provider: Provider, response: unknown, schema: Schema): unknown {
  const r = response as Record<string, unknown>
  let text: string
  if (provider === 'anthropic') {
    if (r.stop_reason === 'refusal') throw new Error('the model declined to answer (stop_reason refusal)')
    if (r.stop_reason === 'max_tokens') throw new Error('the answer was cut off (stop_reason max_tokens)')
    const blocks = (r.content as { type: string; text?: string }[] | undefined) ?? []
    text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  } else {
    const choice = (r.choices as { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] | undefined)?.[0]
    if (choice?.message?.refusal) throw new Error('the model declined to answer (refusal)')
    if (choice?.finish_reason === 'length') throw new Error('the answer was cut off (finish_reason length)')
    text = choice?.message?.content ?? ''
  }
  if (!text.trim()) throw new Error('the response has no text answer')
  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    throw new Error(`the answer is not JSON: ${text.slice(0, 200)}`)
  }
  const problems = validate(answer, schema, '$')
  if (problems.length > 0) throw new Error(`the answer does not follow the schema: ${problems.join('; ')}`)
  return answer
}

/** What is wrong with `value` against `schema` (empty: nothing). */
export function validate(value: unknown, schema: Schema, at: string): string[] {
  if ('anyOf' in schema) return schema.anyOf.some((s) => validate(value, s, at).length === 0) ? [] : [`${at}: matches none of anyOf`]
  switch (schema.type) {
    case 'null':
      return value === null ? [] : [`${at}: not null`]
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${at}: not a boolean`]
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : [`${at}: not a number`]
    case 'integer':
      return Number.isInteger(value) ? [] : [`${at}: not an integer`]
    case 'string':
      if (typeof value !== 'string') return [`${at}: not a string`]
      return schema.enum && !schema.enum.includes(value) ? [`${at}: ${value} is not one of ${schema.enum.join(', ')}`] : []
    case 'array':
      return Array.isArray(value) ? value.flatMap((v, i) => validate(v, schema.items, `${at}[${i}]`)) : [`${at}: not an array`]
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at}: not an object`]
      const o = value as Record<string, unknown>
      return [
        ...schema.required.filter((k) => !(k in o)).map((k) => `${at}.${k}: missing`),
        ...Object.keys(o).filter((k) => !(k in schema.properties)).map((k) => `${at}.${k}: not in the schema`),
        ...Object.entries(schema.properties).flatMap(([k, s]) => (k in o ? validate(o[k], s, `${at}.${k}`) : [])),
      ]
    }
  }
}

/** Merges several answers: each field by majority (ties: the first answer's); lists of strings by items in most of them. */
export function majority(answers: unknown[]): unknown {
  if (answers.length === 1) return answers[0]
  const first = answers[0]
  if (Array.isArray(first) && first.every((x) => typeof x === 'string')) {
    const lists = answers as string[][]
    const need = Math.floor(lists.length / 2) + 1
    const all = [...new Set(lists.flat())]
    return all.filter((item) => lists.filter((l) => l.includes(item)).length >= need)
  }
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    return Object.fromEntries(Object.keys(first).map((k) => [k, majority(answers.map((a) => (a as Record<string, unknown>)[k]))]))
  }
  const counts = new Map<string, { value: unknown; n: number }>()
  for (const a of answers) {
    const key = JSON.stringify(a)
    const c = counts.get(key) ?? { value: a, n: 0 }
    c.n++
    counts.set(key, c)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].value
}

/** The cache key of a question about an image: what decides the answer (not the key). */
export function cacheKey(cfg: Pick<VisionConfig, 'provider' | 'model' | 'votes'>, q: Question, image: Uint8Array): string {
  return createHash('sha256')
    .update(cfg.provider)
    .update('\0')
    .update(cfg.model)
    .update('\0')
    .update(String(cfg.votes))
    .update('\0')
    .update(SYSTEM)
    .update('\0')
    .update(q.prompt)
    .update('\0')
    .update(JSON.stringify(q.schema))
    .update('\0')
    .update(image)
    .digest('hex')
}

export const CACHE_DIR = fileURLToPath(new URL('../.vision-cache/', import.meta.url))

/**
 * The answer to `q` about `image`: from the cache (CACHE_DIR, by `cacheKey`), else asked `cfg.votes` times and merged
 * by majority, then cached. `fetcher` is the HTTP client (fetch; a fake in the tests).
 */
export async function ask<T>(cfg: VisionConfig, q: Question, image: Uint8Array, opts: { fetcher?: typeof fetch; cacheDir?: string } = {}): Promise<{ answer: T; cached: boolean }> {
  const dir = opts.cacheDir ?? CACHE_DIR
  const file = `${dir}${q.name}-${cacheKey(cfg, q, image).slice(0, 24)}.json`
  if (!cfg.refresh && existsSync(file)) return { answer: (JSON.parse(readFileSync(file, 'utf8')) as { answer: T }).answer, cached: true }
  const fetcher = opts.fetcher ?? fetch
  const answers: unknown[] = []
  for (let v = 0; v < cfg.votes; v++) {
    const { url, init } = buildRequest(cfg, q, image)
    let response: Response | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetcher(url, init)
      if (response.status !== 429 && response.status < 500) break
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
    // (the status and the API's own error text only: never the request, whose header has the key)
    if (!response!.ok) throw new Error(`${cfg.provider} API: HTTP ${response!.status} ${(await response!.text()).slice(0, 300)}`)
    answers.push(parseAnswer(cfg.provider, await response!.json(), q.schema))
  }
  const answer = majority(answers) as T
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify({ question: q.name, provider: cfg.provider, model: cfg.model, votes: cfg.votes, answer }, null, 2))
  return { answer, cached: false }
}
