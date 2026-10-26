import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in · Mailbox' }] }),
  component: Login,
})

type Step = 'idle' | 'sending' | 'code' | 'verifying'

const field =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100'
const button =
  'w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900'

function Login() {
  const [step, setStep] = useState<Step>('idle')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)

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
    setMessage(null)
    const res = await post('/api/auth/request').catch(() => null)
    if (res?.ok) {
      setStep('code')
      setMessage('Code sent. Check your inbox.')
    } else {
      setStep('idle')
      setMessage(
        res?.status === 429
          ? 'Too many requests. Wait a bit and try again.'
          : 'Could not send the code. Try again.',
      )
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setStep('verifying')
    setMessage(null)
    const res = await post('/api/auth/verify', { code }).catch(() => null)
    if (res?.ok) {
      // Full navigation so the server renders with the new session cookie.
      window.location.assign('/')
      return
    }
    setStep('code')
    setCode('')
    setMessage(
      res?.status === 429
        ? 'Too many attempts. Wait a few minutes.'
        : 'Invalid or expired code.',
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Mailbox</h1>
      {step === 'idle' || step === 'sending' ? (
        <button className={button} disabled={step === 'sending'} onClick={sendCode}>
          {step === 'sending' ? 'Sending…' : 'Send code'}
        </button>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <input
            className={field}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            aria-label="6-digit code"
            autoFocus
          />
          <button className={button} disabled={code.length !== 6 || step === 'verifying'}>
            {step === 'verifying' ? 'Checking…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="text-sm text-neutral-600 underline dark:text-neutral-400"
            onClick={sendCode}
          >
            Send a new code
          </button>
        </form>
      )}
      <p role="status" className="min-h-6 text-sm text-neutral-600 dark:text-neutral-400">
        {message}
      </p>
    </main>
  )
}
