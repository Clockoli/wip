# Documentation writing guidelines

Use these guidelines when changing Clockoli documentation.

## Write for the reader

- **User guides** explain how to complete a task, what happens, and what to do when something goes wrong.
- **Technical references** document formats, security boundaries, architecture, and invariants.
- **Maintainer material** covers tests, packaging, diagnostics, and release procedures.

Keep the main path short. Explain advanced cases in a separate section or link to the relevant reference.

## Prefer clear language

- Start with the outcome, then give the steps.
- Use short sentences and familiar words. Prefer “Clockoli saves the change in your browser” to “The mutation is durably accepted into IndexedDB.”
- Use **Select** for an on-screen control, **Enter** for typed values, and **Press** for a keyboard key.
- Copy UI labels exactly, including capitalization. Refer to **Settings → Time repositories**, for example.
- State limits and warnings when they affect the user's decision, not as an exhaustive list of internal checks.
- Use descriptive link text instead of “click here.”

## Keep one source of truth

- Describe each workflow in one primary guide; link to it from other pages.
- Avoid repeating JSON schemas outside [Data format v1](data-format-v1.md).
- Do not copy internal queue algorithms into user-facing instructions.
- Keep troubleshooting focused on the symptom, the likely cause, and a safe recovery action.
- Prefer updating existing material over appending a new paragraph for each bug fix.

## Verify changes

1. Compare behavior and button labels with the current code or browser UI; old screenshots and docs can be stale.
2. Check internal links and Markdown headings.
3. Ensure examples contain no real credentials, private task details, or customer data.
4. Preserve safety warnings, privacy disclosures, and normative data contracts when simplifying prose.
5. Update screenshots only when the depicted UI has changed.

The [documentation index](README.md) separates user guides from technical reference and maintainer material.
