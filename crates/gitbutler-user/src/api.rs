//! Client for the GitButler web API authentication endpoints.
//!
//! These functions make server-side HTTP calls to `app.gitbutler.com` (or staging)
//! so that browser-based frontends don't need to make cross-origin requests.
//! They are also usable from the CLI (`but auth`) without any web framework dependency.

use anyhow::{Context, Result};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

/// Error returned when the upstream API rejects a request with an HTTP error status.
#[derive(Debug, thiserror::Error)]
#[error("API request failed ({status}): {body}")]
pub struct ApiHttpError {
    pub status: StatusCode,
    pub body: String,
}

/// Returns the GitButler API base URL.
///
/// Resolution order:
/// 1. `GITBUTLER_API_URL` env var at runtime (e.g. `http://localhost:3000`)
/// 2. Compile-time `CHANNEL` env var:
///    - `"release"` / `"nightly"` → `https://app.gitbutler.com`
///    - anything else → `https://app.staging.gitbutler.com`
pub fn default_api_url() -> String {
    if let Ok(url) = std::env::var("GITBUTLER_API_URL") {
        return url;
    }
    match option_env!("CHANNEL") {
        Some("release" | "nightly") => "https://app.gitbutler.com",
        _ => "https://app.staging.gitbutler.com",
    }
    .to_string()
}

/// Response from `POST /api/login/token.json`.
#[derive(Debug, Deserialize, Serialize)]
pub struct LoginToken {
    /// Polling token returned by the API for completing login.
    ///
    /// This value is sensitive. Although it is obtained via a server-side HTTP
    /// call, this struct may be returned from backend commands to browser-based
    /// frontends, so callers must avoid exposing or logging it unnecessarily.
    pub token: String,
    /// Token shown to the user after authentication on gitbutler.com.
    pub browser_token: String,
    /// Expiration timestamp.
    pub expires: String,
    /// The full URL to redirect the user's browser to for login.
    pub url: String,
}

/// Request a new login token from the GitButler API.
///
/// The returned [`LoginToken::url`] should be opened in the user's browser.
/// After the user authenticates, they receive a token that can be validated
/// with [`fetch_user_by_token`].
pub async fn fetch_login_token(api_url: &str) -> Result<LoginToken> {
    let url = format!("{api_url}/api/login/token.json");
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .send()
        .await
        .context("Failed to reach GitButler API for login token")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Login token request failed ({status}): {body}");
    }
    resp.json()
        .await
        .context("Failed to parse login token response")
}

/// Validate an access token against the GitButler API and return the user info.
///
/// Calls `GET /api/login/whoami` with the given token. On success the full
/// user object is returned as a [`serde_json::Value`] so callers can
/// deserialize into whatever type they need (the frontend `User` has
/// different fields than the Rust `User`).
pub async fn fetch_user_by_token(api_url: &str, token: &str) -> Result<serde_json::Value> {
    let url = format!("{api_url}/api/login/whoami");
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("X-Auth-Token", token)
        .send()
        .await
        .context("Failed to reach GitButler API for token validation")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiHttpError { status, body }.into());
    }
    resp.json().await.context("Failed to parse whoami response")
}

/// Check whether a token belongs to a specific user.
///
/// This is a convenience wrapper around [`fetch_user_by_token`] used by
/// the remote-access auth middleware to verify that the authenticated user
/// matches the local machine owner.
///
/// Returns `Ok(false)` for invalid/expired tokens (upstream 401/403) so that
/// callers can distinguish "not the owner" from actual errors. Only network
/// failures and unexpected responses produce `Err`.
pub async fn validate_token_owner(
    api_url: &str,
    token: &str,
    expected_user_id: u64,
) -> Result<bool> {
    let user = match fetch_user_by_token(api_url, token).await {
        Ok(user) => user,
        Err(e) => match e.downcast_ref::<ApiHttpError>() {
            Some(http_err) if http_err.status.is_client_error() => return Ok(false),
            _ => return Err(e),
        },
    };
    let id = user
        .get("id")
        .and_then(|v| v.as_u64())
        .context("whoami response missing 'id' field")?;
    Ok(id == expected_user_id)
}
