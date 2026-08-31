# Pixiv Authentication Methods for Third-Party Clients

> **Last updated:** 2025-07-19
> **Status:** Research document — does not reflect current pixivizer implementation decisions

---

## Table of Contents

1. [Overview of OAuth Grant Types](#1-overview-of-oauth-grant-types)
2. [Supported Grant Types](#2-supported-grant-types)
   - [2.1 Password Grant (`grant_type=password`)](#21-password-grant-grant_typepassword)
   - [2.2 Refresh Token Grant (`grant_type=refresh_token`)](#22-refresh-token-grant-grant_typerefresh_token)
   - [2.3 Authorization Code Grant with PKCE (`grant_type=authorization_code`)](#23-authorization-code-grant-with-pkce-grant_typeauthorization_code)
3. [Client Credentials](#3-client-credentials)
4. [X-Client-Time / X-Client-Hash Requirement](#4-x-client-time--x-client-hash-requirement)
5. [Historical Changes to Pixiv's OAuth Endpoint](#5-historical-changes-to-pixivs-oauth-endpoint)
6. [Third-Party Client Survey](#6-third-party-client-survey)
   - [6.1 PixivPy (upbit/pixivpy)](#61-pixivpy-upbitpixivpy)
   - [6.2 PixivPy-Async (Mikubill/pixivpy-async)](#62-pixivpy-async-mikubillpixivpy-async)
   - [6.3 PixEz Flutter (Notsfsssf/pixez-flutter)](#63-pixez-flutter-notsfsssfpixez-flutter)
   - [6.4 GPPT / GetPixivToken (eggplants/get-pixivpy-token)](#64-gppt--getpixivtoken-egggplantsget-pixivpy-token)
   - [6.5 Pictelio (this project, pixivizer)](#65-pictelio-this-project-pixivizer)
7. [Comparison Table](#7-comparison-table)
8. [Summary of Findings](#8-summary-of-findings)

---

## 1. Overview of OAuth Grant Types

Pixiv's OAuth 2.0 endpoint at `https://oauth.secure.pixiv.net/auth/token` supports three grant types:

| Grant Type | Endpoint | Status | Purpose |
|---|---|---|---|
| `password` | `POST /auth/token` | ❌ **Deprecated/Blocked** | Login with username + password |
| `refresh_token` | `POST /auth/token` | ✅ **Active** | Refresh an existing token |
| `authorization_code` | `POST /auth/token` | ✅ **Active** | OAuth code flow with PKCE (S256) |

All grant types use the same fixed `CLIENT_ID` and `CLIENT_SECRET` (see [Section 3](#3-client-credentials)).

---

## 2. Supported Grant Types

### 2.1 Password Grant (`grant_type=password`)

**Status:** ❌ **Effectively deprecated / blocked by Pixiv as of ~2021**

The password grant type sends the user's username and password directly to the OAuth endpoint:

```
POST https://oauth.secure.pixiv.net/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
&username=<email_or_id>
&password=<password>
&client_id=MOBrBDS8blbauoSck0ZfDbtuzpyT
&client_secret=lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj
&get_secure_url=1
```

#### Evidence of deprecation:

- **pixivpy README** explicitly states: *"Due to #158 reason, password login no longer exist. Please use `api.auth(refresh_token=REFRESH_TOKEN)` instead."* ([source](https://github.com/upbit/pixivpy#readme))
- **pixivpy-async** (`bapi.py`, lines 115-141) raises `LoginError` immediately when password credentials are provided, with unreachable code after the `raise`:
  ```python
  if (username is not None) and (password is not None):
      raise LoginError
      data['grant_type'] = 'password'      # ← unreachable
      data['username'] = username           # ← unreachable
      data['password'] = password           # ← unreachable
  ```
  ([source](https://github.com/Mikubill/pixivpy-async/blob/master/pixivpy_async/bapi.py))
- **PixEz Flutter** (`oauth_client.dart`) still implements password grant in code but many users report it failing in newer Pixiv accounts, especially those requiring MFA/2FA. ([source](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/oauth_client.dart))
- **ZipFile's Pixiv OAuth Flow gist** — the canonical reference for third-party Pixiv auth — only documents the authorization_code flow, not password flow. ([reference](https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362))

#### Known limitations of password grant:
1. **Fails for accounts with 2FA/MFA enabled** — Pixiv's 2FA gate is on the web login page, not the OAuth token endpoint.
2. **Requires X-Client-Time and X-Client-Hash** headers (added ~2019).
3. **Pixiv may rate-limit or block password-grant tokens** aggressively.
4. **No CAPTCHA handling** — the password endpoint doesn't support CAPTCHA challenges that the web login page requires.
5. **Pixiv has been known to return error code "pixiv_id is not allowed"** for password grant attempts, suggesting server-side blocking.

---

### 2.2 Refresh Token Grant (`grant_type=refresh_token`)

**Status:** ✅ **The de facto standard for all third-party clients**

This is the OAuth 2.0 standard refresh token flow:

```
POST https://oauth.secure.pixiv.net/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<token>
&client_id=MOBrBDS8blbauoSck0ZfDbtuzpyT
&client_secret=lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj
&get_secure_url=1
&include_policy=true
```

#### Response:

```json
{
  "access_token": "…",
  "expires_in": 3600,
  "token_type": "bearer",
  "scope": "",
  "refresh_token": "…",
  "user": {
    "id": 123456,
    "name": "…",
    "account": "…",
    "mail_address": "…@…",
    "is_premium": false,
    "x_restrict": 2,
    "is_mail_authorized": true,
    "require_policy_agreement": false,
    "profile_image_urls": { … }
  },
  "device_token": "…"
}
```

#### Important notes:

1. **Pixiv returns a NEW refresh_token in every response** — the old one is invalidated on each refresh. Clients must persist the latest refresh_token.
2. **Token lifetime:** `access_token` expires in 3600 seconds (1 hour); the `refresh_token` has no documented expiry but may be invalidated if unused for a long period.
3. **`include_policy=true`** is recommended to avoid policy agreement interstitials.
4. **Device token:** The response includes a `device_token` field that some older clients used for push notifications, but most modern clients ignore it.

#### Used by:
Every surveyed third-party client uses `refresh_token` grant as their primary or sole auth method (see [Section 6](#6-third-party-client-survey)).

---

### 2.3 Authorization Code Grant with PKCE (`grant_type=authorization_code`)

**Status:** ✅ **Active and the officially recommended method for obtaining a refresh_token**

This is the OAuth 2.0 Authorization Code flow with PKCE (Proof Key for Code Exchange, RFC 7636). It is Pixiv's **only supported method for obtaining an initial refresh_token** without using the deprecated password grant.

#### Step 1: Generate PKCE challenge

```python
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe

code_verifier = token_urlsafe(32)

def s256(data):
    return urlsafe_b64encode(sha256(data).digest()).rstrip(b"=").decode("ascii")

code_challenge = s256(code_verifier.encode("ascii"))
```

#### Step 2: Open browser to login page

```
GET https://app-api.pixiv.net/web/v1/login
  ?code_challenge=<code_challenge>
  &code_challenge_method=S256
  &client=pixiv-android
```

The user logs in via the browser. After successful login, Pixiv redirects to:

```
pixiv://accounts.pixiv.net/post-redirect?code=<authorization_code>
```

On desktop (without custom protocol handler), the redirect URL is captured via a network listener that watches for the `pixiv://` URL pattern. Some clients use a local HTTP server on a custom redirect URI instead.

#### Step 3: Exchange code for tokens

```
POST https://oauth.secure.pixiv.net/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<authorization_code>
&code_verifier=<code_verifier>
&client_id=MOBrBDS8blbauoSck0ZfDbtuzpyT
&client_secret=lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj
&redirect_uri=https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback
&include_policy=true
```

#### Response:
Same shape as refresh_token response — returns `access_token`, `refresh_token`, and user info.

#### Implementation references:

- **gppt (eggplants/get-pixivpy-token)** — the most accessible reference implementation:
  - PKCE generation: [`gppt/utils.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/utils.py), function `_oauth_pkce()`
  - Browser automation: [`gppt/gppt.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/gppt.py), class `GetPixivToken`
  - Constants: [`gppt/consts.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/consts.py)
- **ZipFile's Pixiv OAuth Flow gist** — the original reference (uses Selenium)
- **pixivpy-async** — [`bapi.py`](https://github.com/Mikubill/pixivpy-async/blob/master/pixivpy_async/bapi.py), method `login_web()` — implements the flow with manual URL + code input
- **PixEz Flutter** — [`oauth_client.dart`](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/oauth_client.dart), methods `generateWebviewUrl()`, `code2Token()` — uses an in-app WebView

#### Key callbacks/redirect URIs used by clients:

| Redirect URI | Used by |
|---|---|
| `https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback` | PixEz, gppt, pixivpy |
| `pixiv://accounts.pixiv.net/post-redirect` | Pixiv official apps |
| (custom protocol handler) | Various desktop clients |

---

## 3. Client Credentials

All known third-party clients use the **same hardcoded client credentials** extracted from the official Pixiv iOS/Android apps.

| Credential | Value | Source |
|---|---|---|
| `CLIENT_ID` | `MOBrBDS8blbauoSck0ZfDbtuzpyT` | Official Pixiv iOS App |
| `CLIENT_SECRET` | `lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj` | Official Pixiv iOS App |
| `HASH_SECRET` | `28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c` | Used for X-Client-Hash |

**Note:** PixEz Flutter also defines a *second* set of credentials (`REFRESH_CLIENT_ID` and `REFRESH_CLIENT_SECRET`) which appear to be alternative/legacy values:

```dart
final String REFRESH_CLIENT_ID = "KzEZED7aC0vird8jWyHM38mXjNTY";
final String REFRESH_CLIENT_SECRET = "W9JZoJe00qPvJsiyCGT3CCtC6ZUtdpKpzMbNlUGP";
```

However, these are **not actually used** in any code path in PixEz — all auth requests use the standard `CLIENT_ID`/`CLIENT_SECRET`.

### Have the credentials ever changed?

**Yes, at least once.** The `CLIENT_ID` and `CLIENT_SECRET` values have remained stable since ~2014, but there is evidence of rotation:

1. The **original** OAuth client credentials used by the first version of pixivpy (pixivpy v1/v2) were different.
2. Around the time Pixiv moved from Public API to App-API (~2016), the credentials were updated to the current values.
3. The `HASH_SECRET` was added later (~2019) when the X-Client-Time/X-Client-Hash check was introduced.

No documented case of credential rotation after 2019 has been confirmed in the surveyed codebases.

> **Risk:** If Pixiv rotates these credentials, every third-party client would stop working until they update. This has been a recurring concern in the pixivpy issue tracker.

---

## 4. X-Client-Time / X-Client-Hash Requirement

Since approximately September 2019, Pixiv's OAuth endpoint requires two custom headers on every `/auth/token` request:

### `X-Client-Time`

The current UTC timestamp in ISO 8601 format:

```
X-Client-Time: 2025-07-19T14:30:00+00:00
```

### `X-Client-Hash`

An MD5 hash of the concatenation of `X-Client-Time` and the `HASH_SECRET`:

```
X-Client-Hash = MD5(X-Client-Time + HASH_SECRET)
```

Example implementation (from pixivpy `api.py`):

```python
local_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%S+00:00")
headers_["x-client-time"] = local_time
headers_["x-client-hash"] = hashlib.md5(
    (local_time + self.hash_secret).encode("utf-8")
).hexdigest()
```

([source](https://github.com/upbit/pixivpy/blob/master/pixivpy3/api.py))

The `HASH_SECRET` value is: `28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c`

### Historical timeline:

| Date | Change | Evidence |
|---|---|---|
| Pre-2019 | No hash check; simple password/refresh flow | pixivpy git history |
| ~2019-09-03 | X-Client-Time/X-Client-Hash introduced | pixivpy issue [#83](https://github.com/upbit/pixivpy/issues/83), thanks to [@DaRealFreak](https://github.com/DaRealFreak) |
| Present | Hash check still active on all `/auth/token` requests | All surveyed clients implement it |

---

## 5. Historical Changes to Pixiv's OAuth Endpoint

### 5.1 API Version History

| Phase | Approx. Dates | Auth Method | API Endpoint |
|---|---|---|---|
| **Public API (SAPI)** | ~2008–2015 | `grant_type=password` via `https://oauth.secure.pixiv.net/auth/token` | `https://public-api.secure.pixiv.net/v1/…` |
| **App-API (v1)** | ~2015–2018 | `grant_type=password` / `refresh_token` | `https://app-api.pixiv.net/v1/…` |
| **App-API (v2)** | ~2018–2020 | `grant_type=password` / `refresh_token` + X-Client-Time/ X-Client-Hash | `https://app-api.pixiv.net/v1/…`, `v2/…` |
| **App-API (v3+)** | ~2021–present | `grant_type=refresh_token` only / `authorization_code` + PKCE | `https://app-api.pixiv.net/v1/…`, `v2/…` |

### 5.2 Notable Events

1. **~2015: Public API deprecated** — Pixiv deprecated the Public API (SAPI), forcing all clients to move to the App-API. (`pixivpy` v3.0 release, per its README)

2. **2019-09-03: X-Client-Time/Hash introduced** — Pixiv added the hash check to the OAuth token endpoint. Discovered by @DaRealFreak, implemented by pixivpy in issue [#83](https://github.com/upbit/pixivpy/issues/83).

3. **~2020: Cloudflare protection added** — Pixiv began using Cloudflare's anti-DDoS protection. `pixivpy` v3.5 switched to `cloudscraper` (a Cloudflare bypass library) in issue [#140](https://github.com/upbit/pixivpy/issues/140).

4. **~2020-10: Password grant begins failing** — Pixiv started blocking or rate-limiting password-grant login attempts, especially for accounts with MFA/2FA. The `pixivpy` README now explicitly states password login no longer exists.

5. **~2022-02: Public-API completely removed** — `pixivpy` commit [74e114e](https://github.com/upbit/pixivpy/commit/74e114e1cfe51e6c0e8c30c2024bcfcf0bae7ccc) removes all remaining Public-API support.

6. **2022-10-31: Novel endpoint change** — The `/webview/v2/novel` endpoint was added with a `viewer_version=20221031_ai` parameter (per pixivpy changelog).

7. **~2024-2025:** Authorization code flow with PKCE becomes the standard way to obtain an initial refresh token. Tools like `gppt` (2023+) package this into one-command CLI tools.

### 5.3 What Has NOT Changed

- The OAuth token endpoint URL: `https://oauth.secure.pixiv.net/auth/token`
- The client ID/secret values (stable since at least 2016)
- The response format `{ "response": { "access_token": …, "refresh_token": …, "user": … } }`
- Bearer token usage: `Authorization: Bearer <access_token>` for API requests
- Token refresh mechanism (grant_type=refresh_token)

---

## 6. Third-Party Client Survey

### 6.1 PixivPy (upbit/pixivpy)

- **Repo:** [https://github.com/upbit/pixivpy](https://github.com/upbit/pixivpy)
- **Language:** Python
- **GitHub stars:** ~6.6k
- **Package:** `pixivpy3` on PyPI

#### Auth methods:
| Method | Supported? | Details |
|---|---|---|
| `password` | ❌ (removed in README guidance) | Code still present in `api.py` but README tells users not to use it |
| `refresh_token` | ✅ **Primary** | `api.auth(refresh_token=…)` |
| `authorization_code` | ❌ (not directly; manual flow via gist) | README links to ZipFile's OAuth flow gist |

#### Key files:
- [`pixivpy3/api.py`](https://github.com/upbit/pixivpy/blob/master/pixivpy3/api.py) — `BasePixivAPI.auth()` method
- [`pixivpy3/aapi.py`](https://github.com/upbit/pixivpy/blob/master/pixivpy3/aapi.py) — `AppPixivAPI` with no-auth endpoints

#### Notable implementation details:
- Uses `cloudscraper` (Cloudflare bypass) for the requests session.
- `auth()` method handles both password and refresh_token grant types in one method.
- The `set_auth()` method allows directly setting `access_token` + `refresh_token` without calling `auth()`.
- Many API methods support `req_auth=False` for unauthenticated access (e.g., rankings, search, user details).

---

### 6.2 PixivPy-Async (Mikubill/pixivpy-async)

- **Repo:** [https://github.com/Mikubill/pixivpy-async](https://github.com/Mikubill/pixivpy-async)
- **Language:** Python (async)
- **GitHub stars:** ~1.5k

#### Auth methods:
| Method | Supported? | Details |
|---|---|---|
| `password` | ❌ **Explicitly raises LoginError** | `bapi.py` line 119: `raise LoginError` before password code |
| `refresh_token` | ✅ **Primary** | `login(refresh_token=…)` |
| `authorization_code` | ✅ `login_web()` method | Implements PKCE flow with manual code input |

#### Key files:
- [`pixivpy_async/bapi.py`](https://github.com/Mikubill/pixivpy-async/blob/master/pixivpy_async/bapi.py) — `BasePixivAPI.login()` and `login_web()`

#### Notable implementation details:
- The `login_web()` method generates the PKCE challenge, prints the login URL for the user, and accepts a code via stdin.
- The `login()` method explicitly prevents password usage (unreachable code after `raise LoginError`).
- Uses `aiohttp`/`aiofiles` for async HTTP/file operations.

---

### 6.3 PixEz Flutter (Notsfsssf/pixez-flutter)

- **Repo:** [https://github.com/Notsfsssf/pixez-flutter](https://github.com/Notsfsssf/pixez-flutter)
- **Language:** Dart/Flutter
- **GitHub stars:** ~2.5k
- **Package:** `pixez` on Google Play / F-Droid

#### Auth methods:
| Method | Supported? | Details |
|---|---|---|
| `password` | ✅ (code exists, may fail in practice) | `postAuthToken()` in `oauth_client.dart` |
| `refresh_token` | ✅ **Primary for token refresh** | `postRefreshAuthToken()` in `oauth_client.dart`, with auto-refresh interceptor |
| `authorization_code` | ✅ **Primary for initial login** | `code2Token()` + `generateWebviewUrl()` in `oauth_client.dart` |

#### Key files:
- [`lib/network/oauth_client.dart`](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/oauth_client.dart) — All OAuth methods
- [`lib/network/account_client.dart`](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/account_client.dart) — Account management
- [`lib/network/refresh_token_interceptor.dart`](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/refresh_token_interceptor.dart) — Auto-refresh on 400 OAuth errors

#### Notable implementation details:
- **Dual credential sets:** Defines `REFRESH_CLIENT_ID`/`REFRESH_CLIENT_SECRET` as alternative credentials alongside the standard ones, though they're unused.
- **WebView-based OAuth login:** Uses `webview_flutter` to open the Pixiv login page in-app, captures the redirect via a URL listener.
- **Platform-aware User-Agent:** Uses `device_info_plus` to set `PixivAndroidApp/5.0.166 (Android ${version}; ${model})` on Android.
- **Crypto:** Uses Dart's `crypto` package for MD5 hashing (X-Client-Hash) and SHA256 (PKCE code challenge via `CryptoPlugin`).
- **Provisional account creation:** Another endpoint at `accounts.pixiv.net/api/provisional-accounts/create` using a special bearer token (`l-f9qZ0ZyqSwRyZs8-MymbtWBbSxmCu1pmbOlyisou8`).
- **Auto-refresh interceptor:** Automatically catches 400 OAuth errors and refreshes the token transparently.

---

### 6.4 GPPT / GetPixivToken (eggplants/get-pixivpy-token)

- **Repo:** [https://github.com/eggplants/get-pixivpy-token](https://github.com/eggplants/get-pixivpy-token)
- **Language:** Python
- **Package:** `gppt` on PyPI
- **Purpose:** One-shot tool to obtain a Pixiv refresh token

#### Auth methods:
| Method | Supported? | Details |
|---|---|---|
| `password` | ❌ | Not implemented |
| `refresh_token` | ✅ | `refresh()` static method |
| `authorization_code` | ✅ **Primary** | Full PKCE flow with Playwright automation |

#### Key files:
- [`gppt/gppt.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/gppt.py) — Main login/refresh logic
- [`gppt/utils.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/utils.py) — PKCE generation (`_oauth_pkce()`)
- [`gppt/consts.py`](https://github.com/eggplants/get-pixivpy-token/blob/master/gppt/consts.py) — Constants (URLs, credentials)

#### Notable implementation details:
- Uses **Playwright** (Chromium automation) to perform the browser-based OAuth login flow.
- Supports headless mode (for automated/CI use) and headed mode (interactive).
- The `_oauth_pkce()` function is a clean, self-contained reference implementation of RFC 7636.
- The `refresh()` static method is a simple one-shot bearer token refresher.
- Upstream of this project is ZipFile's original Gist + upbit's fork.

---

### 6.5 Pictelio (pixivizer, this project)

- **Repo:** [https://github.com/matt-filion/pixivizer](https://github.com/matt-filion/pixivizer) (assumed)
- **Language:** TypeScript (SolidJS + Capacitor)
- **Platform:** iOS/Android/Web

#### Auth methods:
| Method | Supported? | Details |
|---|---|---|
| `password` | ❌ | Not implemented |
| `refresh_token` | ✅ **Primary** | `refreshToken()` in `packages/app/src/api/auth.ts`, also native Android via `AuthPlugin.java` |
| `authorization_code` | ✅ | PKCE web login via `OAuthPlugin.java` (native Android WebView) + `pkceAuth.ts` — "通过 Pixiv 登录" button in `Login.tsx` |

#### Key files:
- `packages/app/src/api/auth.ts` — `refreshToken()` with web dev fallback
- `packages/app/android/app/src/main/java/io/pictelio/app/AuthPlugin.java` — Native Android refresh
- `packages/app/src/stores/authStore.ts` — Auth state management
- `packages/app/src/routes/Login.tsx` — Login UI (refresh_token input + "通过 Pixiv 登录" PKCE button)
- `packages/app/android/app/src/webview/java/io/pictelio/app/OAuthPlugin.java` — Native PKCE WebView login + code exchange

#### Notable implementation details:
- **Initial token acquisition:** PKCE web login via in-app WebView (OAuthPlugin) — user logs in on pixiv account page. Refresh_token can also be pasted directly (advanced mode).
- **Dual refresh implementation:** Native Capacitor plugin on Android, JS fetch via Vite proxy in web dev mode.
- **Shared retry mechanism:** All concurrent 401 errors share a single `refreshPromise` to avoid duplicate token refreshes.
- **Secure storage:** Tokens stored in Android Keystore via `@aparajita/capacitor-secure-storage`.

---

## 7. Comparison Table

| Feature | pixivpy | pixivpy-async | PixEz | gppt | **pixivizer** |
|---|---|---|---|---|---|
| **Language** | Python | Python | Dart/Flutter | Python | TypeScript |
| **Password grant** | ❌ (README says no) | ❌ (raises LoginError) | ⚠️ (code present) | ❌ | ❌ |
| **Refresh token grant** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Auth code + PKCE** | ❌ (manual) | ✅ (manual code input) | ✅ (in-app WebView) | ✅ (Playwright) | ✅ (in-app WebView) |
| **X-Client-Time/Hash** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Auto-refresh on 401** | ❌ | ❌ | ✅ (interceptor) | ❌ | ✅ |
| **Platform-specific UA** | iOS hardcoded | Android hardcoded | Android dynamic | iOS hardcoded | iOS hardcoded |
| **Initial token flow** | External tool | URL + code prompt | WebView login | Playwright auto | WebView login |
| **Cloudflare bypass** | cloudscraper | aiohttp | Rhttp custom | None needed (Playwright) | None (native) |
| **Secures token storage** | No | No | SQLite/SharedPrefs | N/A (one-shot) | ✅ Android Keystore |

---

## 8. Summary of Findings

### What third-party clients actually use

1. **Primary authentication flow:** `refresh_token` grant type at `POST https://oauth.secure.pixiv.net/auth/token`.
2. **Initial token acquisition:** `authorization_code` grant type with PKCE (S256), performed via a browser/WebView flow.
3. **Password grant:** Effectively dead. No modern client relies on it; pixivpy-async explicitly prevents its use.

### What Pixiv allows vs. blocks

| Feature | Allowed? | Notes |
|---|---|---|
| `grant_type=refresh_token` | ✅ Yes | Works reliably |
| `grant_type=authorization_code` | ✅ Yes | Requires PKCE |
| `grant_type=password` | ❌ No | Blocked/rate-limited since ~2021 |
| Browser-based login | ✅ Yes (required for initial auth code) | Pixiv login page works normally |
| Custom User-Agent | ✅ Yes | iOS/Android user agents both work |
| X-Client-Time/Hash | ✅ Required | Mandatory since 2019 |
| Same CLIENT_ID/SECRET | ✅ Yes | Hasn't changed in years |

### What the pixivizer project is missing

1. **No password fallback** — This is by design and appropriate given Pixiv's restrictions.

### Recommendations for improving auth

If implementing an OAuth authorization code flow:

1. **On mobile (Android/iOS):** Use the system browser (Custom Tabs / ASWebAuthenticationSession) with a custom scheme redirect URI (e.g., `pixivizer://callback`). This avoids embedding a WebView and allows users to use saved passwords/biometrics.

2. **On desktop/web:** Use a popup window or redirect flow with PKCE. The redirect URI should point to a local page that can capture the authorization code.

3. **PKCE implementation:** Follow the RFC 7636 standard — generate a 43-character `code_verifier` (URL-safe random), SHA256 hash it, base64url-encode without padding for `code_challenge`.

4. **Token lifecycle:** On every refresh, persist the **new** `refresh_token` from the response. The old one is immediately invalidated by Pixiv.

### References

- [pixivpy (upbit/pixivpy)](https://github.com/upbit/pixivpy) — Python Pixiv API client
- [pixivpy-async (Mikubill/pixivpy-async)](https://github.com/Mikubill/pixivpy-async) — Async Python Pixiv client
- [PixEz Flutter (Notsfsssf/pixez-flutter)](https://github.com/Notsfsssf/pixez-flutter) — Flutter Pixiv client
- [gppt (eggplants/get-pixivpy-token)](https://github.com/eggplants/get-pixivpy-token) — Pixiv token getter tool
- [ZipFile's Pixiv OAuth Flow Gist](https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362) — Original OAuth flow reference
- [upbit's OAuth with Selenium Gist](https://gist.github.com/upbit/6edda27cb1644e94183291109b8a5fde) — Selenium-based OAuth flow
- [RFC 7636 — Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
