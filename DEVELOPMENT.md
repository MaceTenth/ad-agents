# Development guide

How the service is built and why. [README.md](README.md) covers setup and deployment.

## 1. The flow

```
POST /api/ads {request}
  └─ createJob: save data/ads/<id>.json (status working), answer 202
       └─ in the background:
            createSession (agent + environment from claude-lock.json, budget AD_SESSION_BUDGET_CENTS)
            runTurn(kickoff = <brand_sheet> + <facts> + <request>)
              ├─ agent.custom_tool_use submit_ad_brief ──▶ validateBrief ──▶ "accepted" | "rejected" + one line per problem
              │     (after MAX_REJECTIONS rejections the tool result tells the agent to stop and explain)
              └─ session.status_idle (end_turn) ──▶ return { brief | null, text }
            brief?  composePrompt(brand layer + scene + format layer) ──▶ draw() ──▶ data/ads/<id>_1.jpg
            status: draft | needs_input (the agent asked something) | failed
GET  /api/ads/<id>                      the page polls this every 3 s while status is working
POST /api/ads/<id>/reply {text, redraw} the same session, a <reply> message; a picture is drawn only when needed
```

## 2. Decisions and why

### 2.1 The agent lives on the platform, the checks live in your code
The agent (`agents/ad-researcher.md`) is created once with `ant apply` and reused for every ad. Never create an agent
inside request-handling code. The agent's configuration is a file in git. Its IDs sit in `claude-lock.json`, which
is committed so every deploy finds them. `AD_AGENT_ID` / `AD_ENVIRONMENT_ID` override the lock file.

The agent cannot hand back free text that the service then trusts. It must call the custom tool `submit_ad_brief`,
and the service answers it. `src/brief.mjs` is code, not a model, so its verdict is the same every time:
- field lengths;
- 3 to 6 hashtags, including the brand sheet's "Always" hashtag;
- an English scene of 40 to 120 words;
- every `facts_used` entry found word for word in the facts or the request;
- every price in the copy listed in `facts_used`.

Each rejection line names the field and the fix, because the agent reads it as its next prompt.

### 2.2 Facts are a file, and replies can add facts
`prompts/facts.md` is the only source of business facts. Today's date and the time zone are prepended on every run.
The brand sheet is pasted in unchanged. Facts the owner states in a reply ("make it 2 for ₪25") count for the
validator, just like the original request.

### 2.3 Revisions stay in one session
A reply goes into the same session as a `<reply>` block. The agent still has the brand sheet, the facts and its last
brief, so a copy change takes seconds and costs cents. A picture is drawn again only on the first brief, when the
agent sets `redraw_image: true`, or when the "New picture" box is ticked. The box also tells the agent, so it can
adjust the scene.

### 2.4 The image prompt has three layers
`src/image.mjs` joins three layers:
- the brand layer (`prompts/image-brand-layer.txt`, the house photo style);
- the agent's scene;
- a format layer (aspect, no text unless asked, the avoid list).

The agent writes only the scene, so the style cannot drift from ad to ad. `prompts/image-prompt.md` explains the
layers. OpenAI is the tested adapter, and the Gemini one is a port. `IMAGE_PROVIDER=mock` returns a 1×1 JPEG for
tests.

### 2.5 Background jobs, polling, files
An agent turn takes about a minute, longer than some proxies keep a request open. So `POST` answers 202 at once, the
work runs in the background, and the page polls. Jobs are JSON files with the pictures next to them. That means no
database to set up, and easy inspection. A job left "working" by a restart is marked failed on the next start.

Run exactly **one** instance. Running jobs and the daily counter live in the process. A second instance would have
its own counters and, without a shared volume, its own files.

### 2.6 One password, and cost limits in code
Every `/api` call must carry `APP_PASSWORD`, in an HTTP Basic `Authorization` header with any user name. The
comparison is constant-time, and the server refuses to start without a password. The page and its script are public
because they hold nothing secret. The page asks for the password, keeps it in `sessionStorage` for that tab, and sends
the header itself. It fetches the pictures the same way and shows them from blob URLs.

The server sends no `WWW-Authenticate` header, so browsers never open their own login box. The browser's cached
credentials are unreliable across reloads and POSTs, which is why the page does not depend on them. A leaked URL
alone is not enough to spend money. Inside, these limit
the damage of a leaked password or a runaway loop:
- `MAX_PARALLEL_RUNS`;
- `MAX_RUNS_PER_DAY` (a rolling 24 hours, which resets on restart);
- the per-session `budget` in `createSession`;
- `AD_TURN_TIMEOUT_SECONDS`, which sends `user.interrupt`.

### 2.7 Untrusted text never becomes HTML
The copy, the agent's notes and the source titles come from a model that read the open web. The page sets all of it
with `textContent`. Source links are shown only for `http(s)` URLs, with `rel="noopener noreferrer"`. The page is
served with a Content Security Policy that allows only its own script.

### 2.8 Plain Node, one dependency
One HTTP server, a few small modules, and `@anthropic-ai/sdk`. `process.loadEnvFile` reads `.env`, which needs
Node 20.12 or newer. That means less to update and less to audit.

## 3. Tests

```bash
npm test                # test/brief.mjs (the validator, caption and prompt) + test/server.mjs (the whole service)
npm run test:ad-live    # one REAL ad without the web server (~$0.30); pass a request and an optional reply as arguments
```

`test/server.mjs` starts the real server with `AD_AGENT_DRIVER=fake` and `IMAGE_PROVIDER=mock`. It checks:
- the password, `/health`, input validation and path traversal;
- the 202-then-poll flow, the kickoff blocks and picture serving;
- copy-only versus redraw revisions;
- a question from the agent, and a rejected brief that gets fixed;
- the parallel and daily limits;
- restart persistence.

The fake driver (`src/agent-fake.mjs`) follows markers in the request: `[NOBRIEF]` makes it ask a question,
`[BADPRICE]` makes its first brief carry an unlisted price, and `[REDRAW]` asks for a new picture.

Run `npm test` before every push. Run `test:ad-live` after changing the agent file or anything in `prompts/`.

## 4. Where to look when something breaks

| What | Where |
|---|---|
| Each step of each job, errors | stdout: the platform's log view; on a droplet `logs/server.log` |
| The agent's searches, reasoning and tool calls | Claude Console → Sessions (the log prints the link for every job) |
| A job's brief history, rejections, image prompt, usage | `data/ads/<id>.json` |
| Pictures | `data/ads/<id>_<n>.jpg` |

## 5. Ideas for exercises

- **Wire in the reviewer.** `agents/ad-reviewer.md` exists. Apply it, and before drawing, open a second session that
  reviews the accepted brief. Send its fixes back to the researcher as a `<reply>`.
- **Several brands.** Add a `/brand` choice and one prompt folder per brand.
- **A real database** (SQLite on a volume, or a managed database) and history per user.
- **Deliver it somewhere.** Send the finished draft to WhatsApp, Telegram or email instead of only showing it on the
  page.
