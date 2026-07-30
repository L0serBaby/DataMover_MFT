# DataMover — Azure Blob Storage Profile Type (`azure-blob`)

**Status:** Spec / design. Not yet scheduled for build.
**Author:** Ben Bliss
**Last updated:** 2026-07-29

---

## 1. Purpose & driving use case

A data analyst needs to move data into **Databricks**, which ingests from an Azure Storage
account **blob container**. DataMover must be able to land files into that container and
read files back out of it.

Key facts about the target environment:

| Fact | Value |
|---|---|
| Storage account | `staldlsedadeveus` |
| Container | `eda-landing` |
| Protocol available | Blob REST/SDK only — **no SMB** on this account |
| Network | **Private endpoint only** — public network access fully disabled |
| DNS | Resolves correctly to the private IP from the DataMover host |
| Proven reachability | Confirmed — SAS-scoped URL tested working from Storage Explorer on a host with line of sight to the private endpoint, the same network path `srv_datamover` already uses |
| Direction | **Both** — `azure-blob` must work as source *and* destination |
| Scale | Expect **more analysts / more containers** over time |
| Consumer | Databricks, reading from / writing to this container |

**No firewall, DNS, or routing work is required for DataMover itself** — SAS auth traverses
the identical network path already proven.

Because more containers are coming, the profile type must make per-container onboarding
cheap and must not require a new identity object or a new code path per analyst.

---

## 2. Authentication decision

### 2.1 Chosen: container-scoped SAS token

DataMover authenticates using a **SAS token stored in the existing `credentials.enc`
store**. The SAS is appended as the query string on the container URL. No Entra ID token
acquisition, no `@azure/identity` dependency, no new identity object in the tenant.

```
https://<account>.blob.core.windows.net/<container>?<sasToken>
```

### 2.2 Rejected alternatives, and why

**Service principal + RBAC (`Storage Blob Data Contributor` scoped to the container)**
— technically the cleanest fit and matches the tight-scoping pattern used for the
SharePoint `Sites.Selected` profile. **Rejected** on exposure grounds: it creates a new
app registration / identity object in the tenant, which is the specific thing we're
avoiding here. Not rejected for capability reasons — revisit if the exposure posture
changes.

**Reuse `srv_datamover` (AD-synced service account)**
— **Not viable.** `srv_datamover` reaches Azure Files over classic SMB because Azure Files
supports AD DS Kerberos auth. Blob container access goes through the REST/SDK path, which
uses Entra ID **OAuth tokens** — Kerberos does not carry over. A synced AD account cannot
obtain a token non-interactively from a headless Windows Service without either a client
secret/certificate (i.e. an actual service principal) or a fragile IWA/ADFS setup.

**Storage account key**
— Works, no new identity object, but scope is the **entire storage account**, not one
container. Too broad given more analysts/containers are coming. **Rejected** on blast
radius. (Note: the account key is still involved indirectly — see §3.2, it is what *signs*
the SAS. It is never stored in DataMover.)

**Managed Identity**
— Requires the DataMover host to be an Azure resource. It is on-prem. Not applicable.

### 2.3 Consequence of the SAS choice

SAS tokens **expire**. That is the price of avoiding an identity object, and it makes
expiry tracking a first-class feature of this profile type rather than an afterthought.
See §6.

---

## 3. SAS token — generation, shape, and lifetime

### 3.1 Which SAS flavour

| Flavour | Signed by | Max lifetime | Verdict |
|---|---|---|---|
| **Service SAS (container-scoped)** | Storage account key | Unbounded | ✅ **Use this — confirmed working** |
| User delegation SAS | Entra user delegation key | **7 days (hard cap)** | ❌ Cannot meet a 1-year expiry |
| Account SAS | Storage account key | Unbounded | ❌ Scope is account-wide |

> ⚠️ **Important:** `az storage container generate-sas --auth-mode login --as-user`
> produces a **user delegation SAS**, which Azure caps at **7 days** regardless of the
> expiry requested or any account-level SAS expiration policy. A yearly-expiry SAS must be
> an **account-key-signed service SAS**. Any wizard output must use the key-signed form or
> the requested expiry is silently ineffective.

**Confirmed empirically on `staldlsedadeveus` / `eda-landing` (2026-07-29):** a key-signed
container service SAS with `se` one year out was generated via the Azure Portal GUI and
tested working against the private endpoint. Token shape:
`sp=racwdlme&st=…&se=2027-07-30T04:00:00Z&spr=https&sv=2026-02-06&sr=c&sig=…` — no
`skoid`/`sktid`/`ske` parameters, confirming account-key signing rather than user delegation.

This matters because an earlier reading of the account's posture suggested
`allowSharedKeyAccess` might be disabled at the data plane, which would have rejected
key-signed SAS (a service SAS *is* Shared Key authorization) and forced the 7-day user
delegation path. **The live test disproves that for this account** — key-signed service SAS
is accepted. Do not re-derive this from the account's key-auth posture; the empirical
result governs.

**Operational path for now:** the SAS is minted **manually via the Azure Portal GUI** and
the resulting URL is pasted into the DataMover profile. The wizard in §7 automates the
command generation later (Phase 4) but is not required for the first container.

### 3.2 Account key rotation invalidates the SAS

A service SAS is signed with `key1` or `key2`. **Rotating the signing key immediately
invalidates every SAS signed with it.** The Azure engineer must record which key signed
each SAS. The profile stores this as a note field (`sasMeta.signingKey`) purely for
operator reference — DataMover cannot determine it from the token.

### 3.3 Stored access policy (revocability) — trade-off to validate

Without a stored access policy, the **only** way to revoke a leaked SAS before expiry is
to rotate the account key, which nukes every other SAS signed with it.

A stored access policy on the container gives you a revocation handle: delete the policy,
the SAS dies, nothing else is affected. The trade-off is what lives in the token vs. the
policy:

| Approach | Revocable? | Expiry visible in token? |
|---|---|---|
| **A. Ad-hoc SAS** — `se`/`sp` embedded in token | ❌ only via key rotation | ✅ DataMover parses it |
| **B. Fully policy-backed** — `si=` only, policy holds `se`/`sp` | ✅ delete policy | ❌ operator must enter expiry manually |
| **C. Hybrid** — empty-bodied policy for revocation, `se`/`sp` still in token | ✅ delete policy | ✅ DataMover parses it |

**Preferred: C**, if it validates. The Azure constraint is that a given field may not be
specified in *both* the SAS and the policy — a policy carrying only an identifier, with
`se`/`sp` in the SAS, should be legal and is the documented revocation pattern.

> 🔬 **Must verify in tenant before building the wizard:** whether
> `az storage container generate-sas` accepts `--policy-name` together with `--expiry`
> and `--permissions`. If the CLI rejects the combination, fall back to **A** as the
> wizard default and offer **B** as an explicit "revocable" option, accepting the manual
> expiry entry.

### 3.4 SAS query parameters DataMover cares about

| Param | Meaning | DataMover use |
|---|---|---|
| `se` | Expiry, ISO-8601 | **Authoritative expiry** — drives §6 alerting |
| `st` | Start time | Displayed; warn if in the future (not yet valid) |
| `sp` | Permissions | Validate against intended role — see §3.5 |
| `sr` | Signed resource — `c` container, `b` blob | Must be `c`; reject `b` |
| `si` | Stored access policy id | If present and `se` absent → expiry is manual |
| `spr` | Allowed protocol | Warn if it permits `http` |
| `sip` | Allowed IP range | Displayed only; a mismatch here is a common failure cause |
| `sv` | Signed service version | Displayed only |
| `sig` | **Signature — the secret** | **Never logged, never returned by any API** |

### 3.5 Permission letters

Container service SAS permission set: `r` read, `a` add, `c` create, `w` write, `d` delete,
`x` delete-version, `l` list, `t` tags, `m` move, `e` execute, `i` set-immutability.

DataMover's minimum requirements by role:

| DataMover role | Required `sp` letters | Notes |
|---|---|---|
| Source, copy only | `rl` | list + read |
| Source, `move` action or `postTransfer: delete` | `rld` | needs delete |
| Source, `postTransfer: archive` | `rlcwd` | archive = copy + delete (no rename in blob) |
| Destination | `rcw` | `r` needed for post-upload size verification |
| Source + destination (both) | `racwdl` | recommended default |

The profile **test endpoint must parse `sp` and report the effective capability set**, so a
read-only SAS is caught at profile-save time rather than at 2am during a delivery.

---

## 4. Profile schema

Stored in `data/profiles.json` alongside existing `sftp` / `smb` / `local` profiles.

