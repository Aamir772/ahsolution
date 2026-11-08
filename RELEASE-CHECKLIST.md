# RELEASE-CHECKLIST.md

**Project:** AH SOLUTION  
**Release Version:** TBD  
**Target Date:** TBD  
**Release Manager:** TBD  

## Pre-Release Gate (Must Pass)

### P0 - Security & Blockers
- [ ] No unresolved P0 security findings
- [ ] Secrets scan clean (no secrets in repo)
- [ ] Dependencies reviewed (critical vulns addressed or accepted)
- [ ] Auth/permissions verified for sensitive actions

### Build & Quality
- [ ] 
pm run build succeeds
- [ ] Relevant QA passes (
pm run qa or targeted tests)
- [ ] No console errors on core journeys
- [ ] Regression tests added for bugs fixed

### Functionality
- [ ] Core navigation, homepage, blog, articles, videos work
- [ ] Forms work correctly
- [ ] Admin/CMS functions (if releasing CMS changes) tested

### SEO/UX/Perf
- [ ] Meta/canonical/schema intact
- [ ] Responsive/mobile checks pass
- [ ] Performance acceptable (no major regressions)

### Deployment Readiness
- [ ] Environment variables set in target env
- [ ] 
etlify.toml correct
- [ ] Rollback plan documented (git commit/branch or deploy history)
- [ ] Monitoring/health check plan noted

## Post-Release
- [ ] Smoke test production URL
- [ ] Check critical errors/logs
- [ ] Monitor for issues
- [ ] Update changelog/release notes

## Sign-off
- QA: _____ Date: _____
- Security: _____ Date: _____
- Release: _____ Date: _____

## Notes
Distinguish code-level tests vs deployed-env verification vs manual pen test.
