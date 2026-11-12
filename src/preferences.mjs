export const defaults = {language:'auto', previewMode:'auto', autoMapTaskFiles:false, composerPicker:false}

export function libraryLanguage(preference, hostLanguage) {
  const selected = preference === 'zh' || preference === 'en' ? preference : hostLanguage
  return /^zh(?:$|[-_])/i.test(String(selected || 'zh')) ? 'zh' : 'en'
}

// Observe persisted settings, rather than an optimistic choice in the dialog.
// A failed save must not change the language of other open library surfaces.
export function watchLibraryLanguage(locale, form, apply) {
  const sync = () => apply(libraryLanguage(form.getSnapshot().value?.language, locale.getSnapshot().active))
  const offLocale = locale.subscribe(sync), offSettings = form.subscribe(sync)
  sync()
  return () => {offSettings();offLocale()}
}

export function option(config, field) {
  const value = config[field]
  return (typeof value?.get === 'function' ? value.get() : value) ?? defaults[field]
}

export function previewDestination(mode, surface, explicit) {
  if (explicit === 'sidebar') return 'sidebar'
  if (['main', 'window', 'system'].includes(mode)) return mode
  return surface === 'side' ? 'sidebar' : 'window'
}
