import { describe, expect, test } from 'vitest'
import { parseKeyChord } from '../electron/main/browser/keys'

describe('parseKeyChord', () => {
  test('digit row and letters get the real physical code', () => {
    expect(parseKeyChord('1')).toEqual({
      spec: { key: '1', code: 'Digit1', vk: 49, text: '1' },
      modifiers: 0,
    })
    expect(parseKeyChord('a')).toEqual({
      spec: { key: 'a', code: 'KeyA', vk: 65, text: 'a' },
      modifiers: 0,
    })
  })

  test('physical codes are accepted verbatim', () => {
    expect(parseKeyChord('Digit1').spec).toEqual({ key: '1', code: 'Digit1', vk: 49, text: '1' })
    expect(parseKeyChord('KeyA').spec).toEqual({ key: 'a', code: 'KeyA', vk: 65, text: 'a' })
    expect(parseKeyChord('Numpad1').spec).toEqual({ key: '1', code: 'Numpad1', vk: 97, text: '1' })
    expect(parseKeyChord('F5').spec).toEqual({ key: 'F5', code: 'F5', vk: 116 })
  })

  test('shifted characters keep the unshifted code and set the shift bit', () => {
    expect(parseKeyChord('!').spec).toEqual({
      key: '!',
      code: 'Digit1',
      vk: 49,
      text: '!',
      modifierBit: 8,
    })
    expect(parseKeyChord('+').spec).toEqual({
      key: '+',
      code: 'Equal',
      vk: 187,
      text: '+',
      modifierBit: 8,
    })
    expect(parseKeyChord('?').spec).toEqual({
      key: '?',
      code: 'Slash',
      vk: 191,
      text: '?',
      modifierBit: 8,
    })
    expect(parseKeyChord('{').spec).toEqual({
      key: '{',
      code: 'BracketLeft',
      vk: 219,
      text: '{',
      modifierBit: 8,
    })
  })

  test('uppercase letters set the shift bit without a chord', () => {
    const parsed = parseKeyChord('A')
    expect(parsed.spec.key).toBe('A')
    expect(parsed.spec.code).toBe('KeyA')
    expect(parsed.spec.modifierBit).toBe(8)
    expect(parsed.modifiers).toBe(0)
  })

  test('named keys carry their text (or none at all)', () => {
    expect(parseKeyChord('Enter').spec).toEqual({
      key: 'Enter',
      code: 'Enter',
      vk: 13,
      text: '\r',
    })
    expect(parseKeyChord('Space').spec).toEqual({ key: ' ', code: 'Space', vk: 32, text: ' ' })
    expect(parseKeyChord('ArrowUp').spec).toEqual({ key: 'ArrowUp', code: 'ArrowUp', vk: 38 })
    // Tab must not carry text: a real Tab moves focus instead of inserting a character.
    expect(parseKeyChord('Tab').spec.text).toBeUndefined()
  })

  test('chords set the CDP modifier bits', () => {
    const ctrlA = parseKeyChord('Control+A')
    expect(ctrlA.modifiers).toBe(2)
    expect(ctrlA.spec.code).toBe('KeyA')
    expect(parseKeyChord('Shift+ArrowUp').modifiers).toBe(8)
    expect(parseKeyChord('Control+Shift+F5').modifiers).toBe(10)
  })

  test('unknown keys and modifiers throw a usable message', () => {
    expect(() => parseKeyChord('NoSuchKey')).toThrow(/Unknown key/)
    expect(() => parseKeyChord('Hyper+A')).toThrow(/Unknown modifier/)
  })
})
