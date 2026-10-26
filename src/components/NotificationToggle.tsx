import { useEffect, useState } from 'react'
import { BellIcon } from '#/components/icons'
import { keyToBytes, pushSupported, subscribedWith } from '#/lib/push'
import {
  pushConfigFn,
  subscribePushFn,
  testPushFn,
  unsubscribePushFn,
} from '#/server/push.fn'

type State =
  | 'checking'
  | 'unsupported' // browser without Push
  | 'unconfigured' // server has no VAPID keys
  | 'denied' // blocked in browser settings
  | 'off'
  | 'on'

async function registration() {
  return navigator.serviceWorker.ready
}

/** The browser's push service can stall (e.g. no connection to it); don't leave the button hanging. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ])
}

function toTarget(sub: PushSubscription) {
  const json = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  }
}

export function NotificationToggle() {
  const [state, setState] = useState<State>('checking')
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const life = { cancelled: false }
    const stale = () => life.cancelled
    async function check() {
      if (!pushSupported()) return setState('unsupported')
      const { publicKey: key } = await pushConfigFn()
      if (stale()) return
      setPublicKey(key)
      if (!key) return setState('unconfigured')
      if (Notification.permission === 'denied') return setState('denied')
      const sub = await (await registration()).pushManager.getSubscription()
      if (stale()) return
      if (!sub || Notification.permission !== 'granted') return setState('off')
      if (!subscribedWith(sub, key)) {
        // Made for an older key pair: unusable, start over.
        await sub.unsubscribe()
        return setState('off')
      }
      // Idempotent: repairs the server's copy if it was lost or the browser rotated its keys.
      await subscribePushFn({ data: toTarget(sub) })
      if (!stale()) setState('on')
    }
    check().catch(() => {
      if (!stale()) setState('off')
    })
    return () => {
      life.cancelled = true
    }
  }, [])

  async function enable() {
    if (!publicKey) return
    setBusy(true)
    setNote(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        if (permission !== 'denied') setNote('Permission was not granted.')
        return
      }
      const reg = await registration()
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyToBytes(publicKey),
          }),
          20_000,
        ))
      const res = await subscribePushFn({ data: toTarget(sub) })
      if (!res.ok) throw new Error('rejected')
      setState('on')
    } catch {
      setNote('Could not turn on notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setNote(null)
    try {
      const sub = await (await registration()).pushManager.getSubscription()
      if (sub) {
        await unsubscribePushFn({ data: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      setState('off')
    } catch {
      setNote('Could not turn off notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setNote(null)
    try {
      const { sent } = await testPushFn()
      setNote(sent > 0 ? 'Test sent.' : 'Nothing was delivered.')
    } catch {
      setNote('Test failed.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking') return null

  if (state === 'unsupported' || state === 'unconfigured') {
    return (
      <p className="text-faint px-1 text-xs">
        {state === 'unsupported'
          ? 'Notifications are not supported in this browser.'
          : 'Notifications are not set up on the server.'}
      </p>
    )
  }

  if (state === 'denied') {
    return (
      <p className="text-faint px-1 text-xs">
        Notifications are blocked. Allow them for this site in the browser's
        site settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {state === 'on' ? (
        <>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void disable()}
          >
            <BellIcon /> Notifications on
          </button>
          <button
            className="text-faint hover:text-fg self-start px-1 text-xs underline"
            disabled={busy}
            onClick={() => void test()}
          >
            Send a test
          </button>
        </>
      ) : (
        <button className="btn" disabled={busy} onClick={() => void enable()}>
          <BellIcon /> {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}
      {note ? (
        <p role="status" className="text-dim px-1 text-xs">
          {note}
        </p>
      ) : null}
    </div>
  )
}
