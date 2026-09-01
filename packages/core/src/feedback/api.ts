// Client for the in-app feedback endpoint (worker/feedback.js).
//
// WHY THIS IS IN CORE RATHER THAN IN apps/web. It began as
// apps/web/src/feedback/api.ts, written inside a browser, where
// `fetch('/api/feedback')` resolves against the page's origin and the Better
// Auth session cookie is attached without being asked. Neither holds on a
// phone, and the account overview on both clients ends with the same card
// opening the same form — so the choice was a second copy of this file under
// apps/mobile or one client here. The plan in docs/mobile-web-parity-plan.md
// is unambiguous about which ("nothing non-visual gets written inside
// apps/mobile … a 'temporary' copy of a formatter or a fetch call" is named as
// the fastest way to lose the split), and scripts/verify-mobile-app.mjs
// section 4 fails any `/api/` literal written inside the app, which is that
// rule with teeth.
//
// Nothing about the web's behaviour changes by moving it: the adapters in
// ../net/base.ts default to path-only URLs and no extra headers, which is
// exactly what this file emitted before. Only the import path in
// apps/web/src/components/FeedbackDialog.tsx moved.

import { translate } from '../i18n/locale.ts';
import { apiUrl, authHeaders, usesCookieCredentials } from '../net/base.ts';

/** Must match MAX_MESSAGE_LENGTH in worker/feedback.js. Kept here so the form
 *  can count down to the same number the server enforces — a limit the user
 *  only discovers by hitting it is a bug, not a limit. */
export const MAX_FEEDBACK_LENGTH = 4000;

export interface FeedbackResult {
  /**
   * Whether the message was also emailed on. False means it is stored and
   * safe but the mail provider refused it (worker/feedback.js logs the
   * reason). Not an error the user needs to act on — their message arrived —
   * so the form still shows the success state.
   */
  delivered: boolean;
}

/**
 * Send one feedback message.
 *
 * `replyTo` is optional: pass the address the user typed, or omit/empty it to
 * let the server use the account's own address for the mail header.
 *
 * Throws with the server's message on failure (validation, rate limit, a
 * dead connection) so the dialog can show it and keep the typed text.
 */
export async function sendFeedback(
  message: string,
  replyTo?: string,
): Promise<FeedbackResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/feedback'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ message, replyTo: replyTo ?? '' }),
      // See the same line in routes/api.ts: only named once a Cookie header is
      // being set by hand, so the web keeps fetch's default ('same-origin',
      // which sends our session cookie) untouched.
      ...(usesCookieCredentials() ? {} : { credentials: 'omit' as const }),
    });
  } catch {
    // Offline or the request never left the device. Worth its own message:
    // this app is used in the mountains, and "check your connection" is
    // actionable where "something went wrong" is not.
    throw new Error(
      translate(
        'Ingen nettforbindelse. Meldingen ble ikke sendt — prøv igjen når du er på nett.',
        'No connection. Your message was not sent — try again when you are online.',
      ),
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    delivered?: boolean;
    error?: string;
  };

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        translate(
          'Du har sendt flere meldinger på kort tid. Prøv igjen om en stund.',
          'You have sent several messages in a short time. Please try again in a while.',
        ),
      );
    }
    throw new Error(
      data.error ||
        translate(
          `Kunne ikke sende meldingen (${res.status})`,
          `Could not send your message (${res.status})`,
        ),
    );
  }

  return { delivered: data.delivered !== false };
}
