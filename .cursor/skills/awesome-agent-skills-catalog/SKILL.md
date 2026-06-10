---
name: awesome-agent-skills-catalog
description: Browse and discover 1000+ agent skills from the VoltAgent awesome-agent-skills curated index. Use when the user asks to find, recommend, or install additional skills, or when you need to locate official skills from Anthropic, Vercel, Stripe, Supabase, Google Labs, Trail of Bits, and other teams. Local catalog at CATALOG.md; online at https://officialskills.sh/ and https://github.com/VoltAgent/awesome-agent-skills.
license: MIT
---

# Awesome Agent Skills Catalog

Local copy of [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) — a curated index of 1000+ production agent skills.

## When to use

- User wants more skills beyond what is already installed
- User asks what skills exist for a domain (security, PDF, React, Stripe, etc.)
- You need to find the official repo/path for a skill before installing

## How to find skills

1. Read `CATALOG.md` in this directory (search by keyword)
2. Or browse online: https://officialskills.sh/
3. Install a found skill with:
   ```bash
   npx skills add <owner/repo> -a cursor -s <skill-name> -y
   ```
   Or copy its `SKILL.md` folder into `.cursor/skills/`.

## Already installed in this project

- karpathy-guidelines, playwright-skill, pdf, docx
- addyosmani/agent-skills (23 engineering lifecycle skills)

## Security

Review third-party skills before installing. See catalog Security Notice section.
