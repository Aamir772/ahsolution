# UPGRADE-ROADMAP.md

**Project:** AH SOLUTION  
**Last Updated:** 2026-10-28  

## Prioritization
- P0: Actively exploitable / critical / production blocker
- P1: High-risk / broken core / data integrity
- P2: Major perf/a11y/responsive/SEO
- P3: Enhancements/polish

## Roadmap

| ID | Priority | Area | Task | Dependencies | Risks | Acceptance Criteria | Status (TODO/IN-PROGRESS/DONE/BLOCKED) | Target/Sprint |
|---|---|--------|------|--------------|-------|-------------------|----------------------------------------|---------------|
| UP-001 | P0 | Security | Baseline security audit per checklist | None | Incomplete scan | All P0 security items tested with evidence | TODO | Sprint 1 |
| UP-002 | P1 | Auth/CMS | Review admin auth, RLS, permissions | UP-001 | Privilege escalation | Protected routes/enforced; tests pass | TODO | Sprint 1 |
| UP-003 | P1 | Build/Release | Verify build + QA scripts pass | None | Deploy failure | npm run build/qa green or gaps documented | TODO | Sprint 1 |
| UP-004 | P1 | AI Safety | Review SOLUTION AI/tool perms/injection | UP-001 | Data leakage | Safety checks pass/documented | TODO | Sprint 2 |
| UP-005 | P2 | Performance/Mobile | Responsive/perf checks | None | UX regressions | qa-pages + perf acceptable | TODO | Sprint 2 |
| UP-006 | P2 | SEO/A11y | Meta/schema/a11y fixes | None | Discoverability | Core SEO/a11y items pass | TODO | Sprint 2 |
| UP-007 | P3 | Polish | 3D/effects/enhancements | All above | Perf regression | Regression tests pass | TODO | Sprint 3 |

## Notes
Only start P1 after P0 confirmed or explicitly accepted with rationale.
