import { resolveServerUrl } from './serverUrl'

export const SERVER_URL = resolveServerUrl(window.location, import.meta.env)

export function inviteUrl(code: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', code)
  return url.toString()
}
