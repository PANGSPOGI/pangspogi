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
This is especially important after adding photo reading, because public access
to that endpoint can incur OpenAI API charges.

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
drop-or-browse screen with an image preview. After choosing **Read Silo Photo**,
review and edit the detected date, time, and silo fill marks before syncing;
crossed-out or unreadable silos are left unchanged. Recognized fill heights
are converted to inventory using the matching silo profile.

Photo reading uses OpenAI's vision API. Add `OPENAI_API_KEY` to the server
environment (for example, Vercel Environment Variables or `.env.local`). Keep
the key server-side. Uploaded photos are sent to OpenAI for recognition; do
not upload photos you are not authorized to share. Image reading requires this
key, while printing does not.

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