```jsonc
{
  "id": "0f2c…",                    // uuid, existing convention
  "name": "Databricks Landing",
  "type": "azure-blob",             // NEW type
  "favorite": false,

  // ── Connection ──────────────────────────────────────────────
  "accountName":  "stanalyticsprod01",
  "blobEndpoint": "https://stanalyticsprod01.blob.core.windows.net",
  "container":    "databricks-landing",
  "prefix":       "inbound/",       // profile base; analogous to sftp.remotePath
  "recursive":    false,            // see §5.2 — default false for SFTP parity

  // ── Credential ──────────────────────────────────────────────
  "credentialRef": "azureblob_0f2c…",   // SAS token lives in credentials.enc

  // ── SAS metadata (derived — see §6.1) ──────────────────────
  "sasMeta": {
    "source":        "parsed",          // "parsed" | "manual"
    "expiresAt":     "2027-07-29T00:00:00Z",
    "startsAt":      "2026-07-29T00:00:00Z",
    "permissions":   "racwdl",
    "resource":      "c",
    "policyId":      null,
    "protocol":      "https",
    "signedVersion": "2024-11-04",
    "ipRange":       null,
    "signingKey":    "key1",            // operator-entered reference only
    "parsedAt":      "2026-07-29T14:02:11Z"
  }
}
```

Notes:

- `blobEndpoint` is stored explicitly rather than derived from `accountName` so that
  sovereign clouds and private-DNS-zone hostnames work without code changes.
- `prefix` plays the role that `remotePath` plays for SFTP and `path` plays for local.
  A new `resolveBlobPrefix(profile, rulePath)` mirrors the existing `resolveSftpDir` /
  `resolveLocalDir` helpers, including the traversal guard from `resolveLocalDir`:
  a relative `rulePath` must not escape `profile.prefix`.
- `sasMeta` is **derived, never authoritative**. It is recomputed from the token on every
  save and on every scheduled expiry check. An operator editing `sasMeta.expiresAt` by hand
  on a parsed token is overwritten on next parse — intentional, prevents drift.

### 4.1 Credential handling

The SAS token is stored using the identical pattern to the SFTP password:
`POST /` and `PUT /:id` destructure `sasToken` out of the body (never persisting it into
`profiles.json`), write it to `credentials.enc` under `azureblob_${id}`, and set
`credentialRef`. `redact()` in `app/api/profiles.js` must be extended to strip `sasToken`
in addition to `password`.

`DELETE /:id` already removes the `credentialRef` entry from the store — no change needed.

---

## 5. Security requirements

These are non-negotiable and must be in place from Phase 1.

### 5.1 `sig=` redaction — the SAS leaks through error paths

The `@azure/storage-blob` SDK throws `RestError` objects whose `message` and `request.url`
contain the **full request URL including `sig=`**. Today those messages flow straight into
`logger.error(...)` and into `res.status(400).json({ error: err.message })`.

**Requirement:** a `redactSas(str)` helper that replaces the value of `sig`, and any other
`s*=` credential-bearing parameter, with `sig=***`. Every catch block around a blob
operation must pass through it before the message reaches a logger, an API response, a
`jobResult.errors` entry, or the job history file.

Applies to: `app/executor.js` blob primitives, `app/api/profiles.js` test/browse branches,
and `transferRule`'s error aggregation.

### 5.2 Blob name sanitization — path traversal

`sftpListFiles` routes every remote name through `sanitizeRemoteName()`, which **rejects
rather than rewrites** (see the comment at `app/executor.js:141`). The blob listing path
must do the same, with one adjustment: **blob names legitimately contain `/`** as virtual
directory separators, so a whole-name check would reject valid blobs.

**Requirement:** split the blob name (relative to prefix) on `/` and run
`sanitizeRemoteName()` on **each segment**. Any segment failing → reject the whole blob,
log a warning, and invoke the `onReject` callback exactly as `sftpListFiles` does. This
matters because `blobGetFile` derives a local staging path from the returned `relPath` — an
unsanitized `../../` segment is a write-anywhere primitive.

Additionally: enforce `assertWithin()` on the final resolved local destination as a second
layer, consistent with existing practice.

### 5.3 Browse endpoint confinement

`GET /:id/browse` confines local/SMB profiles to the profile root. The `azure-blob` branch
must apply the same rule against `profile.prefix` — a requested prefix must equal or be a
descendant of it, else `403`, matching the existing log line style.

### 5.4 No credentials in the UI

`GET /api/profiles` must never return the SAS token. The UI displays only `sasMeta` and a
`(stored — blank = keep)` placeholder, mirroring the SFTP password field.

---

## 6. SAS expiry tracking & alerting

### 6.1 Parse, don't ask

Expiry is parsed from the token's `se=` parameter at save time, **not** entered by the
operator. A hand-entered expiry field drifts out of sync the moment anyone reissues a
token, and a silently-wrong expiry is worse than no expiry.

`parseSasToken(sasToken)` → the `sasMeta` object in §4. Rules:

- Missing `se` **and** `si` present → policy-backed. Set `sasMeta.source = "manual"`,
  prompt the operator for the expiry, and surface a UI note that DataMover cannot verify it.
- Missing `se` **and** no `si` → invalid token, reject the save with a clear error.
- `sr` present and not `c` → reject; DataMover requires a container-scoped SAS.
- `st` in the future → save allowed, but flag "not yet valid" in the test result.

### 6.2 Alert thresholds

| Days remaining | Severity | Behaviour |
|---|---|---|
| ≤ 30 | `warn` | Daily log line; amber badge in UI profile list |
| ≤ 14 | `warn` | As above, plus flagged on the dashboard |
| ≤ 7 | `warn` | As above, escalated wording |
| ≤ 1 | `error` | Red badge; logged at error level |
| expired | `error` | Red badge; **rule pre-flight fails fast** — see §6.4 |

