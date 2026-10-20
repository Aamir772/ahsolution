# AH Solution — Blog Article Draft Format (canonical spec)

Every file in `blog/articles/*.md` MUST follow this exact structure. The
build/import scripts parse this format, so do not invent new sections or
reorder the skeleton. Everything is Hinglish written in Roman script.

## Skeleton (in order)

```markdown
# {Exact article title from manifest, as H1 — only H1 in the file}

> **Draft for review · Article {NN}/17 · Language: Hinglish**

![{descriptive alt text}]({https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg} "AH Solution source video thumbnail")

{Intro: 2–4 paragraphs, 140–220 words total. Hook the reader, state what the
original video covers, and honestly frame what the article adds (checklist,
context, current-state notes). Never claim to have watched the video unless
the CSV/metadata proves what is in it.}

**Original video:** [{source title exactly}]({source video URL exactly})
**Video published:** {date} · **Duration:** {duration}

<!--TOC-->

{Body sections — 5 to 8 H2 sections, with H3s where genuinely useful.}

## Troubleshooting aur limitations

{Honest limitations of the topic/feature/tool + common failure cases and fixes.}

## Safety aur privacy

{Relevant safety/privacy considerations. If genuinely none, give the closest
real ones — permissions, data handling, purchase risk — never filler.}

## Frequently asked questions

### {Real user question as H3}
{Answer 40–80 words.}

{4–6 FAQs total.}

## Final recommendations

{Conclusion: 80–140 words, practical, no marketing fluff.}

## Watch the original AH Solution video

<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/{VIDEO_ID}" title="{escaped source title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

[Watch on YouTube]({source video URL}) · [AH Solution channel](https://www.youtube.com/@ah.solution)

## Image package

1. **Featured image / social preview:** … (1200×630 target)
2. **Listing thumbnail:** … (640×360 target)
3. **In-article visual:** … (1200×800 target)
4. **Alt text guidance.**
5. **Rights check reminder.**

---

**Editorial note:** {what still needs human verification before publish.}
```

## Rules

1. `<!--TOC-->` is mandatory. The build script replaces it with a generated
   table of contents built from the file's H2 headings. Never write a manual
   TOC.
2. Exactly one H1 (the title). Section headings are H2; sub-points are H3.
   Never H4+.
3. Keep the YouTube thumbnail image line, the "Original video" line, the
   iframe block, and the "Image package" + "Editorial note" sections for
   every article. Video ID and URL must match the manifest exactly.
4. Length: 1,150–1,500 words of article body (everything before
   `## Image package`). Aim ~1,250. Never pad with repetition.
5. Internal links: relative paths that exist on the site, used naturally:
   - `blog.html`, `vlogs.html`, `vlogs.html#shorts`, `tutorials.html`
   - `guides/live-wallpaper-on-pc.html` (PC wallpaper/customization topics)
   - `guides/choose-android-apps-safely.html` (app install/safety topics)
   - `guides/budget-smartwatch-checklist.html` (smartwatch topics)
   - `about.html`, `contact.html`, `privacy.html`, `terms.html#disclaimer`
   - `article.html?slug={other-slug}` (cross-links between the 17, 0–2 max)
   Use 2–5 internal links per article, only where relevant.
6. Accuracy:
   - Never invent prices, benchmarks, benchmark numbers, app names, demo
     results or specifications. "Verify on official listing" notes are fine.
   - Videos from 2020–2021 are historical context. Separate "video ke time
     ka context" from "aaj ke liye practical advice".
   - If the CSV did not include facts (e.g. exact app names in listicle
     videos), do not fabricate them. Teach the evaluation framework and add a
     clearly marked verification note in the editorial section.
7. Tone: practical, conversational Hinglish; technical terms stay in English.
   Address the reader as "aap". No keyword stuffing, no English-template
   feel.
8. Formatting: bold for key terms, lists for checklists, markdown pipe tables
   for comparisons (supported by the build script). No HTML except the
   iframe.
9. Do not add unrelated promotional text, affiliate links or CTAs beyond the
   standard video/channel links.
