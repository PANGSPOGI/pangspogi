# Mango Silo Tracker

This Next.js app runs on Vercel and stores shared tracker readings and weekly
feed forecasts in your existing Google Sheet through an Apps Script web app.
The sheet is accessed by the Google account that owns/runs the Apps Script;
the spreadsheet itself does not need to be public. Apps Script quotas apply.

## Connect the existing spreadsheet

The Apps Script bridge is in [`apps-script/Code.gs`](./apps-script/Code.gs) and
is already configured with the spreadsheet ID from the provided link.

1. Open the Apps Script project associated with the spreadsheet, or create a
   project at [script.google.com](https://script.google.com).
2. Replace the contents of `Code.gs` with `apps-script/Code.gs`. If using the
   existing script project, replace the old `doGet` and other function
   definitions to avoid duplicate function names.
3. In the Apps Script project, open **Project Settings → Script Properties**
   and add a property named `VERCEL_SHARED_SECRET`. Set its value to a new,
   long random secret. Do not put the secret in the Apps Script source code or
   send it in chat. You can generate one locally with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Select **Deploy → New deployment → Web app**. Set **Execute as** to **Me**
   and **Who has access** to **Anyone**. Deploy and approve the requested
   spreadsheet permissions as the Google account that can edit the sheet.
   Copy the deployed web app URL ending in `/exec`.
5. In Vercel **Project Settings → Environment Variables**, add:
   - `APPS_SCRIPT_WEB_APP_URL`: the deployed URL ending in `/exec`.
   - `APPS_SCRIPT_SHARED_SECRET`: the same value as `VERCEL_SHARED_SECRET`.
6. Redeploy the Vercel app. Keep Vercel Deployment Protection enabled if
   available; the Apps Script URL is publicly callable, but requires the
   shared secret for every operation.

The shared secret secures the Apps Script bridge; it does not log users into
the Vercel app. If the deployed app is publicly reachable, its API routes can
be called by visitors, so restrict app access with Vercel Deployment
Protection or another authentication layer before using it with real data.
Public access to the Groq photo-reading endpoint can consume account limits.

The spreadsheet keeps the existing `Readings` tab (it is created with headers
if missing). The app creates a `FeedForecasts` tab on the first forecast save.
Updating the Apps Script code later requires deploying a new version.

Google Cloud billing is not required for this Apps Script approach. It remains
subject to Google Apps Script service quotas.

## Tracker dashboard

The dashboard includes searchable house cards, house-group controls, clickable
critical/empty status filters, and live silo-level summary counts. The filters
also limit which houses are affected by **Reset Visible Silos**. Each house
shows flock age from its placement date using the current Philippines date.
**Update Data** estimates feed use since the last saved reading (270 kg/hour
for FH1-FH12 and 312 kg/hour for FH13-FH19) and saves the updated readings.
The dashboard is responsive for desktop and mobile, and its header includes a
dark-mode toggle that remembers the setting in the current browser.
The main action bar stays fixed at the bottom while scrolling, with extra page
spacing so it does not cover the last house cards.

## Settings

Open **Settings** from the main navigation to manage the house and silo
register, assign silos to houses, and choose a default length unit. The initial
register is populated from the existing FH house and silo dimensions. New and
edited dimensions are stored in meters and volume in cubic meters; the selected
units only affect how those values are entered and displayed. Set the cylinder
count to enter separate heights and diameters for every cylinder. Silo volume
is calculated from each cylinder plus the cone (using Cylinder 1's diameter)
and can be overridden in the form.

Settings are stored in the `SiloSettings` tab in the existing spreadsheet,
separately from tracker readings and feed forecasts. The Apps Script deployment
must be updated with `apps-script/Code.gs` to enable settings reads and saves.
The existing tracker, readings, and reports keep their current behavior and
storage.

## Silo profiles

The tracker uses the dimension sheet's profiles and layer weights to draw the
silos and map fill height to stored feed volume:

| Houses | Silo | Diameter | Roof | Cylinder sections | Lower cone | Capacity |
| --- | --- | --- | --- | --- | --- | --- |
| FH1-FH12 | Rotem Silo 1 | 2.71 m | 0.50 m | 4 x 0.83 m | 1.93 m | 20,238.5 kg |
| FH1-FH12 | Rotem Silo 2 | 2.71 m | 0.50 m | 3 x 0.83 m | 1.93 m | 16,158.5 kg |
| FH13-FH19 | SKOV Silo 1 and 2 | 3.00 m | 0.80 m | 3 x 0.83 m | 2.45 m | 21,522 kg |

## Printed and photo silo readings

Use **Print Silo Reading** to preview the paper form before printing. It creates
three pages in the same six-house layout as the sample, with each silo drawn
from its tracker profile. House order matches the supplied sheets: FH06/FH08
through FH11/FH12, then FH01/FH02 through FH05/FH13, followed by FH14/FH15
through FH18/FH19. The A4 print pages are separated explicitly to prevent the
three-page form from being scaled together. **Upload Silo Photo** opens a
drop-or-browse screen that accepts up to three photos (one for each printed
report page) for a single combined review.

**Read on this device (free OCR)** runs text recognition in your browser and
does not upload the images. It detects house labels and some date/time text,
but cannot detect hand-drawn feed lines. Detected silo rows start at 0% (empty);
enter a level anywhere a line is visible, then review before syncing. Only
recognized houses are shown.

**Read with Groq AI** sends each photo to Groq's vision model so it can
interpret the silo marks too. A silo with no hand-drawn feed line, or marked
EMPTY, is set to empty; crossed-out or unclear marks remain unreadable. This
option requires a Groq API key from the [Groq Console](https://console.groq.com/).
Add it as `GROQ_API_KEY` in Vercel **Project Settings → Environment Variables**
(or in `.env.local` for local development), then redeploy. Keep the key
server-side; never put it in browser code or chat. Groq account access, quotas,
rate limits, and pricing depend on current account terms. Check the Groq
Console's billing and limits before use; if it asks you to add a payment
method and you do not want to, stop and use on-device OCR instead. The app
does not call Groq unless you select **Read with Groq AI**. Photos sent to
Groq are subject to its current data-use terms. Printing does not require
either reader or an API key.

If you previously configured `OPENAI_API_KEY` in Vercel, remove that unused
variable. Remove any unused `GEMINI_API_KEY` as well. Revoke any API keys
previously shared in chat; do not reuse them.

## Weekly delivery forecast

Open **Delivery Forecast** in the tracker to enter a seven-day schedule. Choose
the start date, select BSC, BSP, CBC, or BFP for each of the six available rows,
choose Trucks or Bags, enter each day's quantity, then save or print the
forecast or download a PNG report image. Each save keeps a new snapshot;
reopening that same week loads its latest saved version.

## Run locally

Install Node.js 20 or later, then run:

```bash
npm install
npm run dev
```

Set `APPS_SCRIPT_WEB_APP_URL` and `APPS_SCRIPT_SHARED_SECRET` in `.env.local`
before testing save/load features locally. Open `http://localhost:3000`.

## Deploy to Vercel

Import this project into Vercel, configure both Apps Script environment
variables as described above, and deploy. The API routes call Apps Script from
the server, so the shared secret is not exposed in browser code. Check the
Vercel function logs and Apps Script **Executions** page if a save or load
fails.
