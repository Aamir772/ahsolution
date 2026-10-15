# AH Solution Admin UI — upgraded review build

This folder contains upgraded frontend files derived from the supplied admin files:
- `admin.css`
- `admin.js`
- `login.html`
- `reset-password.html`
- `dashboard.html`
- `editor.html`

## Important
This is a frontend/code-quality upgrade, not proof of a working production CMS. It does not include or validate the server-side Netlify Functions. Keep the existing project versions backed up before copying these files.

### Required server endpoints
The UI expects:
- `POST /.netlify/functions/admin-auth` with `action: login`
- `POST /.netlify/functions/admin-auth` with `action: refresh`
- `POST /.netlify/functions/admin-auth` with `action: send_password_reset`
- `POST /.netlify/functions/admin-auth` with `action: update_password`
- `POST /.netlify/functions/articles` with list/create/update/publish/unpublish/delete actions
- `POST /.netlify/functions/upload-cover` for authenticated image uploads

The reset UI sends both `access_token` and legacy `jwt` to `update_password`. Confirm the backend accepts `access_token` and calls Supabase Auth's user-update endpoint with the recovery token. Supabase may send `access_token`/`type=recovery` in the URL fragment, or a `code` query parameter depending on the flow. This page handles fragment/query access tokens; code exchange requires explicit backend support and is surfaced as a message.

## Storage
The editor no longer claims that uploads go to a Supabase `covers` bucket. The actual storage target depends on your deployed `upload-cover` function. If moving to Netlify Blobs, update that function and verify it checks the authenticated admin before writing, validates MIME type/size, and generates safe unique object keys.

## Security notes
- The browser must never contain a Supabase service-role key or Netlify privileged secret.
- The Netlify Functions must enforce the admin allowlist/role on every write and upload. Hiding buttons in the UI is not authorization.
- Article HTML must be sanitized server-side before publishing/rendering. `contenteditable` content is untrusted input.
- `sessionStorage` is used for the short-lived browser session copy. The server must still validate token/role on every protected request.
- Configure Supabase Site URL and Redirect URLs to include `https://ahsolution.live/admin/reset-password.html` and any local development URL you use.

## Manual verification checklist
1. Deploy to a preview URL with function environment variables configured.
2. Open `/admin/login.html`; test invalid credentials and network/server errors.
3. Request a reset link, open it in the same browser, and verify the new-password form appears.
4. Update password, then sign in with the new password.
5. Verify a non-admin account is rejected server-side.
6. Create a draft, refresh, edit it, publish/unpublish, and delete a test article.
7. Upload a valid image and verify the returned URL loads publicly; try oversized and non-image files.
8. Test at 320px, 375px, 768px and desktop widths.
9. Inspect Netlify function logs and ensure no secret values or reset tokens are logged.
