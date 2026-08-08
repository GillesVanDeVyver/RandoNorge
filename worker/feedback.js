// In-app feedback from signed-in users.
//
//   POST /api/feedback  { message, replyTo? } → { ok: true, delivered: bool }
//
// Replaces the mailto: link the account overview used to carry. The user types
// in the app (src/components/FeedbackDialog.tsx), this stores the message in
// D1 (migration 0008) and then emails it to FEEDBACK_TO through Resend.
//
// ORDER MATTERS: store first, send second. The store is ours and cheap; the
// send crosses a third-party API that can be down, throttled, or simply not
// configured yet (worker/email.js logs instead of sending when
// RESEND_API_KEY is unset). Doing it the other way round means a Resend
// outage silently discards a bug report someone took ten minutes to write.
// So a failed send is not a failed request: the message is safe, the response
// says so with `delivered: false`, and the row keeps "delivered" = 0 so the
// backlog can be found with one query:
//
//   npx wrangler d1 execute fjellrute-db-eu --remote \
//     --command 'select * from "feedback" where "delivered" = 0'
//
// The reply address is the user's to choose. The form prefills their account
// email; if they clear it, we fall back to the session's address for the mail
// header but store null (see migration 0008 on why the address is not copied
// into the row).

import { getAuth } from './auth.js';
import { sendEmail, escapeHtml } from './email.js';
import { rateLimit, clientIp } from './rateLimit.js';

/** Where feedback lands when FEEDBACK_TO is not set in wrangler.jsonc. The
 *  same address the privacy policy publishes for GDPR requests, so replies
 *  come from somewhere the user has already been told about. */
const DEFAULT_FEEDBACK_TO = 'contact@fjellrute.no';

/** Upper bound on a stored message. Long enough for a detailed bug report
 *  with steps to reproduce, short enough that the endpoint cannot be used to
 *  push arbitrary bulk data into the database. The form counts down to the
 *  same number so this limit is never a surprise. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Reply addresses are only ever put in a mail header, never used to
 *  authenticate anything, so this checks for a plausible single address and
 *  nothing more — no attempt at RFC 5322. What it must catch is anything
 *  containing a newline or a comma, which is how a header gets a second
 *  recipient or a second header injected into it. */
const REPLY_TO_PATTERN = /^[^\s@,;:<>"()[\]\\]+@[^\s@,;:<>"()[\]\\]+\.[^\s@,;:<>"()[\]\\]{2,}$/;

/** Feedback is a deliberate, occasional act. Five an hour per IP leaves room
 *  for a tester filing several bugs in one session while making the endpoint
 *  useless as a way to pump mail through our Resend quota or rows into D1. */
const MAX_PER_HOUR = 5;

export async function handleFeedbackApi(request, env, url) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  const session = await getAuth(env, url.origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const { id: userId, email: accountEmail, name } = session.user;

  try {
    const { allowed, resetAt } = await rateLimit(
      env,
      `feedback:${clientIp(request)}`,
      MAX_PER_HOUR,
      3600,
    );
    if (!allowed) {
      return Response.json(
        { error: 'too many messages, try again later' },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
            ),
          },
        },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const message =
      typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return Response.json({ error: 'message required' }, { status: 422 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
        { status: 422 },
      );
    }

    // Empty / whitespace-only means "no address given", which is allowed:
    // the account address is used for the header instead.
    const typedReplyTo =
      typeof body.replyTo === 'string' ? body.replyTo.trim() : '';
    if (typedReplyTo && !REPLY_TO_PATTERN.test(typedReplyTo)) {
      return Response.json(
        { error: 'that reply address does not look like an email address' },
        { status: 422 },
      );
    }
    const replyTo = typedReplyTo || null;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      'insert into "feedback" ("id", "userId", "message", "replyTo", ' +
        '"delivered", "createdAt") values (?1, ?2, ?3, ?4, 0, ?5)',
    )
      .bind(id, userId, message, replyTo, createdAt)
      .run();

    const delivered = await deliver(env, {
      id,
      message,
      createdAt,
      replyTo: replyTo || accountEmail,
      accountEmail,
      name,
    });

    if (delivered) {
      // Best-effort bookkeeping: the message is already both stored and sent,
      // so a failed flag update must not turn a successful submission into an
      // error for the user. Worst case the row looks undelivered and gets a
      // second look by hand.
      try {
        await env.DB.prepare(
          'update "feedback" set "delivered" = 1 where "id" = ?1',
        )
          .bind(id)
          .run();
      } catch (err) {
        console.error(`feedback ${id} sent but flag update failed:`, err);
      }
    }

    return Response.json({ ok: true, delivered });
  } catch (err) {
    console.error('feedback api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

/**
 * Email one stored message out. Returns whether Resend accepted it; never
 * throws, because the caller has already committed the message to D1 and the
 * user's request succeeds either way.
 */
async function deliver(env, { id, message, createdAt, replyTo, accountEmail, name }) {
  const to = env.FEEDBACK_TO || DEFAULT_FEEDBACK_TO;
  // First line of the message, trimmed, as the subject — the inbox becomes
  // scannable instead of forty identical "Fjellrute feedback" rows.
  const summary = message.split('\n')[0].slice(0, 60).trim();
  const subject = summary
    ? `Fjellrute feedback: ${summary}`
    : 'Fjellrute feedback';

  const from = name ? `${name} <${accountEmail}>` : accountEmail;
  const text =
    `${message}\n\n` +
    `---\nFrom: ${from}\nReply to: ${replyTo}\n` +
    `Sent: ${createdAt}\nFeedback id: ${id}\n`;

  // The message is free text the user typed, so it is escaped before it goes
  // anywhere near markup, and rendered in a <pre> so their line breaks and
  // indentation survive without any of it being interpreted.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#eef2f6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#16232e;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px;">Fjellrute feedback</div>
      <pre style="font-family:inherit;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0 0 24px;">${escapeHtml(message)}</pre>
      <p style="font-size:12px;color:#6b7a88;margin:0;border-top:1px solid #e3e9ef;padding-top:16px;">
        From: ${escapeHtml(from)}<br>
        Reply to: ${escapeHtml(replyTo)}<br>
        Sent: ${escapeHtml(createdAt)}<br>
        Feedback id: ${escapeHtml(id)}
      </p>
    </div>
  </body>
</html>`;

  try {
    await sendEmail(env, { to, subject, html, text, replyTo });
    return true;
  } catch (err) {
    // Loud on purpose: the message is safe in D1 but nobody will see it until
    // someone reads this line or queries for "delivered" = 0.
    console.error(
      `feedback ${id} stored but email delivery failed — ` +
        `query the feedback table for undelivered rows:`,
      err,
    );
    return false;
  }
}
