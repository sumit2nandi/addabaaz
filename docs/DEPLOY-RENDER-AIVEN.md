# Deploying on Render with a MySQL database on Aiven

**Render** runs the Node app (the website and the API in one service). **Aiven** hosts the MySQL database. They talk to each other over the internet, encrypted (TLS). You do everything in web dashboards; the only command-line step is creating your first admin (step 6), which runs on your own computer.

| | Free | Good for a real site |
|---|---|---|
| Render web service | Sleeps after 15 min without visits (first visit then takes ~1 min). **Uploaded images are lost on every deploy/restart.** Outbound mail ports (25/465/587) are blocked. | **Starter** (about $7/month): always on, can attach a disk, SMTP works. |
| Aiven MySQL | Free plan: 1 CPU, 1 GB RAM, 1 GB storage, no credit card. Powers off after a long period of inactivity (Aiven emails you first). | A paid plan (more storage, high availability). |

Prices and limits change: check the two pricing pages before you commit.

---

## 1. Put the code on GitHub
Render deploys from a GitHub repository (yours: `sumit2nandi/addabaaz`, branch `production` or whichever branch you want live). Nothing to build or upload by hand.

## 2. Create the database on Aiven
1. Sign up at **aiven.io** → **Create service** → **MySQL**.
2. Plan: **Free** (or a paid one). Cloud/region: choose the one closest to Render's region. **Render Singapore + Aiven AWS Singapore (ap-southeast-1)** is a good pair for visitors in India.
3. Name it (for example `addabaaz-db`) → **Create service**. Wait until the status says **Running** (a few minutes).
4. On the service's **Overview** page note down:
   * **Host** (like `addabaaz-db-yourproject.f.aivencloud.com`)
   * **Port** (a number like `21345`; it is **not** 3306)
   * **User** (`avnadmin`), **Password** (click the eye icon), **Database name** (`defaultdb`)
5. Click **Download** next to **CA certificate** (a file called `ca.pem`). Open it in Notepad: you will paste it into Render in step 4.
6. **Allowed IP addresses:** the default allows every address, which is what you need first. Later you can restrict it to Render's outbound IP addresses (shown in the Render dashboard under your service → **Connect → Outbound**).

The app needs no manual SQL: it creates all 26 tables itself when it starts (every table has a primary key, which Aiven requires).

## 3. Create the web service on Render
**Option A - Blueprint (fastest).** Render dashboard → **New → Blueprint** → pick the repository → Render reads `render.yaml` and asks for the values marked `sync: false`. Fill them in as in step 4.

**Option B - by hand.** **New → Web Service** → pick the repository, then:

| Field | Value |
|---|---|
| Language / Runtime | **Node** |
| Branch | the branch you deploy from |
| Region | **Singapore** (or next to your Aiven database) |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance type | Free to try, **Starter** for a real site |
| Advanced → Health Check Path | `/api/v1/health/ready` |

## 4. Environment variables (Render → your service → Environment)
| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a long random value. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never share it; keep it the same between deploys. |
| `TRUST_PROXY` | `1` |
| `PUBLIC_SITE_URL` | `https://<your-service>.onrender.com` (no trailing slash; use your own domain once it is connected) |
| `DB_HOST` | Aiven **Host** |
| `DB_PORT` | Aiven **Port** |
| `DB_USER` | `avnadmin` |
| `DB_PASSWORD` | Aiven **Password** |
| `DB_NAME` | `defaultdb` |
| `DB_SSL` | `true` |
| `DB_POOL_SIZE` | `5` |
| the CA certificate | **either** (easiest) add `DB_SSL_CA` and paste the whole content of `ca.pem`, `-----BEGIN CERTIFICATE-----` line to `-----END CERTIFICATE-----` line, **or** under **Environment → Secret Files** add a file named `aiven-ca.pem` with that content and set `DB_SSL_CA_FILE=/etc/secrets/aiven-ca.pem` |

