export type LanRegistration = {
  pdfOutputDir: string
  openrouterApiKey: string
  runwareApiKey: string
  nvidiaApiKey: string
  deepseekApiKey: string
  openaiApiKey: string
  opencodeGoApiKey: string
}

export type LanPairing = { token: string; port: number; keysAvailable: boolean }

export type LanSyncState = {
  pairing: LanPairing | null
  error: boolean
}
