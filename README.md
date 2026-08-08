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

The trainee signs in with the national ID and the Saudi mobile number stored by
the Excel import. Firebase sends an SMS verification code. After the code is
confirmed, the `activateTraineeSession` Cloud Function verifies that the phone
number in the Firebase token matches the imported trainee record, then links
the Firebase UID to that trainee document. Firestore and Storage rules restrict
the signed-in trainee to that trainee's courses and certificates.

Before using this flow:

1. Enable **Authentication > Sign-in method > Phone** in Firebase Console.
2. Under **Authentication > Settings > SMS region policy**, allow Saudi Arabia.
3. Add the production hostname under **Authorized domains**.
4. For local development, configure Firebase fictional test phone numbers and
   codes; production SMS phone authentication must run from an authorized
   hosted domain.
5. Deploy the backend and access rules:
   `firebase deploy --only functions,firestore:rules,storage`.

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
