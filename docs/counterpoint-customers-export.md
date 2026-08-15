# Counterpoint `customers.csv` export — for Ward to add to TRCGCSVExport.ps1

This mirrors how `special_orders.csv` was added: a new SQL block written to a CSV, then copied to
the same Dropbox sync folder the other exports already use
(`C:\Users\Administrator\Dropbox\Sales Tracking\Access Sales and Inventory Reporting\`).

Verified against the real schema 2026-08-15: the customer table is `AR_CUST` (not `CM_CUST`),
business name is `NAM` (not `CUST_NAM`), and there's no simple `NO_EMAIL` flag — instead there's
an actual marketing opt-in field, `INCLUDE_IN_MARKETING_MAILOUTS` (confirmed `Y`/`N` values only,
29,185 Y / 17,003 N among customers with an email on file).

## Query

```sql
SELECT
    c.CUST_NO                                                              AS [Customer #],
    LTRIM(RTRIM(COALESCE(c.FST_NAM, '') + ' ' + COALESCE(c.LST_NAM, ''))) AS [Name],
    c.NAM                                                                  AS [Business Name],
    c.EMAIL_ADRS_1                                                         AS [Email],
    COALESCE(NULLIF(c.MBL_PHONE_1, ''), c.PHONE_1)                         AS [Phone],
    CASE WHEN c.INCLUDE_IN_MARKETING_MAILOUTS = 'Y' THEN 0 ELSE 1 END      AS [Do Not Email],
    c.LST_SAL_DAT                                                          AS [Last Sale Date]
FROM AR_CUST c
WHERE c.EMAIL_ADRS_1 IS NOT NULL
  AND c.EMAIL_ADRS_1 <> ''
ORDER BY c.CUST_NO;
```

Notes / decisions baked into this:
- **Company-wide, not just WEST location** — customer records aren't per-location like sales
  lines are, so this pulls every customer with an email on file regardless of which store they
  shop at. Let me know if that's not what you want.
- **`Do Not Email` is the inverse of Counterpoint's `INCLUDE_IN_MARKETING_MAILOUTS`**, not from
  Klaviyo. Klaviyo's unsubscribe list gets imported separately into the app's own suppression list
  (one-time, from your existing monthly Klaviyo export) — this column just keeps Counterpoint's own
  opt-in status in sync going forward.
- **Phone** prefers the mobile number (`MBL_PHONE_1`) and falls back to the landline (`PHONE_1`)
  if there's no mobile number on file.
- Rows with no email address are excluded entirely — no point exporting customers we can't email.
- `AR_CUST` also has `USER_KlaviyoId` / `USER_Klaviyo_Commit` columns from a prior Klaviyo
  integration — not used here, but worth knowing about if we ever want to match suppression
  records by Klaviyo ID instead of just email.

The CSV column headers above (`Customer #`, `Name`, `Business Name`, `Email`, `Phone`,
`Do Not Email`, `Last Sale Date`) match exactly what the nightly sync Cloud Function
(`camera-company-accounts-functions/functions/index.js`) already expects — no code changes needed
there once this is wired in.

## PowerShell block to add to `TRCGCSVExport.ps1`

Add this alongside the existing `special_orders.csv` block, adjusting variable names if your
script uses a different pattern for the SQL connection / Dropbox path than shown here:

```powershell
# --- Customers export (added for Camera Company Email) ---
$customersQuery = @"
SELECT
    c.CUST_NO                                                              AS [Customer #],
    LTRIM(RTRIM(COALESCE(c.FST_NAM, '') + ' ' + COALESCE(c.LST_NAM, ''))) AS [Name],
    c.NAM                                                                  AS [Business Name],
    c.EMAIL_ADRS_1                                                         AS [Email],
    COALESCE(NULLIF(c.MBL_PHONE_1, ''), c.PHONE_1)                         AS [Phone],
    CASE WHEN c.INCLUDE_IN_MARKETING_MAILOUTS = 'Y' THEN 0 ELSE 1 END      AS [Do Not Email],
    c.LST_SAL_DAT                                                          AS [Last Sale Date]
FROM AR_CUST c
WHERE c.EMAIL_ADRS_1 IS NOT NULL
  AND c.EMAIL_ADRS_1 <> ''
ORDER BY c.CUST_NO;
"@

$customersLocalPath = "C:\TRCG CSV Export\customers.csv"
$customersDropboxPath = "C:\Users\Administrator\Dropbox\Sales Tracking\Access Sales and Inventory Reporting\customers.csv"

Invoke-Sqlcmd -ServerInstance $serverInstance -Database $databaseName -Query $customersQuery |
    Export-Csv -Path $customersLocalPath -NoTypeInformation -Encoding UTF8

Copy-Item -Path $customersLocalPath -Destination $customersDropboxPath -Force
# --- end customers export ---
```

Replace `$serverInstance` / `$databaseName` with whatever variable names the rest of the script
already uses for the `CPSQL-MSHUB` / `Cameraco` connection — I don't have the existing script open
to match it exactly, so wire this block in next to the `special_orders.csv` one and reuse its
connection variables.

Once this runs once and `customers.csv` shows up in the Dropbox folder, the app's "Sync from
Dropbox" button (and the nightly Cloud Function) will be able to pull it in.
