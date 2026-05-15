# Books admin (local-only)

A small static HTML page that lets you add, edit, or delete entries in `files/books.json` and commits the change to the repo via the GitHub Contents API. It is **not** served from `valeriova96.github.io` — it lives under `tools/` precisely so the build pipeline never picks it up.

## Publishing a book

1. **Create a GitHub fine-grained personal access token (PAT)** scoped to this repo with `Contents: Write` permission. <https://github.com/settings/personal-access-tokens>
2. **Start the local server:**

   ```bash
   npm run admin
   ```

3. **Open the admin** at <http://localhost:4321/>.
4. Paste the PAT into the **GitHub Token** field. The token is held only in this browser tab; it is never written to disk, localStorage, or sent anywhere except `api.github.com`.
5. Fill in the book fields (or click **Load Books** and **Edit** an existing entry) and submit. The form commits `files/books.json` (and optionally an `images/<cover>.jpg` upload) to `master` and the GitHub Pages build redeploys automatically.

## Notes

- The page uses Tailwind via CDN. That's fine here because it is local-only and never shipped.
- If port `4321` is in use (e.g. `astro dev` is running), stop that process first.
- First run downloads `serve` via `npx`; subsequent runs are cached and offline-friendly.
