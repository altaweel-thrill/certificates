# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Environment variables

Copy `.env.example` to `.env.local` for local development. In production, add
the same keys in the hosting provider's environment-variable settings before
running the build. All Firebase browser configuration keys use the
`NEXT_PUBLIC_` prefix because the Firebase Web SDK needs them in the browser;
Firebase authorization still depends on Authentication, Firestore rules,
Storage rules, and Cloud Functions.

Required keys:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION`

## Firebase administrator login

1. In Firebase Console, enable **Authentication > Email/Password**.
2. Create the administrator account under **Authentication > Users**.
3. Copy its UID, then create `users/{uid}` in Firestore with a string field
   named `role` and the value `admin`. Add a string field named `name` for the
   administrator's display name.
4. Install and build the secure user-management functions:
   `npm install --prefix functions && npm run build --prefix functions`.
5. Deploy the included rules and functions with
   `firebase deploy --only firestore:rules,storage,functions`.
6. Add each production hostname under **Authentication > Settings >
   Authorized domains**.

The **Users and permissions** page creates Firebase Authentication accounts,
changes `trainee`, `admin`, and `super_admin` roles, disables or enables
accounts, and permanently deletes users. These operations run only through
authenticated Cloud Functions; the browser never receives Admin SDK credentials.

The application also accepts the privileged custom claims `admin: true`,
`role: "admin"`, or `role: "super_admin"`. Custom claims are preferred when
they are managed by a trusted server environment.

## Trainee phone login

The trainee enters the national ID and Saudi mobile number stored by the Excel
import. `sendTraineeOtp` first matches both fields, generates a six-digit code,
and sends it through Authentica's server-only `POST /api/v2/send-otp` endpoint
using its documented custom `otp` parameter. `verifyTraineeOtp` validates the
code locally against an HMAC digest, rechecks the current trainee record, and
returns a Firebase custom token. The browser signs in with that token, so
Firestore and Storage access rules and existing trainee UIDs continue to work.
The new flow does not call Firebase Phone SMS or its RecaptchaVerifier.

The code expires in five minutes, permits five guesses, and can be consumed only
once. A replacement code invalidates the previous challenge. The backend allows
one send attempt per minute, up to six per phone per hour and 30 per IP per hour;
these limits also apply after a page refresh. Disabled and privileged accounts
cannot be reassigned as trainees. Provider responses and plaintext codes are
never returned to the browser, stored in Firestore, or logged.

Production setup (run from the repository root):

```sh
firebase functions:secrets:set AUTHENTICA_API_KEY --project certificates-cd263
npm run build --prefix functions
firebase deploy --only functions:sendTraineeOtp,functions:verifyTraineeOtp --project certificates-cd263
```

Paste the Authentica API key at the interactive secret prompt. Do not prefix this
secret with `NEXT_PUBLIC_`, add it to DigitalOcean's client variables, or commit
it. Redeploy the web application on DigitalOcean after deploying the functions.
The key is bound only to the two new Cloud Functions through Secret Manager.
`functions/.secret.local` is an ignored emulator-only override; it is explicitly
excluded from deployment and does not configure the production secret.

Firebase custom-token signing requires the function runtime service account to
have `iam.serviceAccounts.signBlob` permission (the **Service Account Token
Creator** role on the signing service account), and the IAM Service Account
Credentials API to be enabled. If signing reports a permissions error, configure
that permission before testing login. See Firebase's
[custom token setup](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
and Authentica's [API reference](https://authenticasa.docs.apiary.io/).

The `traineeOtpChallenges` and `traineeOtpLimits` collections remain inaccessible
to all clients under the existing default-deny Firestore rules; do not open read
or write access to them. For automatic cleanup, enable Firestore TTL on the
`expiresAt` field in both collection groups. Expiry is enforced by the server
even without TTL. Local frontend testing also sends real Authentica SMS unless
the backend and provider are mocked; Firebase fictional phone numbers no
longer intercept these sends.

Run the mocked OTP security and frontend authentication tests with `npm run test:otp`.

## Certificate Excel import

The importer validates the institute's 26-column `.xlsx` template before any
records can continue to review. It checks required columns and values, Saudi
national ID length, mobile number shape, duplicate certificate numbers,
training hours and days, and Gregorian date fields. It reports exact Excel row
numbers for the first validation issues and detects course names from the file.

After validation, the administrator can save the file directly to Firestore.
The import creates or updates `courses`, `trainees`, and `certificates`, and
records progress in `imports`. Trainee document IDs use a SHA-256 hash of the
national ID; the original national ID remains inside the admin-only document
for later account matching. Writes are chunked to stay below Firestore batch
limits, and only authenticated administrators are allowed by the deployed
rules.

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
