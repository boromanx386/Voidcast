import { normalizeBaseUrl } from '@/lib/settings'

export type WeatherResult = { ok: boolean; text: string }

async function invokeGetWeatherIpc(
  city: string,
  forecast: boolean,
): Promise<string> {
  const vc = window.voidcast
  if (!vc?.getWeather) {
    throw new Error(
      'Run Voidcast in Electron for get_weather without the TTS server tool.',
    )
  }
  const r: unknown = await vc.getWeather({ city, forecast })
  if (typeof r === 'string') return r
  const obj = r as WeatherResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.ok === false ? `Weather failed: ${obj.text}` : obj.text
  }
  return String(r)
}

/**
 * Prefer `POST /tools/weather` on the TTS server, then Electron main → wttr.in `format=j1`.
 */
export async function invokeGetWeather(
  city: string,
  forecast: boolean,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')
  try {
    const res = await fetch(`${root}/tools/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, forecast }),
      signal,
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      text?: string
      detail?: string
    }
    if (res.ok && data.ok && typeof data.text === 'string' && data.text.length > 0) {
      return data.text
    }
  } catch {
    /* TTS off or unreachable */
  }

  try {
    return await invokeGetWeatherIpc(city, forecast)
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}
