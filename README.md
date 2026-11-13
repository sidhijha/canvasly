# canvasly

Canvasly is a collaborative whiteboard for sketching diagrams, adding notes, and working on a shared canvas. It runs locally in a browser and uses Supabase for accounts, cloud boards, sharing, and live collaboration.

## Features

- Infinite canvas with pan, zoom, grid controls, and fit-to-screen.
- Rectangle, ellipse, diamond, line, arrow, pencil, text, sticky-note, eraser, and image tools.
- Select, move, resize, style, group, reorder, duplicate, and delete objects.
- Undo and redo, keyboard shortcuts, autosave, and board management.
- Import and export Canvasly JSON; export PNG and SVG.
- Local guest boards stored in the current browser.
- Supabase sign-in, cloud boards, row-level security, and image storage.
- View-only share links and sign-in-required editor invitation links.
- Live collaborator presence and cursors, synchronized saved changes, member role controls, and same-object conflict notices.

## Technology

- React, TypeScript, and Vite
- SVG canvas rendering and Zustand state management
- Supabase Auth, Postgres, Storage, and Realtime
- Lucide icons

There is no separate Express server. The browser uses Supabase's public publishable key; database policies control access.

## Requirements

- Node.js 20 or later
- npm
- A Supabase project for accounts, cloud boards, and collaboration. Local guest boards work without Supabase configuration.

## Run locally

```sh
git clone https://github.com/KunalK0812/canvasly.git
cd canvasly
npm install
npm run dev
```

Without `.env.local`, Canvasly opens in guest mode. Guest boards are stored in that browser and do not sync to other devices.

## Connect Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set your project URL and public publishable key:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-key
   ```

3. Sign the Supabase CLI in, link your project, preview the migrations, then apply them:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run --remote
   npx supabase db push --remote
   ```

4. Add `http://localhost:5173` to Supabase Auth's allowed redirect URLs. Add other local or deployed URLs there if you use them.
5. Restart the Vite server, then create an account or sign in.

The migrations in `supabase/migrations` create the profile, board, membership, permission, and canvas tables; row-level security; board asset storage; board and invitation functions; and Realtime authorization. The repository's `supabase/config.toml` also supports local Supabase development.

Never put a Supabase service-role key in a `VITE_` variable or browser code. `.env.local`, build output, dependencies, and local Supabase state are excluded by `.gitignore`.

### Sharing and access

- View links are read-only and can be revoked by switching link access to Private.
- Edit links require the recipient to sign in. The owner can change member roles or remove members in the Share panel.
- When collaborators edit the same object at once, the latest saved version is kept and the other session shows a conflict notice.

**Image privacy:** the current `board-assets` bucket is public so images can load for anonymous view-link recipients. Do not upload confidential images to boards using this configuration.

## Commands

```sh
npm run dev      # Start the local development server
npm run build    # Type-check and create the production bundle in dist/
npm run preview  # Preview the production bundle locally
```

## Project structure

```text
src/
  components/       Canvas, board list, auth, and properties panel
  lib/              Supabase client
  services/         Board persistence, collaboration, and export/import
  stores/           Canvas state and undo/redo history
  types/            Canvas and tool types
  *.css             App, canvas, and panel styles
supabase/
  migrations/       Schema, access policies, and collaboration functions
```

## Verification status

The production build and TypeScript check pass with `npm run build`. Real-time collaboration was exercised during development. The newer member role/removal controls still need a two-account check after configuring your own Supabase project. Hosting is optional and is not part of this repository setup.