**Correction — no `settings.json` exists** (same correction already applied to §16.1/§16.2;
DataMover's user-facing config lives in flat keys in `data/config.json`, read via a small
local helper mirroring `app/scheduler.js`'s `_getScheduleTimezone()` — not routed through
`app/data.js`, which doesn't manage `config.json`). Thresholds live in a flat key
`AZURE_BLOB_SAS_WARN_DAYS` (default `[30, 14, 7, 1]`, an array) so they're tunable without a
code change.

### 6.3 Where the check runs

DataMover has **no email/SMTP subsystem** — `logger` (winston + daily rotate) and the UI are
the only alerting channels available today. Do not introduce an email dependency as part of
this work.

1. **Scheduler daily job** — a `node-cron` task registered in `app/scheduler.js`, separate
   from rule crons, running once daily (default `0 7 * * *`, same timezone resolution as
   `_getScheduleTimezone()`). It walks all `azure-blob` profiles, recomputes days-remaining,
   and emits `logger.warn` / `logger.error` lines in the existing
   `[scheduler] …` prefix style. This is what the log-monitoring tooling can alert on.
2. **`GET /api/profiles`** — include a computed `sasDaysRemaining` and `sasStatus`
   (`ok` | `warn` | `critical` | `expired`) on each `azure-blob` profile so the UI badge
   needs no extra round-trip.
3. **Profile test endpoint** — always reports expiry and permissions, even on success.

### 6.4 Pre-flight in `transferRule`

Before any blob operation, if `sasMeta.expiresAt` is in the past, fail the rule immediately
with an explicit message (`SAS token for profile "X" expired on <date>`) rather than letting
it surface as an opaque `403 AuthenticationFailed` from the SDK. If expiry is within the
warning window, push an advisory string onto `jobResult.errors` without failing the job.

The distinction matters operationally: an expired SAS looks identical to a firewall block in
raw SDK output, and that is exactly the kind of thing that burns an hour at 2am.

---

## 7. SAS-generation wizard — Portal checklist, not a CLI generator

**Redesigned 2026-07-29.** Originally spec'd as a wizard that emitted a copyable `az`
command. In practice, SAS tokens for this account are minted by hand in the **Azure Portal**
— `az` CLI was never part of the actual workflow (Phase 1's confirmed-working token, §3.1,
was portal-generated). Rethought here rather than carried forward unchanged.

The redesign doesn't reduce the wizard's reason for existing: the two failure modes it was
built to prevent are equally present in the Portal's container-level **Generate SAS** blade,
just as UI elements instead of CLI flags. Verified against Microsoft's own walkthrough of
that exact blade (2026-07-29):

- **Signing method: Account key vs. User delegation key.** This is the Portal's version of
  `--as-user`. Microsoft's own documentation for this blade *defaults its example to* "User
  delegation key" — which caps at 7 days regardless of the expiry entered, identically to
  §3.1's CLI finding. An operator following generic Microsoft docs instead of this checklist
  will hit the same trap DataMover's design has been avoiding since Phase 1.
- **Permissions checkboxes** are the Portal's `sp=`. Same over/under-granting risk as before,
  just clicked instead of typed.

What has changed since the wizard was first spec'd: `parseSasToken()` and
`POST /:id/test` (Phase 1) now catch a wrong signing method or missing permission *after*
the token is pasted — sasMeta.kind reports `'user-delegation'` if the trap was hit, and the
test endpoint's capability report catches missing permissions before a rule ever runs. So
the wizard's job shifts from "prevent the mistake" (now partly enforced automatically) to
"make the correct values fast to find" — still worth having, lower stakes than originally
framed.

### 7.1 Purpose

Same driver as before: the Azure engineer and the DataMover operator are frequently the same
person but not always, and the SAS must be regenerated at least yearly. The wizard removes
the recall burden of the exact permission letters and the signing-method trap, now expressed
as portal field values rather than CLI flags.

### 7.2 Behaviour

A **Generate SAS checklist** button in the `azure-blob` profile modal opens a small form —
same inputs as originally spec'd, since the role/expiry/revocability questions don't change
with the output format:

| Input | Default | Notes |
|---|---|---|
| Container name | from profile | Displayed only — confirms the operator is in the right blade |
| Intended role | Source + Destination | Drives the permission checkboxes per §3.5 |
| Expiry | today + 1 year | Date picker |
| Restrict to source IP | off | Optional; warn that NAT egress must be stable |

**Dropped from the original design:** the "revocable via stored access policy" toggle.
Unlike the CLI's `--policy-name` flag, it is not confirmed whether the Portal's
container-level **Generate SAS** blade (distinct from the container's separate **Access
policy** blade) even supports binding a SAS to a named policy — I have not verified this
against the actual blade and won't spec a UI element for a capability I haven't confirmed
exists. Matches §13's existing open question #2, still not blocking: the current token is
ad-hoc, revisit if/when revocability becomes a live need.

The wizard **renders a checklist of exact values for each Portal field, in the order they
appear in the blade, and nothing else.** It does not execute anything, does not need Azure
credentials, and DataMover never touches the account key. The operator opens the container's
**Generate SAS** blade in a separate tab, works down the checklist, and pastes the result
back into DataMover.

### 7.2a Redesigned again, 2026-07-29 — one paste, not three fields

The profile UI originally asked for `blobEndpoint`, `container`, and the SAS token as three
separate inputs, requiring the operator to manually split the Portal's output apart. Since
the Portal's **Blob SAS URL** field already contains all three
(`https://account.blob.core.windows.net/container?sp=...&sig=...`), DataMover now asks for
that single URL and derives `blobEndpoint` (the origin), `container` (the one path segment),
and the SAS token (everything after `?`) from it server-side — see the new `splitSasUri()`
in `app/executor.js`. **This reverses §7.6's original guidance**: the operator now copies
the **Blob SAS URL**, not the bare **Blob SAS token** — the token alone no longer carries
enough information to populate the profile. `prefix`/`recursive`/`archiveMode` remain
separate fields; they aren't part of the SAS grant.

### 7.3 Checklist — full source + destination + archive (the common case)

Field order and names verified against the Portal's container-level Generate SAS blade
(Microsoft Learn, 2026-07-29):

| Portal field | Value | Why |
|---|---|---|
| **Signing method** | **Account key** — *not* User delegation key | The trap (§7, above). Get this one wrong and every other value is moot — expiry silently caps at 7 days. |
| **Permissions** | check: Read, Add, Create, Write, Delete, List, Move, Execute | Full source+destination+archive set per §3.5 (`racwdlme`). Leave Delete version, Set Immutability Policy, Permanent Delete unchecked — not used. |
| **Start** | leave default, or today | |
| **Expiry** | today + 1 year | Only unbounded when Signing method is Account key (confirmed above) — this is *why* that field matters. |
| **Allowed IP addresses** | leave blank | Unless pinning egress IP — see the "Restrict to source IP" wizard input |
| **Allowed protocols** | HTTPS only | Default, but confirm — do not leave it at "HTTPS and HTTP" |
| **Signing key** | Key1 *(or Key2 — operator's choice)* | **Record whichever you pick** — rotating that key invalidates every SAS signed with it. Enter it in the profile's `signingKey` field after saving. |

Then: **Generate SAS token and URL** → copy the **Blob SAS URL** field (per §7.2a — reversed
from this checklist's original guidance). DataMover now derives the account endpoint and
container from that URL automatically; pasting the bare **Blob SAS token** instead will be
rejected with a clear error, since it no longer carries enough information on its own.

### 7.4 Checklist — narrower roles

Same table, permissions row only, per §3.5:

| Role | Check | Leave unchecked |
|---|---|---|
| Source, copy only | Read, List | Add, Create, Write, Delete, Move, Execute |
| Source, `move`/`delete` disposition | Read, List, Delete | Add, Create, Write, Move, Execute |
| Source, `postTransfer: archive` (this account, DFS available) | Read, List, Add, Create, Write, Delete, Move | Execute |
| Destination only | Read, Add, Create, Write | Delete, List, Move, Execute |

### 7.5 Recommended hardening (small, independent of the wizard UI)

Worth doing regardless of when Phase 4 ships, since it's cheap and directly addresses the
mis-paste risk in §7.3: harden `parseSasToken()` to detect a full URL (string starts with
`http`) and strip everything up to and including the first `?` before parsing, rather than
throwing an unhelpful "missing se/si" error. Backward compatible — bare query strings
(with or without a leading `?`) are unaffected. Small, isolated change to already-shipped,
already-tested code; would need one new test case in `tests/azure-blob.test.js`. Flagging
as a candidate for a quick standalone patch rather than bundling it into the larger Phase 4
UI effort, if that's preferred.

### 7.6 Warnings rendered alongside the checklist

- **Signing method must be Account key.** If it's already User delegation key when the
  blade opens (Microsoft's own walkthrough defaults its example there), change it first —
  every other value on this checklist depends on that choice.
- Account key requires the operator to hold Storage Account Key Operator rights or have the
  key available; the key itself is never entered into DataMover — only its identifier
  (Key1/Key2) is recorded, for the rotation-tracking reason above.
- Copy the **Blob SAS URL**, not the bare **Blob SAS token** (§7.2a/§7.3 — reversed from
  this section's original guidance once DataMover started deriving endpoint/container from
  the URL automatically).
- The Blob SAS URL value is shown once and cannot be retrieved after the blade closes —
  save it immediately.

### 7.6 Renewal path

When a SAS is renewed, the operator pastes the new token; save re-runs `parseSasToken`,
`sasMeta` is recomputed, and the badge clears. No other profile edit is required, and no
rule needs touching.

---

## 8. Azure-side setup (what the Azure engineer does)

1. Confirm the container exists and note the exact name.
2. Confirm private endpoint + private DNS zone resolve from the DataMover host —
   **already proven** for this account via Storage Explorer. SAS auth uses the same network
   path as the existing access, so **no firewall, DNS, or routing change is required**.
3. Run the wizard-emitted `az` commands (§7.3) to create the policy and mint the SAS.
4. Hand the token to the DataMover operator over a secure channel — **not chat or email**.
5. For each future analyst/container: repeat steps 1–4 only. No new identity object, no new
   app registration, no code change, no DataMover restart.

**Hierarchical namespace: CONFIRMED ENABLED** (`isHnsEnabled = true`). This account is
ADLS Gen2, not flat blob storage. See §15 for the full set of consequences — it affects
already-landed code, not just Phase 2.

---

## 9. Runtime / environment notes

- **Proxy:** the Windows service runs under `srv_datamover`. If `HTTP_PROXY` /
  `HTTPS_PROXY` are set in that account's environment, the Azure SDK will honour them and
  may route private-endpoint traffic to the proxy, where it will fail confusingly. Verify
  `NO_PROXY` covers `*.blob.core.windows.net` or that no proxy is set. Worth an explicit
  line in the test-connection failure hint text.
- **No connection pooling.** `ContainerClient` is a stateless HTTP client; construct it per
  call. The existing `pool` Map threaded through `transferRule` is SFTP-specific and blob
  code should not populate it.
- **Atomicity.** Blob uploads commit via `PutBlockList`, so a blob is not visible to a
  consumer until the upload completes. **Do not implement the `.tmp` + rename pattern used
  by `sftpPutFile`** — blob has no atomic rename (rename = server-side copy + delete), and
  the tmp dance would add a failure mode while removing nothing. Upload direct to the final
  name; verify size via `getProperties()`; delete the blob on mismatch before throwing.
- **New dependency:** `@azure/storage-blob` only. **Not** `@azure/identity` — there is no
  Entra token flow in this design.

---

## 10. Primitives (Phase 1 surface)

Placed in `app/executor.js` beside the SFTP section (`getSftpClient` / `sftpListFiles` /
`sftpGetFile` / `sftpPutFile`), following the same conventions: byte-count verification,
`[executor] …` log prefixes, throw-with-context on mismatch.

| Function | Contract |
|---|---|
| `getBlobContainerClient(profile)` | Resolves SAS via `resolveCredential(profile.credentialRef)`; returns a fresh `ContainerClient`. No pooling. |
| `blobListFiles(cc, prefix, filter, onReject)` | Enumerates blobs; per-segment sanitization (§5.2); `matchesGlob` on the name; returns the **same shape as `sftpListFiles`**: `{ name, path, relPath, size, mtime }`. |
| `blobGetFile(cc, blobName, localDest, expectedSize)` | `downloadToFile()` → `${localDest}.tmp`, verify size, `renameWithRetry` to final. Mirrors `sftpGetFile` exactly. |
| `blobPutFile(cc, localSrc, blobName)` | `uploadFile()` direct to final name, verify via `getProperties()`, delete blob + throw on mismatch. **No tmp/rename** (§9). |
| `blobDeleteFile(cc, blobName)` | `deleteIfExists()`; silent success if already gone, matching `deleteFile()`. |
| `parseSasToken(token)` | → `sasMeta` (§6.1). Pure function, unit-testable, no network. |
| `redactSas(str)` | → string with `sig=***` (§5.1). Pure function, unit-testable. |
| `resolveBlobPrefix(profile, rulePath)` | Mirrors `resolveSftpDir` / `resolveLocalDir`, with the traversal guard. |

### 10.1 Recursion parity

`listBlobsFlat()` is **recursive over the whole subtree**. `sftpListFiles` is
**single-level** (it skips directory entries via `e.type !== '-'`), and `listLocalFiles`
follows the existing local convention. A naive `listBlobsFlat` is therefore **not** a
drop-in replacement and would silently widen the file set of any rule pointed at it.

**Requirement:** honour `profile.recursive` (default `false`). When `false`, use
`listBlobsByHierarchy('/', { prefix })` and take only the blob items, ignoring
`BlobPrefix` entries. When `true`, use `listBlobsFlat({ prefix })` and preserve the
subdirectory structure in `relPath`.

---

## 11. `transferRule` integration points (Phase 2)

`transferRule` currently branches binary: `type === 'sftp'` vs. everything-else-is-local.
`azure-blob` falls into the *local* branch everywhere and will fail in non-obvious ways.
Each of these must be handled:

| Location | Current behaviour | Required change |
|---|---|---|
| `executor.js:506` source listing | `if (srcProfile.type === 'sftp') … else listLocalFiles` | Add `azure-blob` branch using `blobListFiles` |
| `executor.js:547` date filter | `isSftp ? file.mtime : fs.statSync(file.path)` | `file.path` is a **blob name**, not a local path — `statSync` throws. Generalise `isSftp` → `isRemote` and use `file.mtime` for blob. |
| `executor.js:605` dest path build | `destProfile.type === 'sftp' ? posix : win32` | Blob uses **posix-style** `/` joins — must not go down the win32 branch |
| `executor.js:613` destination delivery | sftp put vs. local copy | Add `blobPutFile` branch |
| `executor.js:656/750/790/821` staging fetch | `sftpGetFile` vs. local read | Add `blobGetFile` branch (PGP, zip, bundle-zip, and plain paths) |
| `executor.js:447` `deleteSourceFile` | sftp delete vs. `deleteFile` | Add `blobDeleteFile` branch |
| `executor.js:456` `archiveSourceFile` | sftp `rename` vs. local `moveFile` | Blob API has no rename → archive = `startCopyFromURL` to `_archive/<name>`, poll to completion, verify, then delete source. Needs `c`+`w`+`d` in `sp`. **But this account is HNS — a real atomic rename exists over the DFS endpoint. See §15.4 before implementing.** |
| `executor.js:895/907/918` direct-path optimisation | local→sftp and sftp→sftp fast paths | Decide: add blob fast paths, or explicitly exclude blob so it always takes the staged path. **Recommend excluding initially** — fewer branches, correctness first. |

Also: pre-flight SAS expiry check per §6.4, and `redactSas` on every error pushed into
`jobResult.errors`.

---

## 12. Phase plan

Wiring all of §11 in a single change is high-risk given how many branch points
`transferRule` has. Split:

**Phase 1 — primitives + profile CRUD. ✅ LANDED 2026-07-29** — see §14 for what shipped and
the carry-forward items. `@azure/storage-blob@^12.33.0` dependency, the eight functions in
§10, credential storage, `POST /:id/test` and `GET /:id/browse` branches, `parseSasToken` +
`redactSas` with 18 unit tests in `tests/azure-blob.test.js`. No `transferRule` changes.

**Phase 2a — `transferRule` wiring, everything except archive. ✅ LANDED 2026-07-29** —
see §17. `isSftp` → `isRemote` date-filter generalisation, source listing, SAS pre-flight,
eager blob-source staging, destination delivery (both call sites), delete-only rules.
`postTransfer: 'archive'` on an azure-blob source throws an explicit not-yet-supported
error.

**Phase 2b — archive (§16): DFS rename with runtime capability detection, copy+delete
fallback, idempotency guard. ✅ LANDED 2026-07-29** — see §18. Both `blob` and `dfs`
private endpoints are confirmed present on this account (§16.7), so the happy path
resolves to atomic `.move()` on first probe; the copy+delete fallback is fully implemented
and tested for containers that don't follow that pattern.

**Phase 3 — expiry tracking & alerting. ✅ LANDED 2026-07-29** — see §19. Scheduler daily
check, `sasStatus`/`sasDaysRemaining` on `GET /api/profiles`, `status` on the test endpoint,
and the deferred advisory half of `transferRule`'s pre-flight (§6.4). UI badges are Phase
4's job, not built here — this phase only made the data available.

**Phase 4 — UI. Drafted, not yet sent.** Profile modal `azure-blob` pane (mirroring the
`#pm-sftp` pane in `app/ui/app.js`), `sasMeta`/`sasStatus` display, `openFolderBrowser`
blob-path wiring, and the Portal SAS-generation checklist from §7 (redesigned from an `az`
CLI generator — see §7 for why). Known gap already flagged in that prompt: no field exists
yet to persist the operator-entered `sasMeta.signingKey` (§4's schema has always included
it, but nothing in `POST`/`PUT /api/profiles` accepts it — confirmed absent from
`app/api/profiles.js` on review). Phase 4 explicitly punts on adding it; whoever picks it
up next should decide whether to fold it in there or treat it as a small standalone patch.

**No Phase 5 is currently spec'd.** Once Phase 4 lands, the four-phase plan from §12 is
complete. Remaining known gaps, none blocking: the `signingKey` field above; §13's open
questions #3 (Databricks marker-file convention, if their read pattern needs one — not
confirmed either way) and #4 (multi-container-per-profile, revisit only if the one-profile-
per-container model stops scaling); and §15.3's cross-API overwrite conflict (Databricks
ABFS writes vs. DataMover's blob-endpoint overwrite), for which the documented mitigation is
a deployment convention (separate read/write prefixes) rather than a code change, and Phase
2a never explicitly confirmed that convention was communicated to the analyst — worth a
one-line check when this container goes live rather than a build task.

Phases 3 and 4 are independent of each other and can be reordered.

---

## 13. Open questions

1. ~~**HNS enabled?**~~ **ANSWERED 2026-07-29: yes, `isHnsEnabled = true`.** Consequences
   are written up in §15. The `m`/`e` letters in `sp=racwdlme` were the tell.
   ~~**Does a `dfs` sub-resource private endpoint exist?**~~ **ANSWERED 2026-07-29: yes —
   both `blob` and `dfs` private endpoints are standard practice on this account and
   containers provisioned like it.** Archive design no longer depends on this answer either
   way (§16 resolves it at runtime via capability detection), but confirmed presence means
   the atomic-rename path is expected to be the common case. See §16.7.
2. **Stored access policy + explicit expiry** — does `az storage container generate-sas`
   accept `--policy-name` alongside `--expiry`/`--permissions`? (§3.3) Determines whether
   the wizard defaults to option C or falls back to A. Not blocking: the current token is
   ad-hoc (no `si=`), so revocation today is key-rotation only. Revisit when these
   proliferate — a policy cannot be retrofitted onto an already-signed token.
3. **Databricks read pattern** — Auto Loader / file notification, or scheduled directory
   listing? If notification-based, DataMover's write pattern is fine as-is (blob commit is
   atomic); if it polls with a `_SUCCESS`-marker convention, DataMover may need to write a
   marker blob after the batch, which is a rule-level feature not yet in scope.
4. **Multiple containers, one profile or many?** Current design is one profile per
   container, which keeps SAS scope tight and matches the onboarding story. Confirm that's
   acceptable as analyst count grows, or whether a profile should carry several containers.
5. **Egress IP stability** — worth pinning `--ip` on the SAS as defence in depth? Only if
   the DataMover host's NAT egress address is stable and documented.

---

## 14. Phase 1 — landed 2026-07-29

### 14.1 What shipped

- `package.json` — `@azure/storage-blob@^12.33.0`. No `@azure/identity`, as specified.
- `app/executor.js` — new Azure Blob section beside the SFTP primitives:
  `redactSas`, `parseSasToken`, `resolveBlobPrefix`, `getBlobContainerClient`,
  `blobListFiles`, `blobGetFile`, `blobPutFile`, `blobDeleteFile`. All exported.
  SDK errors are re-thrown through `redactSas` at every call site.
- `tests/azure-blob.test.js` — 18 tests, registered in `run-all.js`. Covers sig redaction
  against a realistic `RestError`-shaped message, ad-hoc / policy-backed / invalid SAS
  parsing, and prefix traversal rejection.
- `app/api/profiles.js` — `redact()` strips `sasToken`; `POST`/`PUT` persist the token to
  `credentials.enc` under `azureblob_<id>` and store derived `sasMeta`; `POST /:id/test`
  reports expiry / capabilities / `notYetValid` with proxy and expiry hints on failure;
  `GET /:id/browse` uses `listBlobsByHierarchy` under the same root-confinement rule as
  local/SMB, scoped to `profile.prefix`.

**Accepted deviation:** §10 documents `blobListFiles(cc, prefix, filter, onReject)` while
§10.1 requires `recursive` be passed in rather than read from the profile. Resolved by
appending `recursive = false` as a fifth parameter — documented shape preserved, injection
requirement satisfied. This spec is hereby amended to that five-argument signature.

### 14.2 Carry-forward — ✅ ALL RESOLVED IN PHASE 1.5 (2026-07-29)

Every item below was fixed and verified by reading the landed code. See §14.4 for the
resulting signature changes. Retained here as the rationale record — the *why* is worth
keeping even though the *what* is done.

**a. `assertWithin` in `blobGetFile` is vacuous.** It is called as
`assertWithin(path.dirname(localDest), localDest)`, which asks whether a path sits inside
its own parent directory — always true, so the check can never fire. The intent (§5.2) was
a second layer of traversal defence against the **staging root**. Fix: thread the staging
root in as a parameter and assert against that. Primary defence (per-segment
`sanitizeRemoteName`) is intact and does reject `..`, so this is defence-in-depth that is
currently absent rather than an open hole — but it should not be left believed-present.

**b. Filter semantics diverge from SFTP in recursive mode.** `sftpListFiles` applies
`matchesGlob` to the bare filename; `blobListFiles` applies it to `relPath`. With
`recursive = false` these are identical. With `recursive = true`, `matchesGlob` compiles
`*` to `[^/]*`, so a filter of `*.csv` will **not** match `sub/dir/file.csv` and the rule
silently transfers zero files. This matches the `listLocalFiles` convention (which also
matches on relative path and enables recursion only when the filter contains `**`) rather
than the SFTP one. Defensible, but it means a filter that works against an SFTP profile can
return nothing against a recursive blob profile. Document in the UI when Phase 4 lands, and
cover with a Phase 2 test.

**c. Error wrapping discards `statusCode`.** `throw new Error(redactSas(err.message))`
drops `err.statusCode` and `err.details`. Phase 3 alerting needs to distinguish a 403 from
an expired SAS versus a network/proxy failure — reattach `statusCode` onto the new Error.

**d. Test endpoint enumerates the entire container.** `POST /:id/test` calls
`blobListFiles` with no cap. On `eda-landing` with production Databricks volumes this could
enumerate a very large number of blobs and time out the request. Cap it — take the first
page only via `byPage({ maxPageSize: 5 })` — since the endpoint only needs to prove
connectivity, not inventory.

**e. `parseSasToken` has no user-delegation handling.** No `skoid` / `sktid` / `ske`
parsing. Inert today because this account uses key-signed SAS (§3.1), but if a
user-delegation token is ever pasted, `sasMeta.expiresAt` will over-report: the effective
expiry is `min(se, ske)`, because the token dies when the delegation key expires regardless
of `se`. One-line guard worth adding opportunistically.

**f. HNS directory entries leak into recursive listings — see §15.1.** `blobListFiles` with
`recursive = true` uses `listBlobsFlat`, which on an HNS account returns **directories as
well as blobs**. They will be handed to `blobGetFile` as if they were files. This is a
confirmed defect in landed code, not a theoretical one. Fix before Phase 2.

### 14.4 Phase 1.5 — landed 2026-07-29

All six §14.2 items resolved. 20 new tests (38 total in `tests/azure-blob.test.js`), using
fake `ContainerClient` / `BlockBlobClient` stubs — no live container required.

**Signature changes — Phase 2 must honour these:**

```js
blobListFiles(containerClient, prefix, filter, onReject, recursive = false, limit = 0)
blobGetFile(containerClient, blobName, localDest, expectedSize, stagingRoot)  // stagingRoot REQUIRED
wrapBlobError(err)                                                            // new, exported
```

- `blobGetFile` **throws if `stagingRoot` is omitted** — deliberate, so Phase 2 cannot
  silently reintroduce the vacuous-guard gap. Every Phase 2 call site must pass the staging
  directory it is writing into (`workDir` or the destination root, as applicable).
- `blobListFiles` `limit` breaks out of the async iterator on reaching the accepted-result
  count; it does not enumerate then slice. `limit = 0` (default) is unlimited, so existing
  semantics are preserved.
- `wrapBlobError` replaces every `new Error(redactSas(err.message))` and carries
  `statusCode` / `code` / `errorCode` / redacted `details`. Phase 3 alerting should branch
  on `statusCode === 403` to separate an expired-or-insufficient SAS from a network or proxy
  failure. Note it deliberately **drops** `details` rather than risk propagating an
  unredacted copy if the value is not JSON-round-trippable.

**`sasMeta` gained fields:** `kind` (`'service'` | `'user-delegation'`),
`delegationKeyExpiresAt`, `delegationObjectId`, `delegationTenantId`,
`delegationKeyStartsAt`, `delegationKeyService`, `delegationKeyVersion`. `expiresAt` is now
the **effective** expiry, `min(se, ske)`. For the current key-signed token `kind` is
`'service'` and every delegation field is null.

**`POST /:id/test` response changed:** now `{ ok, sampled, sas }` — `sampled` is a bounded
sample count (5), **not** a container total. Any Phase 4 UI must not label it "files in
container."

### 14.3 Pre-existing test failures

The full suite passes except `listFiles returns [] for missing directory` in
`executor.test.js` and two flaky PGP key-store tests. Verified failing identically on `main`
prior to this work — unrelated. The real-`data/`-directory tripwire passed.

---

## 15. Hierarchical namespace (ADLS Gen2) — confirmed enabled

`isHnsEnabled = true` on `staldlsedadeveus`. The container is a real filesystem with
directories as first-class objects, not a flat keyspace with virtual prefixes. DataMover
talks to it over the **Blob endpoint**, which is supported and works, but several Blob API
behaviours change. All of the following are documented Microsoft behaviour, not inference.

### 15.1 `List Blobs` without a delimiter returns directories as well as blobs

> "When you use the List Blobs operation without specifying a delimiter, the results include
> both directories and blobs. If you choose to use a delimiter, use only a forward slash
> (`/`). This is the only supported delimiter."

**This is a live defect in Phase 1 code** (§14.2f). `blobListFiles` with `recursive = true`
calls `listBlobsFlat` — no delimiter — so on this account it returns directory entries
alongside files. Those entries flow into the result array with a `size` and an `mtime`, get
handed to `blobGetFile`, and the download fails or produces a zero-byte artefact.

**Fix:** in the `recursive = true` branch, skip any entry whose
`metadata.hdi_isfolder === 'true'`, and defensively also skip entries whose name ends in
`/`. Requires `{ includeMetadata: true }` on the `listBlobsFlat` options, which is not
currently passed. Add a test that asserts a folder-marker entry is excluded.

The `recursive = false` branch is **unaffected** — it uses `listBlobsByHierarchy('/', …)`,
which supplies the one supported delimiter and already filters on `item.kind !== 'blob'`.

### 15.2 `Delete Blob` cannot delete a non-empty directory

> "If you use the Delete Blob API to delete a directory, that directory is deleted only if
> it's empty. This means that you can't use the Blob API delete directories recursively."

`blobDeleteFile` targets files, so normal operation is fine. But Phase 2's `postTransfer:
delete` and any future cleanup logic must not assume directory removal works. If empty
source directories need pruning, that requires the DFS endpoint (§15.4).

### 15.3 Cross-API write conflict — the sharp edge for bidirectional use

> "You can't use blob APIs, NFS 3.0, and Data Lake Storage APIs to write to the same
> instance of a file… Blobs that are created by using a Data Lake Storage operation such as
> the Path - Create operation can't be overwritten by using PutBlock or PutBlockList
> operations, but they can be overwritten by using a PutBlob operation subject to the
> maximum permitted blob size."

Databricks writes via ABFS, which is the **DFS/Data Lake API**. DataMover writes via
`@azure/storage-blob`'s `uploadFile()`, which uses a single `Put Blob` for smaller files but
switches to staged `PutBlock` + `PutBlockList` above its block-blob threshold (256 MiB).

**Therefore: DataMover overwriting a Databricks-written file will succeed for small files
and fail for large ones.** This only bites on overwrite of a DFS-created path — first
writes to a new blob name are unaffected.

Mitigations, in order of preference:

1. **Avoid overwrite by convention** — land into a DataMover-owned prefix that Databricks
   only reads from, and have Databricks write outputs to a different prefix. Cleanest, and
   it matches how the analyst is actually using the container.
2. **Delete-then-write** on the destination when the target blob exists, converting an
   overwrite into a create.
3. Raise `uploadFile`'s single-shot threshold — fragile, caps out at the Put Blob limit.

Decide this in Phase 2 when the destination-delivery branch is written. Option 1 needs no
code and should be the documented deployment pattern.

### 15.4 Atomic rename exists on HNS — but needs the DFS endpoint

§11 states "blob has no rename, archive = copy + delete." **That is true of the Blob API but
not of ADLS Gen2**, which has a real atomic rename (`Path - Update` with a rename source),
exposed as `DataLakeFileClient.move()` in `@azure/storage-file-datalake`. The existing SAS
already carries `m` (move), so permissions are not the obstacle.

The obstacle is networking. ADLS Gen2 private endpoints have **two sub-resources, `blob` and
`dfs`**, and Microsoft is explicit that operations such as managing ACLs and creating or
deleting directories require the **DFS** private endpoint; only creating both guarantees all
operations succeed. Our current end-to-end proof used the **blob** endpoint only. Both are
now confirmed present (§16.7).

**Correction, corrected again — SDK method is `.move()`, not `.rename()`.** An earlier pass
on this spec "corrected" this to `.rename(destinationPath)` based on a web search of
Microsoft Learn — that was wrong, and the search result was almost certainly conflating the
**.NET** SDK's `DataLakeFileClient.Rename()`/`RenameAsync()` with the **JavaScript** SDK,
which has no such method. Verified 2026-07-29 directly against the installed package's type
definitions (`node_modules/@azure/storage-file-datalake@12.31.0/dist/commonjs/clients.d.ts`):
`DataLakePathClient` exposes `move(destinationPath: string, options?: PathMoveOptions):
Promise<PathMoveResponse>` (same-filesystem overload) — no `.rename()` exists anywhere on
the client. `destinationPath` is relative to the filesystem root (e.g. `"newdir/hi.txt"`),
not including the filesystem/container name. The container-scoped service SAS already in
use is valid against both the `blob` and `dfs` endpoints on the same account — no separate
DFS-specific SAS is needed. Lesson: a web-search "correction" to spec/API details should be
checked against the actually-installed package before being trusted, not just against
search snippets that may span multiple language SDKs.

**Open question (§13.1):** does a `dfs` private endpoint + matching private DNS zone
(`privatelink.dfs.core.windows.net`) exist for this account?

- **If yes** — Phase 2 archive should use `move()`: atomic, no data copied, no partial
  state, and it removes the copy-poll-verify-delete sequence entirely. Cost is a second SDK
  dependency (`@azure/storage-file-datalake`) and a second endpoint in the profile.
- **If no** — stay on copy + delete over the Blob API as originally spec'd, and **do not**
  add the DFS dependency. Everything DataMover needs (list, read, write, delete-file) works
  over the blob endpoint alone.

**Recommendation: stay Blob-only unless the DFS private endpoint already exists.** Requesting
new private-endpoint infrastructure to make archive marginally nicer is not a good trade,
and copy+delete is correct, just less elegant.

### 15.5 ACLs do not apply to a SAS-authorized caller

On HNS, POSIX ACLs govern access for Entra security principals. A request authorized with
Shared Key — which a key-signed service SAS is — is treated as a superuser and **bypasses
ACL evaluation entirely**. No ACL configuration is required for DataMover, and none should
be attempted as a scoping mechanism; the SAS grant is the whole access boundary.

This is worth stating explicitly because it cuts the other way too: **ACLs cannot be used to
narrow the SAS.** If a future container needs finer scoping than "everything this SAS can
reach," that argues for the service-principal + RBAC + ACL model (§2.2), not for layering
ACLs under a SAS.

### 15.6a Archive strategy must not depend on knowing the answer

Superseded by §16 — the DFS-vs-Blob archive decision is resolved at **runtime**, not at
design time. Do not gate Phase 2 on confirming the private-endpoint topology.

### 15.6 Unaffected

Phase 1's read/write/list/delete-file primitives are correct against HNS over the Blob
endpoint. `listBlobsByHierarchy('/')`, `downloadToFile`, `uploadFile`, `getProperties`, and
`deleteIfExists` on file paths all behave as specified. The `sr=c` container-scoped SAS is
equally valid on an HNS account. Nothing in §5 (security) or §6 (expiry) changes.

---

## 16. Archive strategy — endpoint-agnostic, resolved at runtime

**Requirement:** archive must work whether or not a `dfs` sub-resource private endpoint
exists, without anyone having to know which is true in advance, and must fail with a
diagnosable error rather than a hang or a silent no-op.

The account is known to have **four private-endpoint links**. Storage sub-resources are
`blob`, `dfs`, `file`, `queue`, `table`, `web` — four links means `dfs` is plausibly but
not certainly present. Rather than resolve this by inspection, DataMover resolves it by
**capability detection at runtime**, which also survives the topology changing later or
differing between containers and environments.

### 16.1 Three layers

**Layer 1 — declared mode.** New profile field:

```jsonc
"archiveMode": "auto"   // "auto" | "rename" | "copy-delete"
```

- `auto` (default) — detect, prefer `rename`, fall back to `copy-delete`
- `rename` — force DFS rename; **fail loudly** if unavailable. For environments that have
  confirmed the DFS endpoint and want the atomic guarantee enforced rather than silently
  degraded.
- `copy-delete` — force the Blob-only path. Skips all probing, zero DFS dependency.

An operator who knows their topology can pin it and never pay for detection. An operator
who doesn't gets a working system.

**Layer 2 — cached capability probe.** Stored on the profile, refreshed by
`POST /:id/test` and computed lazily on first archive if absent:

```jsonc
"capabilities": {
  "dfsReachable": true,
  "probedAt":     "2026-07-29T14:02:11Z",
  "reason":       null          // populated with the classification when false
}
```

**Correction — DataMover has no `settings.json`; user-facing config lives in flat keys in
`data/config.json`** (see `app/scheduler.js`'s `SCHEDULE_TIMEZONE` for the existing
convention: a small local read helper with a default, not routed through `app/data.js`
since `config.json` isn't in its managed-file set). Cache TTL: `AZURE_BLOB_CAPABILITY_TTL_HOURS`
(default 24) so a later infrastructure change is picked up without operator action, but a
negative result does not cost a probe per file.

**Layer 3 — runtime fallback** with error classification (§16.3).

### 16.2 The probe — DNS first, because it cannot hang

The dangerous failure mode is not "DFS is absent," it is **"DFS is absent and the attempt
hangs."** `dfs.core.windows.net` is a public DNS name. With no `privatelink.dfs.…` zone it
resolves to a **public** Azure IP; because public network access on this account is fully
disabled, the subsequent connection then stalls or is rejected. Doing that per file, inside
a transfer job, is the worst outcome available.

So probe in cheap-to-expensive order and stop at the first negative:

1. **Module check.** `require('@azure/storage-file-datalake')` inside a `try`. On
   `MODULE_NOT_FOUND` → `dfsReachable: false`, reason `module-missing`. This makes the
   dependency *effectively optional* — a deployment that never wants DFS can omit it.
2. **DNS resolution.** `dns.promises.lookup('<account>.dfs.core.windows.net')` with a short
   timeout. If it fails → reason `dns-unresolved`. If it resolves to a **non-private**
   address (outside RFC1918 / 100.64.0.0/10) → reason `dns-public` — the private DNS zone
   for the `dfs` sub-resource does not exist, so the endpoint is unusable regardless of what
   a connection attempt would eventually report. This is the check that actually answers
   Ben's question, and it costs single-digit milliseconds.
3. **Live operation.** Only if 1 and 2 pass: a bounded `getProperties()` against the
   filesystem via `DataLakeFileSystemClient`, wrapped in an explicit timeout
   (`AZURE_BLOB_DFS_PROBE_TIMEOUT_MS` in `config.json`, default 10000). Success →
   `dfsReachable: true`.

Every probe path is bounded. There is no code path where a missing DFS endpoint can block a
transfer for longer than the probe timeout, once.

### 16.3 Runtime fallback — what falls back, what fails

`archiveSourceFile` for `azure-blob` attempts rename only when `archiveMode` allows it and
`dfsReachable` is true. If the rename call still fails, classify before deciding:

| Failure | Classification | Action |
|---|---|---|
| `MODULE_NOT_FOUND` | Environment | Fall back; log `info` |
| `ENOTFOUND`, `EAI_AGAIN` | Transport | Fall back; log `info`; invalidate cache |
| `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, TLS errors | Transport | Fall back; log `info`; invalidate cache |
| Probe timeout exceeded | Transport | Fall back; log `warn`; invalidate cache |
| `403` / `AuthorizationPermissionMismatch` | **Configuration** | Fall back, but log **`warn`** naming the likely cause: SAS lacks `m` (move). Job succeeds; misconfiguration is visible. |
| `404` on source, target already exists | **Already done** | Treat as **success** — see §16.4 |
| `404` on source, target absent | Real error | **Fail the file.** Do not fall back — copy+delete cannot succeed either, and retrying would only obscure the cause. |
| `409` / target exists | Real error | **Fail the file** with the conflict named. |
| Anything else | Unknown | **Fail the file**, surfacing `statusCode` via `wrapBlobError`. |

The principle: **fall back on environment and transport problems; fail on data and state
problems.** Copy+delete is a correct archive, merely non-atomic, so degrading to it is safe
whenever the reason is "the fast path isn't reachable." Degrading to it when the reason is
"the source file isn't where we think it is" would convert a diagnosable error into a
confusing one.

When `archiveMode: "rename"` is pinned, every row above that says "fall back" instead
**fails the file** with the classification in the message. That is the entire point of
pinning it.

### 16.4 Idempotency guard — the lost-response case

Rename is atomic server-side, but the *response* can be lost to a network blip after the
operation committed. A naive fallback then runs copy+delete against a source that no longer
exists and reports a spurious failure.

Before falling back, check: **source absent AND target present with the expected size** →
the rename succeeded, return success. This is cheap (one `getProperties` on each) and turns
the one genuinely confusing failure mode into a non-event.

### 16.5 Copy+delete fallback — unchanged contract

**Correction — use `syncCopyFromURL`, not `startCopyFromURL`.** Source and target are
always in the same container/account, which is exactly the case Microsoft's SDK documents
as completing synchronously — no polling loop needed. Pass the source block blob client's
own `.url` directly as the copy source: it already carries the container's SAS (the
`BlockBlobClient` inherits it from the `ContainerClient` it was constructed from), so no
separate SAS needs to be attached to the source URL. `syncCopyFromURL` has an undocumented-
in-this-spec size ceiling that has changed across API versions — defensively fall back to
`beginCopyFromURL(...).pollUntilDone()` if the sync call fails with an error indicating the
source is too large, rather than hardcoding a specific byte threshold that may drift.

