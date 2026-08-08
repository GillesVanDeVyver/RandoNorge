// Outbound email via Resend (https://resend.com).
//
// Cloudflare itself cannot *send* email (Email Routing only receives),
// so verification mails go out through Resend's free tier (3,000
// emails/month). Configure two Worker settings:
//
//   npx wrangler secret put RESEND_API_KEY     (from the Resend dashboard)
//   EMAIL_FROM var in wrangler.jsonc or dashboard, e.g.
//     "Fjellrute <no-reply@yourdomain.no>"      (domain verified in Resend)
//
// Until RESEND_API_KEY is set, emails are not sent; the message (with the
// verification link) is logged instead, so the flow can be tested with
// `wrangler dev` / `wrangler tail` before wiring up Resend.

/**
 * Send one email through Resend.
 *
 * `replyTo` is optional and only used by the feedback endpoint
 * (worker/feedback.js): a feedback mail arrives from the no-reply sender like
 * every other message here, so without it, hitting "Reply" in the inbox
 * answers a mailbox nobody reads instead of the tester who wrote in.
 */
export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY) {
    console.log(
      `[email stub] RESEND_API_KEY not set — would send to ${to}: ` +
        `${subject}\n${text}`,
    );
    return;
  }

  // "onboarding@resend.dev" works out of the box but only delivers to the
  // Resend account owner's own address — fine for testing, replace with a
  // verified domain for real users.
  const from = env.EMAIL_FROM || 'Fjellrute <onboarding@resend.dev>';

  // Sign-up awaits this send (email verification is required), so a stalled
  // Resend request would hang the whole sign-up response indefinitely — the
  // form sits spinning and the request never completes. Bound the call so a
  // slow/unreachable provider fails fast and loudly (logged below) instead of
  // freezing sign-up. 10s is generous for a healthy Resend API.
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      // reply_to is omitted rather than sent as null/undefined: Resend
      // validates the field's shape when it is present.
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // AbortError (timeout) or a network/DNS/TLS failure reaching Resend.
    console.error(`Resend request failed: ${err?.name || 'Error'}: ${err?.message || err}`);
    throw new Error('Failed to send email');
  }

  if (!res.ok) {
    // Surface the failure in logs but don't leak provider details to the
    // client; Better Auth will report a generic error.
    console.error(`Resend error ${res.status}: ${await res.text()}`);
    throw new Error('Failed to send email');
  }
}

/** Escape a value for interpolation into HTML (text or double-quoted
 *  attribute). Auth email fields are mostly internal, but `body` carries the
 *  user's own email address, so escaping keeps any HTML-significant character
 *  in an address from breaking out of the markup.
 *
 *  Exported since 2026-08-08 because worker/feedback.js puts something far
 *  less internal into an email body — free text the user typed — and that has
 *  to go through exactly this function rather than a second copy of it. */
export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Only allow http(s) action links; anything else (e.g. a javascript: URI)
 *  collapses to '#' so a malformed/hostile URL can't become an executable
 *  link. The value is then still HTML-escaped for the attribute. */
const safeUrl = (url) => {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : '#';
  } catch {
    return '#';
  }
};

/** Simple branded wrapper shared by all auth emails. */
export function emailTemplate({ heading, body, actionUrl, actionLabel }) {
  // Plain-text part is not markup, so it uses the raw values.
  const text = `${heading}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n`;
  const url = safeUrl(actionUrl);
  const hHeading = escapeHtml(heading);
  const hBody = escapeHtml(body);
  const hLabel = escapeHtml(actionLabel);
  const hUrl = escapeHtml(url);
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#eef2f6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#16232e;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px;">Fjellrute</div>
      <h1 style="font-size:20px;margin:0 0 12px;">${hHeading}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 24px;">${hBody}</p>
      <a href="${hUrl}"
         style="display:inline-block;padding:12px 22px;background:#1f6feb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">
        ${hLabel}
      </a>
      <p style="font-size:12px;color:#6b7a88;margin:24px 0 0;">
        If the button doesn't work, copy this link into your browser:<br>
        <span style="word-break:break-all;">${hUrl}</span>
      </p>
    </div>
  </body>
</html>`;
  return { html, text };
}
