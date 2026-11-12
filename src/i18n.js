import english from './locales/en.json' with {type: 'json'}

// Translate interface messages only. Never pass filenames, paths, tags or
// document bodies through this function; interpolation values stay untouched.
const normalize = value => /^zh(?:$|[-_])/i.test(String(value || 'zh')) ? 'zh' : 'en'
let locale = normalize(typeof location === 'object' ? new URLSearchParams(location.search).get('locale') || document.documentElement.lang || 'zh' : 'zh')
const listeners = new Set()
export const getLocale = () => locale
export const intlLocale = () => locale === 'zh' ? 'zh-CN' : 'en-US'
export const subscribeLocale = listener => {listeners.add(listener);return () => listeners.delete(listener)}
export function setLocale(value) {
  const next = normalize(value)
  if (locale === next) return
  locale = next
  for (const listener of listeners) listener()
}
export const useLibraryLocale = React => React.useSyncExternalStore(subscribeLocale, getLocale, getLocale)
export function l(message, ...values) {
  const template = Array.isArray(message) ? message.reduce((text, part, i) => text + (i ? `{${i - 1}}` : '') + part, '') : message
  const key = template.trim().replace(/\s*\r?\n\s*/g, ' ')
  const translated = locale === 'en' && Object.hasOwn(english, key)
    ? template.match(/^\s*/)[0] + english[key] + template.match(/\s*$/)[0] : template
  // A function replacement keeps dollar signs and other user text literal.
  return translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match)
}
