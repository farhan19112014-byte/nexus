# NEXUS — preview this version safely

This ZIP is the complete NEXUS project with the new website design. To try it without touching your current folder:

1. Unzip into a **new, empty folder** (for example `nexus-preview`). Don't unzip over your existing NEXUS folder.
2. In that folder run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:8787** in your browser.
   - Home page: `/`
   - Robot / interaction page: `/app`
   - About: `/about` · Privacy: `/privacy`

`index.html` is at the root of the project. It is the Vite entry point, so it needs the build (`npm start`) and can't be opened by double-clicking it.

## AI replies
- If you don't set a key, NEXUS runs in its **demo brain**, which is clearly labelled and is not an LLM.
- For real replies, put your key in a `.env` file on the server side, the same way as before (`GEMINI_API_KEY=...`). Keys are never placed in the frontend.

## Check it
```
npm run report
```
This runs the typecheck, build, lint, unit tests, browser tests and a desktop smoke test.

## Keep it or drop it
If you like it, copy the changed files into your repo, or commit from this folder. If you don't, delete the new folder: your original project was not changed.
