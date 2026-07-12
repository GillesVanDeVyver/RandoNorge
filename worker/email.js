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

export async function sendEmail(env, { to, subject, html, text }) {
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    // Surface the failure in logs but don't leak provider details to the
    // client; Better Auth will report a generic error.
    console.error(`Resend error ${res.status}: ${await res.text()}`);
    throw new Error('Failed to send email');
  }
}

/** Simple branded wrapper shared by all auth emails. */
export function emailTemplate({ heading, body, actionUrl, actionLabel }) {
  const text = `${heading}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n`;
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#eef2f6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#16232e;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px;">Fjellrute</div>
      <h1 style="font-size:20px;margin:0 0 12px;">${heading}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 24px;">${body}</p>
      <a href="${actionUrl}"
         style="display:inline-block;padding:12px 22px;background:#1f6feb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">
        ${actionLabel}
      </a>
      <p style="font-size:12px;color:#6b7a88;margin:24px 0 0;">
        If the button doesn't work, copy this link into your browser:<br>
        <span style="word-break:break-all;">${actionUrl}</span>
      </p>
    </div>
  </body>
</html>`;
  return { html, text };
}
