import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** The OS-backed cipher (Electron safeStorage in the app, a fake in tests). */
export interface SecretCipher {
  isAvailable: () => boolean
  encrypt: (plain: string) => Buffer
  decrypt: (cipher: Buffer) => string
}

export interface SecretStore {
  /** False when the OS offers no real key store — callers keep their old storage then. */
  available: () => boolean
  /** Every secret that could be decrypted; ones that fail (moved profile, new OS user) are dropped. */
  getAll: () => Record<string, string>
  /** Replaces the whole set. Empty values are not stored. Returns false if nothing was written. */
  setAll: (secrets: Record<string, string>) => boolean
}

interface SecretFile {
  version: 1
  secrets: Record<string, string>
}

export function createSecretStore(filePath: string, cipher: SecretCipher): SecretStore {
  const available = () => {
    try {
      return cipher.isAvailable()
    } catch {
      return false
    }
  }

  const readFile = (): SecretFile | null => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<SecretFile>
      if (parsed?.version !== 1 || !parsed.secrets || typeof parsed.secrets !== 'object') {
        return null
      }
      return { version: 1, secrets: parsed.secrets }
    } catch {
      return null
    }
  }

  return {
    available,
    getAll() {
      if (!available()) return {}
      const file = readFile()
      if (!file) return {}
      const out: Record<string, string> = {}
      for (const [name, encoded] of Object.entries(file.secrets)) {
        if (typeof encoded !== 'string') continue
        try {
          out[name] = cipher.decrypt(Buffer.from(encoded, 'base64'))
        } catch {
          console.warn(`[secrets] could not decrypt "${name}"; it has to be entered again`)
        }
      }
      return out
    },
    setAll(secrets) {
      if (!available()) return false
      const encrypted: Record<string, string> = {}
      for (const [name, value] of Object.entries(secrets)) {
        if (typeof value !== 'string' || !value) continue
        encrypted[name] = cipher.encrypt(value).toString('base64')
      }
      const body: SecretFile = { version: 1, secrets: encrypted }
      try {
        mkdirSync(path.dirname(filePath), { recursive: true })
        // Write-then-rename so a crash mid-write never leaves a half file that loses every key.
        const tmp = `${filePath}.tmp`
        writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
        renameSync(tmp, filePath)
        return true
      } catch (err) {
        console.warn('[secrets] write failed:', err)
        return false
      }
    },
  }
}
