import type { Page } from 'playwright'

export interface CaptchaChallenge {
  kind: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'cloudflare_turnstile' | 'unknown'
  pageUrl: string
  siteKey: string | null
}

export interface CaptchaSolveResult {
  solved: boolean
  /** Token to inject (e.g. g-recaptcha-response) — present only when solved by an automated provider. */
  token: string | null
}

/**
 * Every source that throws a CAPTCHA or bot-wall goes through this
 * interface. Per the platform's default posture, the run is skipped and
 * flagged as a coverage gap (see the `skip` implementation below) rather
 * than fought — but the interface is deliberately provider-shaped so a
 * human-solving service can be wired in later without touching connector
 * code, if the operator decides to pay for one.
 */
export interface CaptchaSolver {
  readonly id: string
  solve(page: Page, challenge: CaptchaChallenge): Promise<CaptchaSolveResult>
}

/**
 * Default solver: does not attempt to solve anything. The collection run is
 * marked `skipped_captcha` with a deep link to the blocking page so the
 * operator can go solve it by hand in a real browser if they want that
 * source's data for this subject.
 */
export class SkipAndFlagSolver implements CaptchaSolver {
  readonly id = 'skip_and_flag'
  async solve(_page: Page, _challenge: CaptchaChallenge): Promise<CaptchaSolveResult> {
    return { solved: false, token: null }
  }
}

/**
 * Human-in-the-loop solver: pauses the job, surfaces a live view of `page`
 * in the admin console (wired in apps/web — see the SSE `captcha_pending`
 * event), waits for the operator to solve it themselves in that view, then
 * resumes. No automation of the challenge itself.
 */
export class ManualSolver implements CaptchaSolver {
  readonly id = 'manual'
  constructor(private readonly onChallenge: (challenge: CaptchaChallenge, page: Page) => Promise<CaptchaSolveResult>) {}

  async solve(page: Page, challenge: CaptchaChallenge): Promise<CaptchaSolveResult> {
    return this.onChallenge(challenge, page)
  }
}

/**
 * Documented, unwired slot for a third-party human-solving service
 * (2Captcha, CapSolver, Anti-Captcha, ...). Implement `submit`/`poll`
 * against your chosen provider's API and register an instance of this class
 * where connectors resolve their CaptchaSolver — nothing else in the
 * codebase needs to change. Deliberately left unimplemented: wiring a real
 * provider means the operator supplying their own account and API key.
 */
export abstract class ThirdPartyCaptchaSolver implements CaptchaSolver {
  abstract readonly id: string
  constructor(protected readonly apiKey: string) {}
  abstract solve(page: Page, challenge: CaptchaChallenge): Promise<CaptchaSolveResult>
}

export function resolveCaptchaSolver(): CaptchaSolver {
  const provider = process.env.CAPTCHA_SOLVER_PROVIDER
  if (!provider || provider === 'skip') return new SkipAndFlagSolver()
  // A configured CAPTCHA_SOLVER_PROVIDER with no matching implementation
  // falls back to skip-and-flag rather than throwing — a misconfigured env
  // var should degrade a source to "coverage gap", not crash the worker.
  return new SkipAndFlagSolver()
}
