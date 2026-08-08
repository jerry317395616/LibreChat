# I-ONE Agent deployment

This fork is the interactive frontend for `ione_agent`. It uses LibreChat for authentication,
conversation history and responsive chat UI, while business execution remains in Frappe and the
I-ONE LangGraph orchestrator.

## Runtime boundary

- Frappe owns user authentication; LibreChat owns the resulting browser session and conversation
  presentation.
- Frappe issues a 60-second, single-use SSO token when an authorized user opens `/agent`.
- LibreChat exchanges that token server-to-server, maps the Frappe user by stable subject and email,
  and creates its normal session cookies. Direct visits to `/login` return to the Manager login
  flow; independent email/password login is disabled in production.
- The custom endpoint calls `http://10.144.133.1:8100/v1` with a dedicated bearer token.
- The bridge calls the existing Frappe `ione_agent.api` methods, so task audits, lead candidates and
  CRM writes continue to use Frappe permissions and persistence.
- DeepSeek remains the initial planner and final reviewer. Qwen remains the execution controller.
- RAG, vector storage and the LibreChat admin panel are intentionally excluded from this deployment.

## Deploy

1. Copy `.env.ione.example` to `.env.ione` and generate every secret independently.
2. Keep `.env.ione` outside Git and back up the entire `runtime` directory before an update.
   Configure the same independent `IONE_SSO_SHARED_SECRET` in the Frappe site config and
   LibreChat `.env.ione`; never place it in a browser URL or commit it. Set
   `IONE_SSO_FRAPPE_URL` to the internal Frappe address and `IONE_SSO_FRAPPE_HOST` to the site
   hostname so the token exchange does not depend on the public tunnel. Set
   `IONE_SSO_PUBLIC_URL=https://manager.myyr.top/agent` for the browser-facing login entry and keep
   `ALLOW_EMAIL_LOGIN=false` so Agent accounts cannot diverge from Manager accounts.
3. Build and start with
   `docker compose --env-file .env.ione -f docker-compose.ione.yml up -d --build`.
4. Verify `http://10.144.133.1:3080/health` before switching the public route.
5. Create the initial user with
   `docker compose --env-file .env.ione -f docker-compose.ione.yml exec api npm run create-user`.

Updates are performed by pulling `jerry317395616/LibreChat`, building a new tagged image, checking
health, and only then replacing the running API container. MongoDB and Meilisearch data live under
`runtime` and are never removed during an application update.
