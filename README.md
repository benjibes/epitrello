# EpiTrello

A web Kanban application built with SvelteKit and Bun, with an integrated API (`+server.ts`) and Redis persistence.

## Features

- Kanban board management (create, rename, delete)
- List and card management (drag-and-drop, ordering, description, tags, due dates, assignees, completed state)
- Board sharing through invite links with roles (`owner`, `editor`, `viewer`)
- Board activity history and real-time sync via SSE (`/api/board-events`)
- User notifications (added to a board, card due date)
- Authentication:
  - local login via email (`/api/login`)
  - OAuth GitHub
  - OAuth Microsoft
- Global user roles:
  - `student`
  - `ape`
  - `admin`

## Tech Stack

- Runtime: Bun
- Front/Back: SvelteKit + Svelte 5
- Build: Vite
- Styles: Tailwind CSS 4
- Validation: Zod
- Data: Redis
- Tests: `bun:test`

## Requirements

- Bun `>= 1.3.x`
- Redis `>= 7`

## Local Run (without Docker)

From this directory (`epitrello/`):

```bash
bun install
```

Create a `.env` file with the following variables:

```env
REDIS_URL=redis://localhost:6379
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:5173/auth/github/callback
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://localhost:5173/auth/microsoft/callback
```

Start Redis (example):

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

Then start the app:

```bash
bun run dev --host 0.0.0.0 --port 5173
```

App is available at `http://localhost:5173`.

## Run with Docker

Development mode:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Production mode:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

- Dev: app on `5173`
- Prod: app on `3000`

## Useful Scripts

- `bun run dev`: development server
- `bun run build`: production build
- `bun run preview`: preview build
- `bun run test`: run tests
- `bun run lint`: prettier + eslint
- `bun run check`: Svelte/TypeScript checks
- `bun run format`: code formatting

Role maintenance:

```bash
bun run migrate:user-roles
bun run migrate:user-roles -- --dry-run
bun run ensure-admin -- admin@example.com
bun run ensure-admin -- admin@example.com --create
```

## API (overview)

- `POST /api/login`
- `GET/POST/PATCH/DELETE /api/boards`
- `POST/PATCH/DELETE /api/lists`
- `POST/PATCH/DELETE /api/cards`
- `POST/DELETE /api/tags`
- `GET /api/board-full`
- `GET/POST /api/board-state`
- `GET /api/board-history`
- `GET /api/board-events` (SSE)
- `GET/POST/PATCH /api/board-sharing`
- `GET/PATCH /api/notifications`
- `GET/POST/PATCH/DELETE /api/users` (admin user management)

## Tests

API tests are in `tests/api/` (boards, lists, cards, tags, users, login, board-full, board-state, etc.).

```bash
bun run test
```

## CI

GitHub Actions pipeline: install, lint, test, build (`.github/workflows/ci.yml`).

## Additional Documentation

- `../documentation/cahier_des_charges.md`
- `../documentation/documentation_technique.md`
- `../documentation/documentation_test.md`
