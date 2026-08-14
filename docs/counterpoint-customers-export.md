# Counterpoint `customers.csv` export — for Ward to add to TRCGCSVExport.ps1

This mirrors how `special_orders.csv` was added: a new SQL block written to a CSV, then copied to
the same Dropbox sync folder the other exports already use
(`C:\Users\Administrator\Dropbox\Sales Tracking\Access Sales and Inventory Reporting\`).

**Before wiring this in**, run a quick sanity check in SSMS to confirm these `CM_CUST` column
names match your actual schema (Counterpoint installs vary slightly by version):

```sql
SELECT TOP 5 CUST_NO, FST_NAM, LST_NAM, CUST_NAM, EMAIL_ADRS_1, PHONE_1, NO_EMAIL, LST_SAL_DAT
FROM CM_CUST;
```

If any of those columns error out, tell me what SSMS says is actually in `CM_CUST` (or run
`sp_columns CM_CUST`) and I'll adjust the query below.

## Query

```sql
SELECT
    c.CUST_NO                                              AS [Customer #],
    LTRIM(RTRIM(COALESCE(c.FST_NAM, '') + ' ' + COALESCE(c.LST_NAM, ''))) AS [Name],
    c.CUST_NAM                                             AS [Business Name],
    c.EMAIL_ADRS_1                                         AS [Email],
    c.PHONE_1                                               AS [Phone],
    CASE WHEN c.NO_EMAIL = 'Y' THEN 1 ELSE 0 END            AS [Do Not Email],
    c.LST_SAL_DAT                                           AS [Last Sale Date]
FROM CM_CUST c
WHERE c.EMAIL_ADRS_1 IS NOT NULL
  AND c.EMAIL_ADRS_1 <> ''
ORDER BY c.CUST_NO;
```

Notes / decisions baked into this draft — flag if any of these are wrong:
- **Company-wide, not just WEST location** — customer records aren't per-location like sales
  lines are, so this pulls every customer with an email on file regardless of which store they
  shop at. Let me know if that's not what you want.
- **`Do Not Email` comes from Counterpoint's own `NO_EMAIL` flag**, not from Klaviyo. Klaviyo's
  unsubscribe list gets imported separately into the app's own suppression list (one-time, from
  your existing monthly Klaviyo export) — this flag just keeps Counterpoint's own opt-outs in
  sync going forward.
- Rows with no email address are excluded entirely — no point exporting customers we can't email.

## PowerShell block to add to `TRCGCSVExport.ps1`

Add this alongside the existing `special_orders.csv` block, adjusting variable names if your
script uses a different pattern for the SQL connection / Dropbox path than shown here:

```powershell
# --- Customers export (added for Camera Company Email) ---
$customersQuery = @"
SELECT
    c.CUST_NO                                              AS [Customer #],
    LTRIM(RTRIM(COALESCE(c.FST_NAM, '') + ' ' + COALESCE(c.LST_NAM, ''))) AS [Name],
    c.CUST_NAM                                             AS [Business Name],
    c.EMAIL_ADRS_1                                         AS [Email],
    c.PHONE_1                                               AS [Phone],
    CASE WHEN c.NO_EMAIL = 'Y' THEN 1 ELSE 0 END            AS [Do Not Email],
    c.LST_SAL_DAT                                           AS [Last Sale Date]
FROM CM_CUST c
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
Dropbox" button will be able to pull it in.
