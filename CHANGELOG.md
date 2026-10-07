# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-10-07

### 📋 Release Summary

Clockoli now supports multi-user and multi-repository tracking, GitHub teammate invitations, arbitrary URL tasks, work-item snapshots, task merging, and redesigned timeline and tracking workflows. It adds Clockify migration, UTC reporting, currency conversion, local invoicing, client-linked projects, and improved PDF exports. Fixes improve GitHub connections, repository setup, timer synchronization, timeline editing, backup restoration, and invoice PDF rendering.

### ✨ New Features & Enhancements

- complete Clockify multi-user migration and optional invitations `26155373`
- add verified GitHub teammate invitations `5a1a8a0b`
- explicitly connect repositories and support unresolved work `26545664`
- Improve docs ref: #6 `26405986`
- **activity**: compact tracked-time rows `95d04b40`
- **settings**: scope task merges by repository `777cf060`
- **settings**: batch merge tracked tasks `d0905cbe`
- **tasks**: merge tracked task identities `2302c22b`
- **navigation**: link Clockoli logo to website `54fd1b4d`
- **invoices**: improve task details and PDF export `e81c00ba`
- extend multi-repository tracking workflow `f7c7f2c6`
- **reports**: support UTC date range reporting `29b8ac18`
- **invoicing**: modernize invoice workflows `a706fff1`
- **invoicing**: link clients to projects `c1c8649a`
- **invoicing**: add local invoice workflows `53f864e6`
- replace timeline editor and harden tracking UI `3c8effb5`
- **ui**: improve tracking and timeline UX `abbe846d`
- move timeline tracking into toolbar `9475ef0b`
- add Clockify migration `f7ee8cde`
- add durable timeline entry deletion `b30b4b29`
- add durable full-width timeline tracking `456190d7`
- animate Clockoli while tracking current task `35a4c4bb`
- capture GitHub work item snapshots `4214d296`
- adopt canonical work record format `20d43eca`
- add currency conversion and task switching `6cea590f`
- improve repository setup and PDF timesheets `e74294f5`
- improve Clockoli settings and onboarding `5e045e64`
- use combined Clockoli wordmark `ed9781bb`
- streamline Clockoli tracking UI `55c547e1`
- rebrand RepoClock as Clockoli `7eb23c88`
- add page tabs and currency-aware billing `bcebc6ff`
- add unified time workflows `d8bcc7ee`
- refine tracking layout `071c2740`
- track arbitrary URL tasks `667abce8`
- add personal storage branches and billing reports `bb1b2630`
- streamline data repository setup `1e10dd8e`
- streamline GitHub App onboarding `12dba53b`
- add secure onboarding and inline time editing `0a928ff6`

### 🔧 Improvements & Optimizations

- **release**: automate tagged release packaging `af77461d`
- **styles**: align GitHub and options UI `39dbb4d1`
- **ui**: refine forms and invoice previews `f8bf13e8`
- **timeline**: refine editor and visual states `391fe85d`
- integrate timeline into Clockoli `14900593`

### 🐛 Bug Fixes & Stability

