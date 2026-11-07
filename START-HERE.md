# AELVOR — Final Project

Copyright © 2026 Alen Pepa

This package contains the complete source code for site version 47, including tests, configuration, the model catalog, and instructions. The project files are unchanged from this commit:

`fa24245d5f0a26dae88a9b028e94627dfdedb5a5`

## Running on your computer

1. Extract the ZIP and open a terminal inside the `AELVOR` folder.
2. Install Node.js 24.x, then run:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open the local address printed in the terminal in your browser. Keep the terminal running while using the app. The `pnpm start` command starts the local production server; this package is not an EXE, APK, or IPA installer.

The first installation and build require an internet connection to download dependencies. Large AI models are not included in the ZIP: select and download them through AI Setup in the app. You can start immediately with the built-in local assistant for the tasks it supports. Open-ended conversation requires loading a language model. No API key is needed for local models.

## Development

After installing dependencies, run:

```sh
node scripts/prepare-cpu-runtime.mjs
pnpm dev
```

Open the address printed in the terminal, usually `http://localhost:5173`. Clean source snapshots automatically use the portable profile; local development-environment settings are not included in the ZIP.

## Testing and building

```sh
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

The published snapshot passed 603 tests, TypeScript checks, and production-package checks. Physical GPU, microphone, native Windows, and actual browser interaction still require separate testing. Read `README.md` for details about features and verification limits.

## Package contents and deployment

The package includes source code, version-controlled public files, tests, the dependency lockfile, scripts, `COPYRIGHT`, and third-party notices. `SOURCE-MANIFEST.json` records the SHA-256 hash of every original file. This guide and the manifest are additions to the download package.

Conversation history, drafts, device reports, downloaded models, Git credentials, installed dependencies, and temporary folders are not included. Browser-stored user data can be exported separately from the app.

For deployment, configure the appropriate production hosting and access settings. The local portable configuration uses a development identity and must not be treated as configured public authentication. Downloading this package does not change the existing site or its access settings.

Site: https://aegis-cyber-agent-alen.xalenpepa3.chatgpt.site
