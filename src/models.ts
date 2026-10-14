/**
 * Two ways to call a model: an OpenAI-compatible chat endpoint (a local gateway here) and the
 * Anthropic Messages API. Both retry what a retry can fix (rate limits, server errors, a dropped
 * connection, a cut-off stream) and nothing else. The reply parsing for OpenAI-compatible
 * servers follows judge-mutants: some gateways answer with SSE chunks even when not asked to.
 */

export interface ModelConfig {
  /** Short name used in file names and on the page, e.g. "gpt-6-luna". */
  name: string
  provider: "openai" | "anthropic"
  model: string
  endpoint: string
  /** The environment variable that holds the API key. */
  apiKeyEnv: string
  maxTokens: number
  /** US dollars per million tokens, to keep a run inside a budget. */
  price?: { input: number; output: number }
}

export interface Usage {
  input: number
  output: number
}

export interface Reply {
  text: string
  finish: string | null
  usage: Usage | null
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
    this.status = status
  }
}

export class IncompleteReply extends Error {}

interface Choice {
  message?: { content?: string | null }
  delta?: { content?: string | null }
  finish_reason?: string | null
}

interface OpenAiBody {
  choices?: Choice[]
  error?: { message?: string }
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function usageOf(body: OpenAiBody): Usage | null {
  const u = body.usage
  return u?.prompt_tokens === undefined || u.completion_tokens === undefined ? null : { input: u.prompt_tokens, output: u.completion_tokens }
}

/** An OpenAI-style chat completion, whether the server answered with JSON or with SSE chunks. */
export function parseOpenAi(body: string): Reply {
  const trimmed = body.trim()
  if (/^(data:|:|event:)/.test(trimmed)) {
    let text = ""
    let finish: string | null = null
    let usage: Usage | null = null
    let done = false
    for (const line of trimmed.split("\n")) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") {
        done = true
        continue
      }
      if (!data) continue
      let chunk: OpenAiBody
      try {
        chunk = JSON.parse(data) as OpenAiBody
      } catch {
        throw new IncompleteReply("a stream chunk was cut off")
      }
      if (chunk.error) throw new IncompleteReply(`API error in the stream: ${chunk.error.message ?? "unknown"}`)
      const choice = chunk.choices?.[0]
      text += choice?.delta?.content ?? choice?.message?.content ?? ""
      finish = choice?.finish_reason ?? finish
      usage = usageOf(chunk) ?? usage
    }
    if (!done && finish === null) throw new IncompleteReply("the stream ended before it said it was done")
    return { text, finish, usage }
  }
  let parsed: OpenAiBody
  try {
    parsed = JSON.parse(trimmed) as OpenAiBody
  } catch {
    throw new IncompleteReply(`the reply is neither JSON nor a stream: ${trimmed.slice(0, 120)}`)
  }
  if (parsed.error) throw new IncompleteReply(`API error: ${parsed.error.message ?? "unknown"}`)
  const choice = parsed.choices?.[0]
  return { text: choice?.message?.content ?? "", finish: choice?.finish_reason ?? null, usage: usageOf(parsed) }
}

interface AnthropicBody {
  content?: { type: string; text?: string }[]
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

export function parseAnthropic(body: string): Reply {
  let parsed: AnthropicBody
  try {
    parsed = JSON.parse(body) as AnthropicBody
  } catch {
    throw new IncompleteReply(`the reply is not JSON: ${body.slice(0, 120)}`)
  }
  if (parsed.error) throw new IncompleteReply(`API error: ${parsed.error.message ?? "unknown"}`)
  const text = (parsed.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("")
  const u = parsed.usage
  const usage = u?.input_tokens === undefined || u.output_tokens === undefined ? null : { input: u.input_tokens, output: u.output_tokens }
  return { text, finish: parsed.stop_reason ?? null, usage }
}

function retryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500
  if (err instanceof IncompleteReply) return true
  return err instanceof TypeError
}

export interface CallOptions {
  fetchImpl?: typeof fetch
  backoff?: (attempt: number) => number
  attempts?: number
}

export async function complete(config: ModelConfig, system: string, user: string, options: CallOptions = {}): Promise<Reply> {
  const apiKey = process.env[config.apiKeyEnv]
  if (!apiKey) throw new Error(`set ${config.apiKeyEnv} to the API key for ${config.name}`)
  const doFetch = options.fetchImpl ?? fetch
  const wait = options.backoff ?? ((n: number) => Math.min(30_000, 1000 * 2 ** n))
  const attempts = options.attempts ?? 6
  const base = config.endpoint.replace(/\/$/, "")
  const request =
    config.provider === "openai"
      ? {
          url: `${base}/chat/completions`,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: {
            model: config.model,
            temperature: 0,
            max_tokens: config.maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          },
          parse: parseOpenAi,
        }
      : {
          url: `${base}/v1/messages`,
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: { model: config.model, max_tokens: config.maxTokens, temperature: 0, system, messages: [{ role: "user", content: user }] },
          parse: parseAnthropic,
        }

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await doFetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) })
      const text = await res.text()
      if (!res.ok) throw new HttpError(res.status, text)
      const reply = request.parse(text)
      if (!reply.text.trim()) throw new IncompleteReply("the model sent an empty reply")
      return reply
    } catch (err) {
      lastError = err
      if (!retryable(err) || attempt === attempts - 1) break
      await new Promise((r) => setTimeout(r, wait(attempt)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** US dollars for one call, when the model has a price. */
export function cost(config: ModelConfig, usage: Usage | null): number {
  if (!config.price || !usage) return 0
  return (usage.input * config.price.input + usage.output * config.price.output) / 1_000_000
}
