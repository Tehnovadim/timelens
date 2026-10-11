# TimeLens

[Live website](https://timelens-511210.web.app/) · [GitHub source](https://github.com/Tehnovadim/timelens) · [Prepared example data](public/sample-result.json)

TimeLens turns a photograph of a building or street into a timeline of three researched historical interpretations. Capture or upload a photo, use its GPS metadata or device location, choose three years, and compare the reconstructed eras with the original.

## Try it

Choose **See an example** to explore Paris in 1888, 1900 and 1960 immediately, without signing in or using the generation allowance. These are prepared AI images based on a licensed 2011 photograph and linked public sources. They were made with built-in ImageGen, separately from the live API pipeline. They demonstrate the viewer, not measured production accuracy. Original photos are dated correctly, and uncertain details are labelled.

For your own photo, use Camera or Upload photo, then Reveal the past. GPS in the file has priority. If it is absent, allow device location only when you are at the photographed place. Three years can be changed in Settings.

English and light appearance are the defaults. English/Russian and light/dark selections persist on the device and, after verified Google sign-in, in the profile. Animation respects reduced-motion preferences. Google OAuth is still in testing mode; guest generation and the prepared example do not require Google.

## Cloud architecture

This folder is the **canonical Firebase implementation deployed to the live website**. The separate TimeLens.zip archive is a Windows local development version and is not the production backend.

- Firebase Hosting serves the HTML, CSS, JavaScript, fonts and prepared public example.
- timelensApi validates requests, cookies, Google signatures/nonces, quotas and ownership.
- Cloud Tasks runs bounded background research and image processing through timelensWorker.
- Firestore persists sessions, jobs, fingerprints, quotas and album metadata across instance restarts.
- Private Cloud Storage holds photos and results. Direct browser access to Firestore/Storage is denied; the API checks ownership before returning private data.
- The OpenAI key is a Google Secret Manager secret named TIMELENS_OPENAI_KEY, used only by the worker. It is absent from the client and source archive.

Research uses gpt-5.4-mini with web search. It verifies that cited URLs were actually retrieved, performs bounded follow-up searches for missing eras, and distinguishes documented, limited and unavailable evidence. Drawings, archaeology and written records can support years before photography. The image editor gpt-image-2 edits the user's photograph at medium quality, with one request per supported era. Source descriptions appear after research; the three image requests run in parallel, and each ready frame becomes available during processing.

## Allowances and cancellation

Guests receive one new journey per day per session and network; verified ordinary Google profiles receive three per profile. One visitor can have one active journey, while different visitors enter a queue. TIMELENS_PUBLIC_DAILY_CAP is an additional cost-control allowance, currently 12 non-admin journeys per day. The designated verified administrator bypasses these daily generation quotas. Dates use Asia/Jerusalem. Attempts, including failures and cancellations, count toward allowances. Cached completed requests, the album and the prepared example require no new AI calls.

One worker processes queued tasks at a time. Up to three image requests run concurrently within a journey. Cloud Task retries and automatic paid image retries are disabled. Cancellation before the worker claims a queued job prevents its provider calls. Once processing starts, cancellation is best effort: requests already received by OpenAI may still be charged. These count-based controls are not a strict monetary cap. Google Cloud and OpenAI are billed separately.

Guest results are stored privately for the guest session and copied to browser storage when available. Browser storage has a timeout and an in-memory fallback, so a blocked database does not leave the album loading forever. Guest cloud access depends on the session cookie (seven days); clearing cookies or signing in changes that identity. Verified Google albums remain tied to the Google subject ID. Existing local personal albums are not published or migrated automatically.

## Deploy

Requires Node.js 22, a Firebase Blaze project, Firebase CLI access, Cloud Tasks/Firestore/Storage, and model access on the OpenAI account.

1. Install function dependencies in functions using pnpm install --frozen-lockfile.
2. Configure the public project values in functions/.env.<project-id>: TIMELENS_GOOGLE_CLIENT_ID, TIMELENS_BUCKET, TIMELENS_ADMIN_EMAIL, TIMELENS_PUBLIC_DAILY_CAP and TIMELENS_OPENAI_READY.
3. Set the server secret with firebase functions:secrets:set TIMELENS_OPENAI_KEY.
4. Deploy from this folder:

~~~sh
firebase deploy --only functions:timelens,hosting --project timelens-511210
~~~

For a new project also deploy Firestore/Storage rules, update .firebaserc, allowed origins, bucket, task invoker service account and Google OAuth origins. The included configuration is for the existing TimeLens project. Never upload local DPAPI credentials, personal photos, private history, logs or dependency folders. The current OpenAI key was configured with an expiry of 9 November 2026 and will need replacing.

## Verification and limits

Install root development dependencies with pnpm install --frozen-lockfile, then run pnpm test. The 64 cloud/research/UI checks use mocked provider results; they make no billable AI calls. They cover guest access, independent quotas, queueing, ownership, parallel image calls, progressive results, cancellation, source validation, preference persistence, the public sample and blocked browser storage.

The live site is also checked in a browser at desktop and mobile widths. No new paid generation or 8–10-case accuracy benchmark was authorized for this revision. There is no automatic vision quality checker or paid retry. Prepared images have been reviewed visually; fine historical details and camera alignment remain approximate. Perfect historical reconstruction, light matching or pixel alignment are not guaranteed. Sources support specific facts, not every generated pixel. Missing evidence remains visible instead of being presented as certainty.

## Assets and contest handoff

The original Eiffel Tower photo is by NonOmnisMoriar (2011), licensed CC BY-SA 3.0. The prepared AI derivatives and compressed copies use the same licence; see public/SAMPLE-LICENSE.md and public/DEMO-PROVENANCE.md. Font licences are in public/FONT-LICENSES.md. The photograph licence does not automatically license the application source code.

CONTEST-SUBMISSION.md contains an English description under 500 words. REVIEW-RESOLUTION.md maps reviewer findings to fixes and remaining limitations. The matching cloud source is published at https://github.com/Tehnovadim/timelens. The contest entry itself has not been submitted.
