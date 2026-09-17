# Powerblend

## Run locally

From this folder, start the built-in Node.js server:

```powershell
node server.js
```

Open `http://localhost:3000` in a browser. Do not open the HTML files directly because API requests require the server.

## Admin access

Open `admin-login.html` or use the Admin link in the site footer. The development defaults are:

```text
Email: admin@powerblend.com
Password: PowerBlend123!
Access code: 12345
```

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_ACCESS_CODE` environment variables before starting the server for non-development credentials.

Bookings, membership requests, accounts, and orders are written to `data.json`. That file is intentionally ignored by Git. For production, replace this file store with a hosted database or Google Sheets integration and use HTTPS, a secret manager, and a real payment provider.