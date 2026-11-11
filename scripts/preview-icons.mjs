import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { drawLibraryMark, libraryMark, smallLibraryMark } from '../src/library-mark.js'

function renderMark(mark, windowTile = false, frameSize) {
  const { size, strokeWidth, books, bands } = drawLibraryMark(mark, frameSize, { tile: windowTile, snap: frameSize !== undefined })
  const rects = books.map(book => {
    const attributes = Object.entries(book).map(([name, value]) => `${name}="${value}"`).join(' ')
    return `    <rect ${attributes}/>`
  }).join('\n')
  // A flat backing keeps the window glyph legible on any taskbar or title bar.
  const surface = windowTile
    ? `  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#f8f5ee"/>`
    : '  <style>@media (prefers-color-scheme: dark) { :root { color: #e8e8ec; } }</style>'
  const pixels = frameSize ?? (windowTile ? 64 : 40)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${size} ${size}" color="#302f38">
  <title>MOKI资料库</title>
${surface}
  <g fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
${rects}
    <path d="${bands}"/>
  </g>
</svg>
`
}

export async function buildPreviewIcons(root) {
  const windowIcon = renderMark(libraryMark, true)
  const sizes = [16, 20, 24, 28, 30, 32, 36, 40, 42, 48, 56, 60, 64, 72, 80, 96, 128, 256]
  const frames = await Promise.all(sizes.map(size => {
    const svg = renderMark(size <= 24 ? smallLibraryMark : libraryMark, true, size)
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
  }))

  // Each ICO directory entry points to a native-size PNG. Zero denotes 256px.
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  for (const [i, frame] of frames.entries()) {
    const entry = 6 + i * 16
    header[entry] = header[entry + 1] = sizes[i] % 256
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  }
  await Promise.all([
    writeFile(join(root, 'icon.svg'), renderMark(libraryMark)),
    writeFile(join(root, 'web/preview-icon.svg'), windowIcon),
    writeFile(join(root, 'web/preview-icon.ico'), Buffer.concat([header, ...frames])),
  ])
}
