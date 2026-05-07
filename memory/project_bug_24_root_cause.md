---
name: Bug 24 Root Cause — Liquid contains operator misused as filter
description: Documents the root cause of the account.liquid big inline script parse error (bug #24) so future developers avoid the same pattern.
type: project
---

# Bug 24: `| contains` is a Liquid operator, not a filter

## What went wrong

In `templates/customers/account.liquid` line 1247, the `isStaff` field in the
`serverSubData` JS object was emitted as:

```liquid
isStaff: {{ customer.tags | join: ',' | downcase | contains: 'staff' | json }}
```

`contains` is a **Liquid comparison operator** (used in `{% if x contains 'y' %}`),
not a filter. Shopify's Liquid runtime therefore outputs an error string inline:

```
Liquid error: Unknown filter 'contains'
```

This string is injected directly into the JavaScript object literal, producing:

```javascript
isStaff: Liquid error: Unknown filter 'contains'
```

— invalid JavaScript. The browser's JS engine throws `Uncaught SyntaxError:
missing ) after argument list` and aborts the entire `<script>` block.
Shopify theme-check reports `SyntaxError: Expected id but found comparison` /
`UnknownFilter` on that line, and (in newer versions) `LiquidHTMLSyntaxError:
Attempting to end parsing before HtmlElement 'script' was closed` because the
broken script content leaves the parser in a bad state.

## The fix (2-line change, commit on fix/bug-24-account-parse-error)

```liquid
{%- assign _cts = customer.tags | join: ',' | downcase -%}
isStaff: {%- if _cts contains 'staff' -%}true{%- else -%}false{%- endif -%}
```

## The pattern to avoid

**Never use `contains` (or any other Liquid operator) after a `|` pipe.**

Liquid operators (`contains`, `==`, `!=`, `>`, `<`, `and`, `or`, `not`) only
work inside `{% if %}` / `{% unless %}` conditions — they are NOT filters.

Correct pattern for a boolean tag check inside a JS emit:

```liquid
{%- assign _tags_lower = customer.tags | join: ',' | downcase -%}
someJsKey: {%- if _tags_lower contains 'needle' -%}true{%- else -%}false{%- endif -%}
```

## Broader rule

Any `{{ ... }}` emit inside a `<script>` block that produces non-JSON output
(error strings, raw Liquid objects, etc.) silently corrupts the JS. Always:

1. Use `| json` as the **last** filter on every `{{ }}` emit inside `<script>`.
2. Use only valid Liquid filters in filter chains — no operators.
3. For boolean checks, use `{% if %}...{% endif %}` not a filter chain.
