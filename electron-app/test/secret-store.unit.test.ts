import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createSecretStore, type SecretCipher } from '../electron/main/secretStore'

// Reversible stand-in for safeStorage: enough to prove nothing is written in plaintext.
function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
    decrypt: (cipher) => {
      const s = cipher.toString()
      if (!s.startsWith('enc:')) throw new Error('bad cipher')
      return [...s.slice(4)].reverse().join('')
    },
  }
}

describe('secret store', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'voidcast-secrets-'))
    file = path.join(dir, 'secrets.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('round-trips secrets without writing them in plaintext', () => {
    const store = createSecretStore(file, fakeCipher())
    expect(store.setAll({ openrouterApiKey: 'sk-or-123', openaiApiKey: '' })).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('sk-or-123')
    expect(store.getAll()).toEqual({ openrouterApiKey: 'sk-or-123' })
  })

  test('setAll replaces the whole set', () => {
    const store = createSecretStore(file, fakeCipher())
    store.setAll({ openrouterApiKey: 'a', deepseekApiKey: 'b' })
    store.setAll({ deepseekApiKey: 'c' })
    expect(store.getAll()).toEqual({ deepseekApiKey: 'c' })
  })

  test('refuses to read or write when the OS has no key store', () => {
    const store = createSecretStore(file, fakeCipher(false))
    expect(store.available()).toBe(false)
    expect(store.setAll({ openrouterApiKey: 'x' })).toBe(false)
    expect(store.getAll()).toEqual({})
  })

  test('drops a secret that no longer decrypts and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createSecretStore(file, fakeCipher())
    store.setAll({ openrouterApiKey: 'good' })
    const body = JSON.parse(readFileSync(file, 'utf8'))
    body.secrets.runwareApiKey = Buffer.from('garbage').toString('base64')
    writeFileSync(file, JSON.stringify(body))
    expect(store.getAll()).toEqual({ openrouterApiKey: 'good' })
    warn.mockRestore()
  })

  test('a missing or corrupt file reads as empty', () => {
    const store = createSecretStore(file, fakeCipher())
    expect(store.getAll()).toEqual({})
    writeFileSync(file, '{not json')
    expect(store.getAll()).toEqual({})
  })
})