Do **not** set `PORT` (Render sets it) and do not set `DATABASE_URL` as well as the `DB_*` values. Passwords containing `#` or other special characters are fine here because the values are typed into separate boxes.

Click **Save**. Render builds and starts the service. Open **Logs**; a good start looks like:
```
[db] settings from DB_* variables: avnadmin@<host>:<port>/defaultdb
[migrate] applied 6 migration(s)
ADDABAAZ running on ...
```
Then open `https://<your-service>.onrender.com/api/v1/health/ready`. It should show `{"ok":true,"db":"up"}`, and the home page should load.

## 5. Keep files and mail working (optional but important)
* **Admin-uploaded images.** The free plan forgets them at every deploy. On a paid plan: service → **Disks → Add disk**, mount path `/var/data`, then add `UPLOAD_DIR=/var/data/uploads`. (A disk means a single instance and a short pause on each deploy.) Premium videos are not affected, because they live in Cloudflare R2.
* **Email.** Render's free web services cannot reach the usual SMTP ports. Use a paid instance, or a mail provider that offers port 2525 and put it in `SMTP_URL` (see `SETUP.md` section 8).
* **Sleeping.** A free service sleeps when idle, so reminders and scheduled jobs wait for the next visit. A free uptime monitor (for example UptimeRobot) calling `/api/v1/health/ready` every 5 minutes keeps it awake. One always-on free service fits inside Render's 750 free hours a month; check this in your dashboard. The same pings also keep the Aiven free database active.

## 6. Create your first admin
Render's free plan has no shell, so run the command on your own computer against the Aiven database. In PowerShell, in the project folder (after `npm.cmd install`):
```powershell
$env:DB_HOST="<aiven host>"; $env:DB_PORT="<aiven port>"; $env:DB_USER="avnadmin"
$env:DB_PASSWORD="<aiven password>"; $env:DB_NAME="defaultdb"; $env:DB_SSL="true"
$env:DB_SSL_CA_FILE="C:\path\to\ca.pem"
npm.cmd run admin -- grant you@example.com
```
First create the account on your site (Sign up with that e-mail), then run the command. Then open `https://<your-site>/admin` and sign in. Close the PowerShell window afterwards so the password does not stay in the environment.

## 7. Connect a domain (optional)
Render → your service → **Settings → Custom Domains** → add `www.yourdomain.com` and create the DNS record Render shows. Then change `PUBLIC_SITE_URL` to the new address (and update the Google/Facebook/Razorpay settings that use it, see `SETUP.md` section 8).

## 8. Updating
With `autoDeploy: true` (the Blueprint default) every push to the branch deploys automatically. Otherwise use **Manual Deploy** in Render. Database changes are applied automatically at start. Aiven keeps daily backups on the free plan; for your own copy use **mysqldump** from your computer or `npm run backup` (see `SETUP.md` section 13).

## Troubleshooting
| Log / symptom | Meaning and fix |
|---|---|
| `self-signed certificate in certificate chain` or `unable to get local issuer certificate` | The Aiven CA certificate is missing or wrong. Re-paste the whole `ca.pem` into `DB_SSL_CA` (or check the secret file path in `DB_SSL_CA_FILE`). |
| `DB_SSL_CA_FILE: cannot read ...` | The secret file name or path does not match. Secret files appear under `/etc/secrets/<file name>`. |
| `ETIMEDOUT` / `ECONNREFUSED` | Wrong host or port (the port is not 3306), the Aiven service is not **Running** (free services power off when idle: power it on in the Aiven console), or the Aiven allowed-IP list blocks Render. |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` / `DB_PASSWORD`. Copy them again from Aiven. |
| Deploy fails on the health check | Open the Logs: usually a missing environment variable, or the database could not be reached. |
| `[auth] ... JWT_SECRET` error at start | `JWT_SECRET` is missing while `NODE_ENV=production`. |
| First visit is very slow | Free plan waking up. Normal; see the sleeping note in step 5. |
| Images vanish after a deploy | Free plan has no disk, see step 5. |
