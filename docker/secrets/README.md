# Docker secrets

Files here are read by Docker Compose's `secrets:` block and mounted read-only
into containers at `/run/secrets/<name>`. Files with a `.txt` extension are
gitignored — never commit real secret values.

Required files (create before `docker compose up`):

- `db_password.txt` — Postgres superuser password (`DATABASE_USER`, "vigan" by
  default) — used only for migrations, never for regular app queries. Also
  reused as the MinIO root password for local dev.
- `session_secret.txt` — random value for signing server-side sessions
- `encryption_key.txt` — key for application-level column encryption (SSS/GSIS/PhilHealth)
- `cswd_staff_db_password.txt`, `agri_staff_db_password.txt`,
  `civil_registry_staff_db_password.txt`, `admin_db_password.txt`,
  `app_service_db_password.txt` — Phase 3 RBAC role passwords. The Phase 3
  migration creates these five Postgres LOGIN roles with a placeholder
  password; run `npm run db:provision-roles --workspace backend` (with
  `DATABASE_URL` set to the superuser connection) immediately after
  migrating to set the real ones from these files. Never leave a database
  reachable on the migration's placeholder passwords.

## Generate locally

PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/db_password.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/session_secret.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/encryption_key.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/cswd_staff_db_password.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/agri_staff_db_password.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/civil_registry_staff_db_password.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/admin_db_password.txt
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Out-File -NoNewline -Encoding ascii docker/secrets/app_service_db_password.txt
```

Node (recommended in Git Bash / WSL on Windows -- see note below):

```bash
for f in db_password session_secret encryption_key cswd_staff_db_password agri_staff_db_password civil_registry_staff_db_password admin_db_password app_service_db_password; do
  node -e "require('fs').writeFileSync('docker/secrets/${f}.txt', require('crypto').randomBytes(32).toString('base64'))"
done
```

macOS/Linux `openssl` also works, but **on Git Bash for Windows,
`openssl rand -base64 32 | tr -d '\n' > file` can leave a trailing `\r`
byte in the file** (an artifact of the pipe, invisible in a text editor).
That byte round-trips fine through Docker secrets read by app code (which
`.trim()`s it), but breaks any *native Windows* client reading the same
file's bytes into an env var (e.g. a Windows-built `psql`), which silently
drops the `\r` and sends a different password than what's stored — a
password mismatch that looks like "wrong password" with no obvious cause.
If you hit that, regenerate with the Node one-liner above instead.

```bash
openssl rand -base64 32 | tr -d '\n' > docker/secrets/db_password.txt
```

## Provisioning the RBAC role passwords

After `prisma migrate deploy` (which creates the roles with a placeholder
password) and before the database is reachable by anyone but you:

```bash
export DATABASE_URL="postgresql://vigan:<url-encoded-db_password>@localhost:<POSTGRES_PORT>/vigan_ucrms?schema=public"
cd backend
npm run db:provision-roles
```

## Key rotation (encryption_key.txt)

`encryption_key.txt` is what `backend/src/lib/encryption.ts` uses to encrypt
`person_sss_enc` / `person_gsis_enc` / `person_philhealth_enc` (AES-256-GCM,
key = SHA-256 of the secret file's contents). The running app only ever
holds one key at a time — swapping the file alone, without re-encrypting
existing rows first, makes every citizen's government IDs permanently
unrecoverable. **Never just replace `encryption_key.txt` once real data
exists.** Rotate in this order:

1. **Generate the new key** (same method as [Generate locally](#generate-locally) above), but don't touch `encryption_key.txt` yet:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **Dry-run the rotation** against the real database, with both keys as env vars — this decrypts every row with the old key and re-encrypts in memory, but writes nothing:
   ```bash
   cd backend
   OLD_ENCRYPTION_KEY="$(cat ../docker/secrets/encryption_key.txt)" \
   NEW_ENCRYPTION_KEY="<the new key from step 1>" \
   DATABASE_URL="<superuser connection string>" \
     npm run db:rotate-encryption-key -- --dry-run
   ```
   Confirms the *current* key is correct and every row is recoverable before committing to anything. If any rows fail here, stop — investigate before proceeding; a failure means either `encryption_key.txt` doesn't match what actually encrypted that row, or the data is corrupted.
3. **Run the real rotation** (same command, no `--dry-run`). Every row gets decrypted with the old key and re-encrypted with the new one, in place. The script reports how many rows were rotated and how many failed; a nonzero failure count means some rows are still on the old key — do not proceed to step 4 until that's zero.
4. **Only now** overwrite `encryption_key.txt` with the new key, and restart the backend (`docker compose up -d --build backend` or a full `docker compose restart backend`) so the running app picks it up.
5. **Verify**: open a citizen with government IDs on file (Citizen 360 view) as admin and confirm the values still display correctly. If they do, decommission the old key value (it no longer decrypts anything in the database).

This was dry-run and executed for real against seeded test data while building Phase 8 — decrypting the rotated rows with the *old* key afterward correctly fails, and with the *new* key correctly recovers the original plaintext, confirming the rotation genuinely re-encrypts rather than just relabeling them.

Rolling back a *bad* rotation (new key turns out to be wrong/lost before step 4): nothing to do — the live app is still using the old key until you complete step 4, so nothing is broken. If step 4 already happened and the new key is lost, the only recovery path is restoring `encryption_key.txt` from backup; there's no way to recover data encrypted under a truly lost key.
