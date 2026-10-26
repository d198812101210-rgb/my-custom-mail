import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { MailIcon } from '#/components/icons'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in · Mailbox' }] }),
  component: Login,
})

type Step = 'idle' | 'sending' | 'code' | 'verifying'
type Notice = { tone: 'info' | 'error'; text: string } | null

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  )
}

function Login() {
  const [step, setStep] = useState<Step>('idle')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<Notice>(null)

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, ok: res.ok }
  }

  async function sendCode() {
    setStep('sending')
    setNotice(null)
    const res = await post('/api/auth/request').catch(() => null)
    if (res?.ok) {
      setStep('code')
      setNotice({ tone: 'info', text: 'Code sent. Check your inbox.' })
      return
    }
    setStep('idle')
    const text =
      res?.status === 429
        ? 'Too many requests. Wait a minute and try again.'
        : res?.status === 403
          ? 'Blocked: open this app at its configured address (APP_URL).'
          : 'Could not send the code. Try again.'
    setNotice({ tone: 'error', text })
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setStep('verifying')
    setNotice(null)
    const res = await post('/api/auth/verify', { code }).catch(() => null)
    if (res?.ok) {
      // Full navigation so the server renders with the new session cookie.
      window.location.assign('/')
      return
    }
    setStep('code')
    setCode('')
    setNotice({
      tone: 'error',
      text:
        res?.status === 429
          ? 'Too many attempts. Wait a few minutes.'
          : 'Invalid or expired code.',
    })
  }

  const busy = step === 'sending' || step === 'verifying'

  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* Decorative backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="grid-bg absolute inset-0" />
        <div className="animate-drift absolute -top-32 -left-24 size-[28rem] rounded-full bg-neon-red/30 blur-[110px]" />
        <div className="animate-drift-slow absolute -right-20 bottom-[-8rem] size-[32rem] rounded-full bg-neon-purple/30 blur-[120px]" />
        <div className="animate-drift absolute top-1/3 left-1/2 size-72 -translate-x-1/2 rounded-full bg-neon-violet/20 blur-[100px]" />
      </div>

      <div className="w-full max-w-sm">
        <section className="glass glow rounded-3xl p-8">
          <div className="bg-neon glow mx-auto grid size-16 place-items-center rounded-2xl text-white">
            <MailIcon width={30} height={30} strokeWidth={1.8} />
          </div>

          <h1 className="text-neon mt-6 text-center text-3xl font-semibold tracking-tight">
            Mailbox
          </h1>
          <p className="text-dim mt-2 text-center text-sm">
            {step === 'code' || step === 'verifying'
              ? 'Enter the 6-digit code we emailed you.'
              : 'Your private inbox for tanakadev.digital.'}
          </p>

          <div className="mt-8">
            {step === 'idle' || step === 'sending' ? (
              <button
                className="btn btn-primary w-full py-3 text-base"
                disabled={busy}
                onClick={() => void sendCode()}
              >
                {step === 'sending' ? (
                  <>
                    <Spinner /> Sending…
                  </>
                ) : (
                  'Send code'
                )}
              </button>
            ) : (
              <form
                onSubmit={(e) => void verify(e)}
                className="flex flex-col gap-4"
              >
                <input
                  className="field py-4 text-center font-mono text-3xl tracking-[0.5em] indent-[0.5em]"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="······"
                  aria-label="6-digit code"
                  autoFocus
                />
                <button
                  className="btn btn-primary w-full py-3 text-base"
                  disabled={code.length !== 6 || busy}
                >
                  {step === 'verifying' ? (
                    <>
                      <Spinner /> Checking…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
                <button
                  type="button"
                  className="text-dim hover:text-fg text-sm underline-offset-4 transition hover:underline"
                  disabled={busy}
                  onClick={() => void sendCode()}
                >
                  Send a new code
                </button>
              </form>
            )}
          </div>

          <p
            role={notice?.tone === 'error' ? 'alert' : 'status'}
            className={`mt-5 min-h-5 text-center text-sm ${
              notice?.tone === 'error' ? 'text-[#ff8da0]' : 'text-dim'
            }`}
          >
            {notice?.text}
          </p>
        </section>

        <p className="text-faint mt-6 text-center text-xs">
          One-time codes expire after 10 minutes.
        </p>
      </div>
    </main>
  )
}
