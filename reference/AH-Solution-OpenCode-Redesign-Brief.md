# AH Solution — Cinematic Redesign Brief for OpenCode

## Project
`F:\AI Project\AH Solution`

## Visual reference
Use the attached concept image `ah-solution-cinematic-concept.png` as the visual direction reference. It is a design target, not a replacement for the actual website or a source of production assets.

## Objective
Upgrade the existing AH Solution website to a premium, cinematic technology experience inspired by the concept:
- Black / deep-charcoal environment
- Existing crimson-red brand accents
- Golden/amber holographic AI core with intricate circuitry, layered orbital rings, particles, and a bright central AH emblem
- Clear, bold “Technology. Simplified.” headline
- Premium typography, restrained glow, strong hierarchy, polished navigation and calls to action
- Responsive desktop, tablet, and mobile layouts

## Inspect first
Inspect the existing HTML pages, CSS, JavaScript, Three.js/WebGL implementation, image assets, navigation, video pages, guides, blog/articles, search, AI functionality, admin CMS, backend functions, `README.md`, `package.json`, `netlify.toml`, and existing QA scripts. Record the current Git state and baseline test results before editing.

## Implementation requirements
1. Improve the existing Three.js/WebGL globe rather than replacing it with a static image.
2. Use layered geometry, procedural circuit-like details, particles, lighting, and orbital elements where practical.
3. Keep the current AH Solution logo, central AI interaction, site content, routes, and features.
4. Ensure correct canvas dimensions, camera aspect ratio, resize handling, device pixel ratio, clipping, and responsive sizing.
5. On narrow screens, use a deliberate stacked hero layout so the globe does not crowd the headline or buttons.
6. Respect `prefers-reduced-motion`; keep animation smooth and avoid expensive post-processing or excessive GPU use.
7. Provide a graceful fallback if WebGL is unavailable.
8. Keep assets and URLs compatible with GitHub Pages project hosting at `/ahsolution/`. Check for root-relative URLs that break under the project subpath.
9. Preserve SEO metadata, accessibility, social links, analytics, existing content pages, and any ad placements already implemented.
10. Do not expose credentials, tokens, or service-role keys in frontend code.
11. Do not silently remove Netlify Functions or backend-dependent admin features. Clearly report which features cannot run on GitHub Pages alone.

## QA
- Run existing QA scripts and available build checks.
- Test homepage, navigation, video/blog/article/guide pages, AI interaction, mobile/tablet layouts, and WebGL fallback.
- Inspect console errors, failed network requests, overflow/clipping, and canvas rendering.
- Report actual tests and outcomes; never claim tests passed unless run.

## Safety restrictions
- Work only in `F:\AI Project\AH Solution`.
- Do not commit, push, deploy, alter DNS, delete databases, or modify production settings.
- Do not overwrite the site with a new template.
- Make small, justified changes and provide a summary of changed files, tests, and remaining issues.
- Stop after local implementation and verification, ready for user review.
