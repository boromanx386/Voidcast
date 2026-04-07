export type WeatherResult = { ok: boolean; text: string }

async function invokeGetWeatherIpc(
  city: string,
  forecast: boolean,
): Promise<string> {
  const vc = window.voidcast
  if (!vc?.getWeather) {
    throw new Error(
      'Run Voidcast in Electron for get_weather (wttr.in is fetched from the desktop app).',
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
 * Current conditions (and optional short forecast) via Electron main → wttr.in `format=j1`.
 * (IPC invoke is not aborted mid-flight; `signal` reserved for future use.)
 */
export async function invokeGetWeather(
  city: string,
  forecast: boolean,
  _signal?: AbortSignal,
): Promise<string> {
  void _signal
  return invokeGetWeatherIpc(city, forecast)
}
