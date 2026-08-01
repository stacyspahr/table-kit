/**
 * The kit's React surface — `table-kit/react`.
 *
 * Deliberately a SEPARATE entry point. Everything under `table-kit` proper is
 * framework-free and stays that way: seats, sync, the offline queue and the
 * awards engine have no business knowing what renders them, and a future
 * consumer that isn't a React app must still be able to import the core
 * without pulling React in behind it.
 *
 * `react` and `qrcode` are optional peers for the same reason. Import this
 * module and you need both; import the core and you need neither.
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { joinUrl, keepAwake } from './session.js'

/**
 * The full-screen join QR.
 *
 * Reachable at ANY point during a game, not just at creation — latecomers are
 * normal, and phones die mid-game. Any joined player can show it, not only the
 * host: the token isn't secret from people already at the table, and routing
 * every stranded player through the host makes the host a bottleneck mid-hand.
 *
 * Players scan with their phone's own camera app straight off the lock screen.
 * There is deliberately no in-app scanner — that would require already having
 * the app open, which is the thing we're avoiding.
 *
 * Every class it renders is the kit's own, so it arrives already wearing
 * whichever game imported it. See the `.qr-*` block in styles.css.
 */
export function QrPanel({
  token,
  gameName,
  onClose,
}: {
  token: string
  /** The game's human name. Used in the share sheet: "Join the … game". */
  gameName: string
  onClose: () => void
}) {
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState(false)
  const url = joinUrl(token)

  useEffect(() => {
    QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      // Four modules of white, which is what the QR spec asks for. It used to
      // be one — enough that most phones coped, and exactly the thing that
      // stops coping at an angle, in bad light, across a table. The card
      // behind it is the app's own light surface rather than pure white, so
      // this border is the whole quiet zone; it does not get to borrow the
      // surface underneath.
      margin: 4,
      // Plain black on white regardless of theme — a tinted QR is a QR that
      // some phone in the room fails to read.
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [url])

  // A phone that sleeps between latecomers means waking and re-opening this for
  // every single arrival.
  useEffect(() => {
    const awake = keepAwake()
    return () => awake.stop()
  }, [])

  // Some phone will fail to scan — glare, a cracked lens, an ancient Android.
  // The share sheet sends the raw link instead. Not a typed code; just the link.
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Join the ${gameName} game`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="qr-screen">
      <div className="qr-card">
        <h2>Scan to join</h2>
        <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="qr-help">Point your phone's camera at this — no app needed.</p>
      </div>
      <div className="qr-actions">
        <button className="btn ghost" onClick={share}>
          {copied ? 'Link copied' : 'Send the link instead'}
        </button>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
