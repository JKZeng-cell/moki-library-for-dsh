export const defaults = {previewMode:'auto', autoMapTaskFiles:false, composerPicker:false}

export function option(config, field) {
  const value = config[field]
  return (typeof value?.get === 'function' ? value.get() : value) ?? defaults[field]
}

export function previewDestination(mode, surface, explicit) {
  if (explicit === 'sidebar') return 'sidebar'
  if (['main', 'window', 'system'].includes(mode)) return mode
  return surface === 'side' ? 'sidebar' : 'window'
}
