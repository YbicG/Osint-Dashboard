import { chromium, type Browser } from 'playwright'

// Lazy singleton — report generation isn't a hot path, but relaunching a
// full Chromium process on every single report request would still be a
// wasteful ~1-2s cold start each time. One browser instance is reused
// across requests for the lifetime of the Next.js server process; each
// render gets its own page/context so concurrent report requests don't
// interfere with each other.
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true })
  }
  return browserPromise
}

/** Renders a self-contained HTML string to a PDF buffer via headless Chromium (reusing the @osint/browser package's underlying Playwright dependency — no separate PDF library needed). */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle' })
    const pdf = await page.pdf({ format: 'Letter', printBackground: true })
    return pdf
  } finally {
    await page.close()
  }
}
