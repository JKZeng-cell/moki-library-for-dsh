// The small mark lands its upright strokes on pixel centers at 16 px.
export const smallLibraryMark = {
  size: 16,
  strokeWidth: 1,
  books: [
    { x: 2.5, y: 5.5, width: 2, height: 7, rx: 0.55, band: 8.5 },
    { x: 6.5, y: 3.5, width: 2, height: 9, rx: 0.55 },
    { x: 10.5, y: 5.5, width: 2.25, height: 7.25, rx: 0.55, angle: -12 },
  ],
}

export const libraryMark = {
  size: 24,
  strokeWidth: 1.5,
  books: [
    { x: 2, y: 6.5, width: 4.25, height: 13.75, rx: 1, band: 10.75 },
    { x: 9.1, y: 3.75, width: 4.1, height: 16.5, rx: 1, band: 16.75 },
    { x: 16.25, y: 6.75, width: 3.7, height: 13.65, rx: 0.95, angle: -13 },
  ],
}

export function drawLibraryMark(mark, size = mark.size, { tile = false, snap = false } = {}) {
  const inset = tile && mark === libraryMark ? size / 16 : 0
  const scale = (size - 2 * inset) / mark.size
  const nominalStroke = mark.strokeWidth * scale
  const strokeWidth = snap ? Math.max(1, Math.round(nominalStroke)) : nominalStroke
  // Keep both edges of each upright stroke on pixel boundaries in this ICO frame.
  const position = value => {
    const center = inset + value * scale
    return snap ? Math.round(center - strokeWidth / 2) + strokeWidth / 2 : center
  }
  const bands = []
  const books = mark.books.map(book => {
    const x = position(book.x), y = position(book.y)
    const width = position(book.x + book.width) - x
    const rect = { x, y, width, height: position(book.y + book.height) - y, rx: book.rx * scale }
    if (book.angle) rect.transform = `rotate(${book.angle} ${x} ${y})`
    if (book.band !== undefined) bands.push(`M${x} ${position(book.band)}h${width}`)
    return rect
  })
  return { size, strokeWidth, books, bands: bands.join(' ') }
}
