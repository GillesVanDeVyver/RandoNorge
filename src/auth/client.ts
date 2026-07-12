// Better Auth browser client. Talks to the Worker's /api/auth/* endpoints
// (same origin, so no baseURL needed) and exposes React hooks — most
// importantly `useSession`, which Root uses to decide between the login
// page and the app.
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export type Session = typeof authClient.$Infer.Session;
