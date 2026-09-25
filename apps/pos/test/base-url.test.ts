import { describe, expect, it } from 'vitest'
import { normalizeBaseUrl } from '../src/sync/base-url'

describe('dayo base URL (security review: the Bearer key only goes to https or this machine)', () => {
  it.each([
    ['https://dayo.example.com/api/v1', 'https://dayo.example.com/api/v1'],
    ['https://dayo.example.com/api/v1///', 'https://dayo.example.com/api/v1'],
    ['  https://DAYO.example.com/api/v1/ ', 'https://dayo.example.com/api/v1'],
    ['http://localhost:8787/api/v1/', 'http://localhost:8787/api/v1'],
    ['http://127.0.0.1:4010/api/v1', 'http://127.0.0.1:4010/api/v1'],
    ['http://localhost/api/v1', 'http://localhost/api/v1'],
  ])('accepts %s → %s', (raw, want) => {
    expect(normalizeBaseUrl(raw)).toBe(want)
  })
  it.each([
    'http://evil.example.com/api/v1',
    'http://localhost.evil.com/api/v1',
    'http://127.0.0.1.nip.io/api/v1',
    'http://192.168.1.10/api/v1',
    'ftp://dayo.example.com/api/v1',
    'javascript:alert(1)',
    'dayo.example.com/api/v1',
    '',
    'https://user:pass@dayo.example.com/api/v1',
    'https://dayo.example.com/api/v1?x=1',
    'https://dayo.example.com/api/v1#frag',
  ])('refuses %s', (raw) => {
    expect(() => normalizeBaseUrl(raw)).toThrow(/^BAD_BASE_URL/)
  })
})
