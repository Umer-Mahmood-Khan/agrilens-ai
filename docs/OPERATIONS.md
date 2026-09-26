# AgriLens AI — Farm Intelligence Copilot

A local wheat intelligence MVP: photo observations + optional soil report → user review → rule matching → three next steps → reference checks.

## Start

Requires Node.js 22 or newer. There are no external packages to install.

```powershell
npm start
```

Open http://127.0.0.1:3001 (or the exact URL printed in your terminal). Keep the terminal running; press Ctrl+C to stop. Select **Explore a sample** to try the full workflow without an API key. Sample observations and recommendations are fictional and clearly labeled. No AI calls occur in sample mode.

## Connect live AI

1. Open `.env` in this folder (next to `package.json`). If missing, copy `.env.example` to `.env`.
2. Paste your OpenAI API key after `OPENAI_API_KEY=`. Put the real key only in `.env`, never in `.env.example` or frontend files.
3. Save the file. Leave `AI_PROVIDER=openai` selected.
4. In your terminal, stop any existing AgriLens process with Ctrl+C, then run `npm start`. Open the URL printed there and choose **My field**.

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_key_goes_here
OPENAI_MODEL=gpt-5.4-mini
PORT=3001
```

The default OpenAI model is `gpt-5.4-mini`, which supports image input and structured JSON output. The Responses API also accepts PDF reports. Set `OPENAI_MODEL` to change models. API billing and model access are required; there is no automatic provider or model fallback. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

A photo-only run makes one model call for visible observations. Adding a soil report makes a second call for extraction. Recommendations and reference checks are deterministic and make no AI calls. Temporary server/network failures get at most two extra attempts per stage, with visible retry messages and short backoff; retries can consume additional quota. A temporary rate limit is retried only when the provider explicitly supplies a delay of 30 seconds or less. Daily/zero/unknown quotas, invalid keys, request errors and refusals are not automatically retried. The header says **key configured**, not **connected**; model availability can change during a run.

If a stage still fails, click **Resume analysis** or **Resume action plan** on the same page. Completed stages are reused for identical inputs while the server session remains available. You do not need to rerun successful photo or report extraction. Editing the inputs invalidates affected cached results. Photo observations appear as soon as they are ready; recommendations are built from the confirmed readings. Cancel also interrupts retry waits.

Gemini remains optional: set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. Each provider uses only its own key.

## Walkthrough

1. Choose wheat growth stage, optional location and field notes.
2. Upload a JPG, PNG or WebP leaf photo (maximum 8 MB). Optionally add a short soil PDF or report image (maximum 8 MB).
3. Click **Analyze my field**. Real progress events show vision and report stages completing.
4. Review the observations. Correct extracted soil values, units, reference ranges and printed interpretations; add or remove rows as needed. An unreadable or missing report leaves soil unknown.
5. Confirm the readings and click **Create action plan**.
6. Review actions, missing context, limitations and source passages. Download Markdown or JSON.

Use a clear, close photo and a short legible report for the first run. The app checks file signatures and sizes; the model handles readability. Signature validation is not full image/PDF decoding. Files with valid headers can still be corrupt and rejected by the API.

## Architecture

| File | Purpose |
| --- | --- |
| `server.mjs` | HTTP server, JSON/NDJSON endpoints, `/healthz`, deployment settings, ephemeral analysis sessions |
| `lib/pipeline.mjs` | Vision, report extraction, rule matching and reference checks |
| `lib/recommendations.mjs` | Versioned evidence-gathering recommendation rules |
| `public/soil.mjs` | Conservative lab-rating parser and pH chart validation |
| `DATASETS.md` | Larger dataset shortlist, geographic fit and import requirements |
| `lib/ai.mjs` | Provider selection, Gemini/OpenAI HTTP requests, response validation and API errors |
| `lib/errors.mjs` | User-facing application errors |
| `lib/limits.mjs` | Visitor IP and in-memory usage limits |
| `lib/schemas.mjs` | Strict JSON schemas and response validation |
| `lib/knowledge.mjs` | 14 scoped editorial reference cards and lexical retrieval |
| `lib/sample.mjs` | Explicitly fictional demonstration data |
| `public/` | Responsive interface, actual progress, review controls and exports |
| `test/app.test.mjs` | Native Node tests for workflows, mocked API and request boundaries |

OpenAI reads the photo and report; it no longer drafts or reviews recommendations. `wheat-evidence-v1` selects three short, source-linked evidence-gathering actions from confirmed inputs. Only explicit lab ratings affect the nutrient review step. Possible disease hypotheses do not drive actions. These editorial rules are not locally field-validated prescriptions. Missing measurements remain unknown. Keyword retrieval remains available for library research but does not select live actions.

## Data handling and limits

- Binds to `127.0.0.1` by default, checks Host and same-origin requests, and does not enable CORS. `HOST`, `ALLOWED_HOSTS` and `LIVE_ANALYSIS=off` enable a public sample-only demo. `LIVE_ANALYSIS=visitor` lets public visitors analyze with their own API key; server keys are then ignored, and visitor keys are used per request and never stored or logged (see the README's deploy section). `LIVE_LIMIT_PER_HOUR` limits new analyses per visitor IP; limits are in memory and reset on restart.
- No API key is sent to the browser. The `.env` file is ignored by Git and never served.
- In live mode, uploads and notes go to the selected provider: Google for Gemini, OpenAI for OpenAI. Gemini requests send image/PDF bytes inline and the key in an HTTPS header, never a URL. Google says free-tier content may be used to improve its products; use non-sensitive demo reports. OpenAI requests set `store: false`. Neither approach is a claim of zero provider retention; provider policies still apply.
- Uploaded bytes are not persisted. Extracted findings/context, request hashes and validated stage results remain in process memory for 30 minutes after the last request and expire on access, with a maximum of 100 sessions and 12 cached stage results per session. Restart clears the sessions; keep the browser page open to retain its resume ID. No permanent analysis history is implemented.
- The reference library contains 14 short editorial cards from FAO, US extension, ISRIC and Punjab sources. It is not regionally validated for Pakistan and does not prescribe fertilizer/pesticide doses or irrigation quantities.
- Model output remains uncertain. No calibrated confidence scores or confirmed disease diagnoses are displayed.
- Weather integration, user accounts, permanent storage, trained disease classifiers, and individual user accounts are outside this MVP.

## Verify

```powershell
npm test
```

Tests cover both provider adapters, key isolation, the sample flow, soil edits, photo-only behavior, unreadable PDF extraction, model refusal and API errors, schema validation, unsupported citations, uploads and local HTTP boundaries. API tests use mocked responses and never call external providers or use your key.

Gemini documentation: [generateContent API](https://ai.google.dev/api/generate-content), [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [API keys](https://ai.google.dev/gemini-api/docs/api-key).

OpenAI documentation: [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Troubleshooting

Run `npm run check:ai` to send one small structured-output test through the selected provider and actual app adapter. This reads your key from `.env` without printing it or uploading files. API charges apply. Automated `npm test` remains offline with mocked API responses.

For an optional full live check with the public/synthetic files in `sample-data`, run `npm run check:workflow`. This checks photo/report extraction (two model calls, plus bounded retries), known soil values and deterministic recommendations. Provider service availability or quota can interrupt the check. To test another model without editing `.env`, append `-- --model=MODEL_ID`.

- **AI not configured:** edit `.env`, not `.env.example`, and restart. Existing terminal environment variables take precedence over `.env`.
- **API key rejected:** confirm `OPENAI_API_KEY` is an OpenAI API key and `AI_PROVIDER=openai`. Check API restrictions and project access.
- **Rate limit:** check your OpenAI API billing and usage limits and retry when available. The app does not silently switch to another provider or sample output.
- **High demand (503):** The provider is temporarily busy. The app tries twice more, then lets you resume the unfinished step. If overload persists, wait or configure another compatible model that your account can access; changing the API key is not necessary.
- **Model not found:** choose a model available to your project and set its bare ID in `OPENAI_MODEL` (no `models/` prefix).
- **Port in use:** set `PORT=3002` in `.env` and open the printed URL. If you previously set `$env:PORT` in PowerShell, clear that session override with `Remove-Item Env:PORT -ErrorAction SilentlyContinue` so `.env` takes effect.
- **Analysis expired:** restart the workflow; in-memory sessions last 30 minutes.

For automatic server restarts during editing, run `npm run dev`.

## Visual recommendations and data

The field brief leads with three action cards, a reported pH scale and explicit lab-rating dots. Full source text and rationale are expandable. Categorical dots are not quantities; unrecognized ratings stay unrated. See [DATASETS.md](../DATASETS.md) for four larger data candidates. Those external datasets have not been ingested or used to train a model.
