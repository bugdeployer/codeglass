# Codeglass

I got tired of staring at a terminal while a coding agent worked, waiting for it to finish so I could see what it actually did. So I made this: a little local web page that draws a map of a project and updates as the agent edits it.

It's a personal tool and a bit of a toy. It works for me on my projects. It might work for yours.

[npm](https://www.npmjs.com/package/codeglass) · [GitHub](https://github.com/bugdeployer/codeglass) · [Issues](https://github.com/bugdeployer/codeglass/issues)

## What it shows

- **System map**: the project's features (Auth, Notes, Billing…) as cards, with lines for how they depend on each other. Open a card to see its flows step by step, including the branches, and which tables each step reads or writes.
- **Schema**: database tables wired together by their joins.
- **Topography**: the folder as a bubble map or treemap, by size, language or recent edits.
- **Stats**: languages, biggest files, most-imported modules.

With **LIVE** on, new files, routes and tables show up as the agent writes them. With **hooks** on, cards light up with *Building* or *Editing* while Claude Code or Codex is touching them.

## Running it

```bash
npx codeglass
```

That opens http://localhost:4777. Click **Open project folder** and pick a project. You can also pass a folder: `npx codeglass path/to/project`.

If you'll use it often, install it once and run `codeglass` from anywhere:

```bash
npm install -g codeglass
```

Or run it from source:

```bash
git clone https://github.com/bugdeployer/codeglass.git
cd codeglass
npm install
npm run build
npm start
```

You need Node 20.11+. The file scan, schema, topography and stats work on their own. The nicer map (feature names, descriptions, flows) comes from running the [Claude Code](https://code.claude.com) or Codex CLI, so you need one of them installed and signed in. Pick which in **Settings**.

Options: `--port <n>`, `--no-open`, `--host <address>`, `--help`.

## Good to know

- Everything runs on your machine. The server only listens on `127.0.0.1`.
- Mapping uses your Claude or Codex account, so it costs tokens. A first map of a small project is a few cents on Sonnet; LIVE updates are smaller. The running total is shown in the toolbar. There's a budget cap in Settings for Claude; Codex doesn't report dollar cost.
- The map is saved in `<project>/.codeglass/`, which git-ignores itself.
- Hooks are written to `.claude/settings.local.json` or `.codex/hooks.json` in the project. They only report which files the agent touches, never block anything, and leave your other hooks alone. Codex wants you to trust them with `/hooks` first.
- The scanner understands JS/TS and Python best: Express, Hono, Fastify, Next.js, FastAPI, Flask and Django routes, plus Prisma, SQL, Drizzle, Django and SQLAlchemy schemas. Other stacks get a rougher map.
- Settings live in `~/.codeglass/`.

## Hacking on it

```bash
npm install
npm run dev     # server on :4777, UI with hot reload on :5173
npm test
```

React, Vite, Tailwind, React Flow, anime.js and Hono. The server is in `server/`, the UI in `src/`, shared types in `shared/`.

## Licence

MIT