- **content-runtime**: fix timezone-dependent timeline test `f4cda909`
- bind Clockify report pages to capture requests `39038a6d`
- show empty Top tasks for no selected users `7e5d6e5c`
- Imported records mismatch `9015ae67`
- make Clockify migration jobs durable and retryable `a796a00f`
- hide repository status during discovery `735a94e4`
- tolerate sync alarm rejection during worker replacement `b7603d2a`
- stabilize repository setup and status feedback `f80b1205`
- preserve timeline task focus across renders `d02acfdf`
- GH connection issues ref: #15 `1c88eaf2`
- fix tests `a7007ec1`
- keep timeline grips and saving indicator clear of content `70ead912`
- show timeline resize grips only on interaction `a5f80856`
- keep timeline entries editable while saves are queued `f5e9f743`
- open navigation tabs without waiting for refresh `6ed1174f`
- preserve unresolved work across activity and repository flows `1e7e2168`
- stabilize Clockify migration controls `d84b8a45`
- remove Clockify URL inference `f9840eda`
- stabilize Clockify page migration `5c2b974f`
- **activity**: unify record editing `0b1e404e`
- **activity**: remove time repository labels `30d42f19`
- **tasks**: separate titled task URLs `4dcd2e95`
- **settings**: partially restore backups `6adaf1ae`
- **invoices**: increase PDF render resolution `cfad110c`
- **invoices**: preserve seller spacing in PDF export `14f4ea1c`
- **settings**: retain selected default destination `70de6d4a`
- **settings**: reject stale preference saves `b3c72d03`
- **settings**: preserve project client links in backups `7c56ded8`
- **settings**: import routed v6 invoicing backups `5829c83e`
- **invoices**: keep seller spacing on rendered words `a8df3bc8`
- **invoices**: preserve seller gap in canvas export `fb953e5e`
- **invoices**: render explicit seller name gap `27ac1bbc`
- **invoices**: preserve seller name spacing in PDFs `05ef8b49`
- **invoices**: render PDFs from HTML preview `2d66f337`
- **invoices**: emit real PDF stream newlines `eea1417a`
- **invoices**: render readable multipage PDFs `0c3f2e95`
- **invoices**: use seller name for PDF filename `a43e5d1e`
- **invoices**: write valid PDFs without closing preview `34a7a6c7`
- **invoices**: download PDFs and keep numeric columns intact `d835fdf7`
- **settings**: expand repositories individually `69633250`
- **settings**: hide empty default repository controls `ceaeb46b`
- **settings**: collapse time repositories by default `b699acdd`
- **ui**: recover UI/UX interface fixes during merge in past (#8) `49581001`
- **reports**: show resolved dates for period presets `ce84e98a`
- **reports**: refine report layouts `12ef91cf`
- **settings**: improve form handling `bac0a42c`
- **billing**: preserve invoice counters on restore `e61e8978`
- **timeline**: align full-width panel gutters `b65e446f`
- keep short timeline blocks in their hour `47a314f6`
- allow cross-page timeline edits `5e5c3118`
- label single empty timeline hours plainly `702ec7d5`
- keep timeline edits within item rows `9643d112`
- augment only native GitHub participants `3b73ac5d`
- sharpen timeline icon on high-DPI displays `f44555de`
- preserve GitHub timeline badge geometry `fe8ed48b`
- support GitHub React timeline events `df98167c`
- render truncated Clockoli timeline entries `a821dda4`
- harden timer reconciliation and task views `eb60c847`
- make background timer sync automatic `331d6eee`
- make timer actions respond immediately `70cbce45`
- streamline tracking and reporting workflows `cb31f29e`
- complete Clockoli namespace migration `30e57150`
- migrate storage markers to Clockoli `8713e426`
- migrate to Clockoli GitHub App `faed5f53`
- use Clockoli data repository template `151d6a15`
- improve Clockoli icon visibility `4235f0fa`
- restore direct recent time editing `84d04438`
- simplify recent time controls `1e7b7603`
- preserve linked time boundaries `35391be1`
- make tracking panel interactions immediate `ed25af47`
- clarify device authorization actions `8adc92b8`
- advance after repository access `31351a57`
- clarify repository access monitoring `21087368`
- make repository setup self-healing `84f16bac`
- close repository setup races `466e7661`
- simplify repository setup `5aee75b4`
- harden stop conflicts and enable GitHub App `a233a61b`

### 📚 Documentation & Examples

- **privacy**: document invoice settings storage `a160b352`
- align setup and migration guides with current flows `bda61872`
- **design**: capture current Activity view `9b3c4833`
- add contributor and agent guides `a562e6a4`
- add RepoClock user guide `1e2c7462`

### 🔄 Other Changes

23 maintenance, dependency, and tooling updates not listed individually.