Copy to `_archive/<name>` under the same prefix, verify size, then delete the source.
Requires `c` + `w` + `d` in `sp`, which the current `sp=racwdlme` token satisfies. Failure
at any step leaves the source in place — never delete before the copy is verified.

### 16.6 Surfacing it

`POST /:id/test` reports the resolved strategy so the operator sees it without reading logs:

```jsonc
"archive": { "mode": "auto", "effective": "rename", "dfsReachable": true, "reason": null }
```

When `effective` is `copy-delete` on an HNS account, include a short note that atomic rename
is available if a `dfs` private endpoint and `privatelink.dfs.core.windows.net` zone are
added — turning a silent degradation into an actionable one.

### 16.7 Confirmed 2026-07-29 — both private endpoints exist

Standard practice on this account (and presumably future analyst containers provisioned the
same way) is to stand up **both `blob` and `dfs` sub-resource private endpoints**. So on
`staldlsedadeveus`, and expected by default on containers provisioned like it:

- `archiveMode: "auto"` will detect `dfsReachable: true` on first probe and use atomic
  `rename()` — no copy+delete, no `_archive/` staging blob, no poll loop.
- The copy+delete fallback in §16.3/§16.5 remains fully implemented regardless — it is what
  protects a future analyst container that *doesn't* follow the standard pattern, and what
  keeps archive working through any transient DNS/network blip on the `dfs` link.
