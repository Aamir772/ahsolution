# SECURITY-AUDIT.md

**Project:** AH SOLUTION  
**Last Updated:** 2026-10-28  
**Status:** BASELINE ESTABLISHED - INSPECTION COMPLETE  

## Purpose
Track security findings, evidence, remediation, and retest results for every audit.

## Findings Register

| ID | Category | Severity (P0/P1/P2/P3) | Location (file/endpoint) | Description | Evidence | Status (OPEN/IN-PROGRESS/REMEDIATED/ACCEPTED) | Remediation Plan | Retest Evidence | Owner | Due Date |
|---|---|--------|------------------------|-------------|----------|-------------------------------------------|------------------|-----------------|-------|----------|
| SEC-001 | Secrets/History | P2 | Git history | No obvious .env committed; .env.example present; no lockfile | git status/log + file scan | OPEN | Review git history for secrets | | | |
| SEC-002 | Dependencies | P2 | package.json | No package-lock.json present - npm audit cannot run fully | npm audit attempted (ENOLOCK) | OPEN | Generate lockfile and run audit | | | |
| SEC-003 | Headers/CORS | P1 | netlify.toml | Security headers set; admin noindex/no-store; redirects configured | netlify.toml review | OPEN | Verify headers in prod | | | |
| SEC-004 | Auth/Admin | P1 | netlify/functions/admin-auth,init-admin | Admin functions present | File review | OPEN | Review authZ/authN + RLS | | | |
| SEC-005 | AI Safety | P1 | netlify/functions/localize, assets/js/ai.js | Localize has validation/rate limiting; AI has own i18n | Code review | OPEN | Prompt injection/tool perms review | | | |
| SEC-006 | QA/Regressions | P2 | scripts/qa-* | qa-pages: 20/22 passed; qa-blog: 365/402 passed; qa-admin: 80/80; ai-qa: 74/74 | Test runs | OPEN | Fix failing qa-blog/qa-pages items | | | |


## Checklist Quick Reference
- [ ] Secrets scan (git history + source)
- [ ] Dependencies (npm audit)
- [ ] AuthZ/AuthN
- [ ] Supabase RLS
- [ ] API validation/rate limiting/CORS/headers
- [ ] Injection/XSS/CSRF/redirects/SSRF
- [ ] AI prompt injection/tool perms/secrets
- [ ] Privacy/logging/retention
- [ ] HTTPS/cookies/env/prod config

## Notes
Do not print secret values. Redact tokens/keys in evidence.


