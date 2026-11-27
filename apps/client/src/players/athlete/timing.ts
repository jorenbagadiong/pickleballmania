/** Times a step as a performance measure (`pb:…`), readable by the debug hook and tests. */
export async function timed<T>(name: string, p: Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await p
  } finally {
    performance.measure(name, { start, end: performance.now() })
  }
}