- Given the endpoint is confirmed present, `archiveMode: "rename"` (pinned, fail-loud rather
  than silently-degrade) is a reasonable default for this specific profile once Phase 2
  ships — the auto-detected outcome and the pinned outcome are the same here, and pinning
  makes a future infrastructure regression an error instead of a silent slowdown. Leave the
  profile default at `"auto"`, but this is worth revisiting per-profile once the pattern is
  confirmed for each container.

Detection logic in §16.1–16.4 is unchanged and still does the work — this just means the
happy path is expected to be the common case rather than the exception.

---

## 17. Phase 2a — landed 2026-07-29

`transferRule()` wiring for everything except archive. Verified against the actual diff,
not just the summary.

**What shipped:**

- `workDir` computation moved after `srcProfile` resolution (the "Source profile not
  found" throw is unchanged), and now also triggers for any `azure-blob` source even with
  no PGP/zip enabled — required by eager staging below.
- SAS expiry pre-flight, immediately after `srcProfile` resolution and before any listing:
  every `azure-blob` profile involved (source + all destinations referenced by
  `rule.destinations`) is checked against its persisted `sasMeta.expiresAt`; an expired
  token throws and fails the rule before any network call is made. Does not re-parse the
  token. The "advisory when expiring soon" half of §6.4 is deliberately not implemented —
  it belongs to Phase 3, which owns the configurable threshold (a flat `config.json` key,
  not `settings.json` — see the §6.2 correction).
- Source listing gained an `azure-blob` branch via `blobListFiles`/`resolveBlobPrefix`.
  `isSftp` generalised to `isRemote` (`sftp` or `azure-blob`) in the date filter, so a
  blob entry's `mtime` is used instead of a `statSync` call that would throw against a
  blob name.
- `deleteSourceFile` gained an `azure-blob` branch via `blobDeleteFile` — stateless, no
  entry in the sftp-specific `pool` Map (whose cleanup loop calls `client.end()`, which
  `ContainerClient` doesn't have).
- **Eager blob-source staging** — the one deliberate departure from "extend existing
  branches in place." A blob source file is staged to `workDir` once, immediately after
  `isLocal` is initialised, in both bundle mode's pass-1 loop and the per-file loop. Every
  downstream `if (!isLocal)` block (PGP input, per-file zip, unzip) then no-ops for blob
  unmodified, because `isLocal` is already `true` by the time execution reaches them —
  avoids duplicating blob branches across three lazy staging sites plus the sftp
  direct-streaming destination branch. Bundle mode's staging call sits inside the existing
  per-file try/catch (a staging failure skips just that file). The per-file loop's staging
  call is deliberately **not** wrapped in its own try/catch, matching sftp's existing lazy
  staging inside the PGP block, which isn't wrapped either — a failure there aborts the
  whole rule today, for both remote types equally. Pre-existing inconsistency (bundle mode
  is per-file resilient, the plain per-file loop is not); intentionally left alone as
  out of scope.
- Destination delivery gained an `azure-blob` branch in both `deliverLocalFile()` (used by
  bundle mode and unzip-extracted files) and the main per-file loop's inline destPath
  construction + delivery dispatch. Both assume `transferFile.path`/`localFilePath` is
  always a local file by the time they run — true by construction (eager staging for blob
  source, already true for local/smb, existing sftp handling for sftp source).
- `archiveSourceFile` throws an explicit, named error for `azure-blob` sources
  ("not yet supported... Phase 2b") rather than silently no-op'ing or crashing generically.
  Surfaces through the existing `disposeSource` try/catch, so delivery still succeeds and
  only the disposition step is recorded as failed.

**Tests:** `tests/azure-blob-transfer.test.js`, 11 integration tests using a
`FakeContainerClient`, registered in `run-all.js`. Covers blob→local, local→blob,
blob→blob, blob source with PGP (both a failure path proving eager staging correctly feeds
the transform, and a working rename-transform path proving content integrity), SAS-expiry
pre-flight for both source and destination profiles (plus confirming a valid one doesn't
block), the delete-only path, and the archive guard. Full suite: same two pre-existing
failures as before, no new regressions; existing sftp/local `transferRule` tests unchanged.

**Nothing carried forward from Phase 2a** — no defects found on review.

---

## 18. Phase 2b — landed 2026-07-29

Archive: DFS `.move()` with runtime capability detection, copy+delete fallback,
idempotency guard. Verified against the actual diff and against the installed
`@azure/storage-file-datalake@12.31.0` package directly (see the `.move()`-vs-`.rename()`
correction in §16.4/§15.4 above — the implementer caught a spec error I introduced and
verified against the real package rather than trusting the doc).

**What shipped, matching §16 with two improvements over the original spec:**

- Config helpers (`_getAzureBlobCapabilityTtlHours`, `_getAzureBlobDfsProbeTimeoutMs`)
  mirror `scheduler.js`'s `_getScheduleTimezone()` exactly, reading flat keys from
  `data/config.json`.
- `withTimeout()` — a small leak-free wrapper (always clears its timer) used for both the
  DNS lookup and the live DFS probe, so a timeout in tests can't leave a dangling handle.
- `isPrivateIPv4()` — plain octet arithmetic against RFC1918 + CGN (100.64.0.0/10), no new
  dependency.
- `getDataLakeFileSystemClient()` **lazily `require()`s `@azure/storage-file-datalake`
  inside the function body**, not at module load — an improvement on what I specified. A
  deployment missing the package now only fails when DFS is actually attempted, rather than
  on `require('./executor')` at all. `deriveDfsEndpoint()` substitutes `.blob.` → `.dfs.`
  on `profile.blobEndpoint`, with `profile.dfsEndpoint` as an override escape hatch.
- `probeDfsCapability()` — the three-layer probe exactly as specified: module check → DNS
  resolution (public-address result classified as `dns-public`, distinct from
  `dns-unresolved`) → live `getProperties()`, each bounded.
- `resolveDfsCapability()` — TTL-cached, re-reads `profiles.json` fresh before persisting
  rather than trusting `transferRule`'s in-memory copy; skips probing entirely for
  `archiveMode: 'copy-delete'`. A separate `invalidateDfsCapabilityCache()` clears the cache
  on a transport-classified failure, so a "reachable" verdict that goes stale after a probe
  succeeded isn't trusted indefinitely.
- `renameViaDataLake()` — `getDirectoryClient(targetDirPath).createIfNotExists()` before
  `getFileClient(sourceBlobPath).move(targetBlobPath)`. Errors propagate unwrapped for the
  caller to classify.
- `classifyArchiveError()` — maps to `fallback` / `already-done` / `real-error` exactly per
  the §16.3 table; transport-classified failures invalidate the capability cache; 403 logs
  a named warn (SAS missing `m`) before falling back; 404 defers to the idempotency guard.
- `checkRenameAlreadySucceeded()` — reuses the Blob API (not DFS) for both existence checks,
  as specified.
- `archiveBlobViaCopyDelete()` — `syncCopyFromURL` first, with a **permissive** too-large
  detector (`statusCode === 413` or a substring match across `code`/`errorCode`/`message`
  for known too-large signatures) falling back to `beginCopyFromURL().pollUntilDone()`,
  rather than a hardcoded byte threshold — matches the "may drift across API versions"
  concern from §16.5 directly. Verify-then-delete ordering preserved; source is never
  removed before the copy is confirmed the right size.
- `archiveBlobFile()` — the entry point wired into `archiveSourceFile`'s azure-blob branch,
  replacing the Phase 2a placeholder throw.

**Tests:** `tests/azure-blob-archive.test.js`, 10 tests (all 8 specified scenarios plus 2
extra: pinned `copy-delete` skips probing with zero DNS lookups, and both the
directory-exists and directory-needs-creation rename variants), using an extended
`FakeContainerClient` plus a new `FakeDataLakeFileSystemClient`, a monkeypatched
`dns.promises.lookup`, and a `logger.warn` spy. One now-obsolete test in
`tests/azure-blob-transfer.test.js` (asserting the removed "not yet supported" guard) was
correctly deleted, not left dangling. Full suite: same two pre-existing failures, no new
regressions; existing sftp/local `postTransfer: 'archive'` behavior unchanged.

**Nothing carried forward** — no defects found on review beyond the `.move()` correction,
which was mine to begin with, not the implementation's.

**Phase 2 (a+b) is now complete.** Remaining: Phase 3 (expiry tracking & alerting) and
Phase 4 (UI + Portal SAS checklist, §7), both still not started.

---

## 19. Phase 3 — landed 2026-07-29

Expiry tracking & alerting. Verified against the actual diff.

**What shipped:**

- `app/executor.js` — `_getAzureBlobSasWarnDays()` (reuses the existing
  `_readAzureBlobConfig()`, flat `AZURE_BLOB_SAS_WARN_DAYS` key, default `[30,14,7,1]`) and
  `classifySasExpiry(expiresAt, warnDaysThresholds)`, the single shared classifier —
  `'ok' | 'warn' | 'critical' | 'expired' | 'unknown'`, sorts thresholds internally so
  config order doesn't matter. Both exported. `transferRule`'s pre-flight now calls it:
  identical hard-fail throw for `'expired'` (same message as Phase 2a, regression-tested),
  a new advisory pushed to `jobResult.errors` for `'warn'`/`'critical'`, and deliberately
  nothing for `'unknown'` — commented in place to explain why (would otherwise nag on every
  job run forever for a policy-backed profile with no recorded expiry).
- `app/scheduler.js` — `_checkAzureBlobSasExpiry()`, `_getAzureBlobSasCheckCron()`
  (config-driven, validated via `cron.validate()`, default `0 7 * * *`), and
  `_registerAzureBlobExpiryCheck()`, using a dedicated `_azureBlobExpiryTask` module
  variable kept entirely separate from the rule-keyed `_cronTasks` Map — confirmed it's
  never at risk of being silently wiped by `reloadAll()`'s rule-cron cancel loop. Wired into
  `init()`, `shutdown()`, and `_reset()`; `_checkAzureBlobSasExpiry` exported for direct
  test invocation, matching the existing `_testCronFire` precedent.
- `app/api/profiles.js` — `redact()` adds `sasStatus`/`sasDaysRemaining` for `azure-blob`
  profiles, so `GET /`, `POST /`, and `PUT /:id` all pick it up for free (no route-handler
  duplication). `POST /:id/test`'s `sas` object gained a `status` field; the existing
  Phase 1 `sasDaysRemaining()`/`sasCapabilities()` local helpers were deliberately left
  untouched rather than refactored onto the new shared classifier, since they're shipped,
  tested, and correct — purely additive.

**Tests:** `tests/azure-blob-expiry.test.js`, 23 tests — classifier boundaries at each
default threshold, negative days, null expiry, and an explicit unsorted/non-default
thresholds array; the scheduler check's per-status log lines via a `logger`.warn/.error
spy; `GET /api/profiles`'s new fields present on blob profiles and absent on others;
the test endpoint's new `status` field; and `transferRule` pre-flight regression (expired
still hard-fails identically) plus the new advisory behavior. Full suite: same two
pre-existing failures, no new regressions; `scheduler.test.js` (25/25) and all four
`azure-blob-*` suites pass in full.

**Two things flagged during implementation, both checked and confirmed accurate rather
than taken on faith:**

- The claim that a `'warn'`/`'critical'` advisory doesn't force `jobResult.status` away
  from `'success'` was wrong to expect and right to drop — read `transferRule`'s finally
  block directly: `jobResult.status = jobResult.errors.length === 0 ? 'success' : …`
  predates this phase entirely (untouched, pre-existing logic). Any non-empty `errors`
  array — advisory or otherwise — already yields `'partial'`/`'failed'`. Correct, not a
  regression, confirmed by reading the surrounding code rather than trusting the claim.
- The claim that `_getAzureBlobSasWarnDays()`'s config-reading path can't be safely unit
  tested without writing to the real `data/` directory is also accurate, and correctly
  scoped: `classifySasExpiry` itself (the part that actually matters) takes the thresholds
  array as a direct argument and is thoroughly tested, including the unsorted/custom case.
  Only the thin `config.json`-reading wrapper is untested — the same pre-existing gap
  `_getScheduleTimezone()` already has, not a new one introduced here.

**Nothing carried forward** — no defects found on review.

---

## 20. Post-deploy: single SAS-URI paste — landed 2026-07-29

Deployed and confirmed working against the real container (Test Connection, browsing) after
Phase 4, then redesigned per §7.2a: the profile UI's three separate
blobEndpoint/container/SAS-token inputs became one paste of the Portal's **Blob SAS URL**,
parsed server-side. Verified against the actual diff.

**What shipped:**

- `app/executor.js` — `splitSasUri(input)` (new, exported): parses a full Blob SAS URL via
  the native `URL` class into `{ blobEndpoint, container, sasToken }`, rejecting a
  non-URL, zero path segments, more than one segment (blob-level SAS, not container-level),
  or no query string, each with a specific message. `normalizeSasToken(input)` (new,
  exported): the URL-stripping logic extracted out of `parseSasToken`'s inline block,
  reused in `getBlobContainerClient` as defense-in-depth for any credential-store entry
  that predates this change.
- `app/api/profiles.js` — `POST /` and `PUT /:id` accept a new `sasUri` field; when present,
  `splitSasUri` derives `blobEndpoint`/`container`/token, overriding any directly-supplied
  values. Direct `blobEndpoint`/`container`/`sasToken` fields still work unchanged
  (back-compat, not actively rejected). `CRED_FILE` changed from `const` to `let`, with a
  new `router._setCredFilePath()` test seam — added because exercising `POST`/`PUT` for
  real in a test would otherwise write to the actual `data/credentials.enc`, tripping the
  suite's real-data tripwire. Mirrors `router._setUsersFile()` in `app/api/auth.js` exactly;
  checked both side by side, the pattern match is precise, not just similar in spirit.
- `app/ui/app.js` — the three-field pane replaced with one `#pm-blob-sas-uri` input. Live
  client-side confirmation line, more thorough than originally specified: distinguishes an
  `se`-bearing token (shows parsed expiry/permissions), an `si`-only policy-backed token
  (reveals the manual-expiry row), and neither (a specific "doesn't look like a valid SAS
  URL" message) — not a single generic parse-or-fail. When editing an existing profile with
  the field left blank, shows the currently-stored account/container/expiry instead. New
  profiles require `sasUri`; there is no way to populate `blobEndpoint`/`container` through
  the UI other than pasting a full URL, per §7.2a's decision to drop the manual fallback.
  §7's wizard checklist guidance updated to match: copy the **Blob SAS URL**, not the bare
  token — the reverse of what Phase 4 originally told operators to do.

**Tests:** `tests/azure-blob.test.js` gained 5 `splitSasUri` cases (the worked
`eda-landing` example, non-URL, zero segments, multi-segment, no query string) plus
`normalizeSasToken` coverage, 50 total. `tests/azure-blob-expiry.test.js` gained 4 POST/PUT
route-handler tests via the existing `findRouteHandler` pattern plus the new
`_setCredFilePath` seam: URI-derived creation, invalid-URI rejection, direct-fields
back-compat, and PUT re-pointing an existing profile — 27 total. Full suite: same two
pre-existing failures, no new regressions.

**Nothing carried forward** — no defects found on review.

**Outstanding, not a code question:** `main` is 2 local commits ahead of `origin/main`
(`4fdc3b4` "Add Azure Blob Storage profile type", `92cc2c8` "Bump version to 2.2.0" /
tag `v2.2.0`) — covers Phases 1 through 4. This session's SAS-URI redesign
(`executor.js`/`profiles.js`/`app.js`/both test files) is uncommitted on top of that,
confirmed via `git status`. Neither committed nor pushed as of this writing.
