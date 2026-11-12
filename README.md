# Ad agents: research, copy and a picture, deployed to the cloud

A course project. You write one line, like "an ad for Friday: challah, 2 for ₪30, Florentin". You get back a
finished ad draft:
- **one timely angle**, found by a research agent on the web;
- **the copy**: headline, post text, call to action and hashtags, in the brand's voice;
- **a picture**, drawn by an image model.

Ask for changes in plain words. The agent keeps the conversation, so "shorter" or "make it about the babka" takes
seconds. Tick "New picture" and it draws again.

```
your browser ──▶ this web service (Railway / DigitalOcean)
                   │  kickoff: brand sheet + facts + your request
                   ▼
                 Ad Researcher agent (Claude Opus, Managed Agents, web search)
                   │  submit_ad_brief ──▶ the service checks it: lengths, facts, prices ──▶ "accepted" or a list of fixes
                   ▼
                 image model (OpenAI or Gemini) draws the scene inside the brand's photo style
                   ▼
your browser ◀── picture + copy + the agent's notes and sources
```

The agent runs on Anthropic's platform. Your server holds the keys, checks every brief, draws the picture, and keeps
the drafts. The sample business is **Dana's Bakery** ("המאפייה של דנה"), which is made up.

## What's inside

| Folder | What it is |
|---|---|
| `agents/ad-researcher.md` | The research agent: its configuration (frontmatter) and its instructions (body) |
| `agents/ad-reviewer.md` | An optional second agent that reviews a brief. Not wired in; an exercise. |
| `environments/ad-research.yaml` | The environment the agent runs in, on Anthropic's side |
| `prompts/` | The brand sheet, the facts, the picture style, and how the prompts are put together |
| `src/` | The web service: API, the agent driver, the brief checks, the image providers |
| `public/` | The web page |
| `Dockerfile`, `railway.json`, `deploy/`, `scripts/` | Deployment: Railway, DigitalOcean App Platform, a DigitalOcean droplet |
| `test/` | Offline tests (free) and one live run |

## What you need

| | Where |
|---|---|
| Node.js 20.12 or newer (22 recommended) | https://nodejs.org |
| An Anthropic API key with credit, for the agent | [Get your API keys](#get-your-api-keys) below |
| An OpenAI API key or a Google Gemini key, with credit, for the pictures | [Get your API keys](#get-your-api-keys) below |
| The `ant` CLI, to create the agent from its file | macOS: `brew install anthropics/tap/ant` |
| GitHub, and a Railway or DigitalOcean account | https://railway.com · https://cloud.digitalocean.com |

## Get your API keys

You need two keys: **Anthropic** for the research agent, and **OpenAI _or_ Google** for the pictures. All three
providers bill separately from their chat subscriptions (ChatGPT, Claude, Gemini), so each needs its own credit.

Anthropic and OpenAI show a key **only once**, when you create it. Paste each key straight into your `.env` file
(`cp .env.example .env` first). Never paste it into a chat, a commit or a screenshot.

### Anthropic: the research agent (required) → `ANTHROPIC_API_KEY`

1. Sign in or create an account at the **Claude Console**: https://platform.claude.com
2. Add credit on the **Billing** page: https://platform.claude.com/settings/billing. Some Claude Max, Ultra and Team
   plans include monthly API credits that you can claim for a Console organization.
3. Open the **API keys** page, https://platform.claude.com/settings/keys, and click **Create key**:
   - Name it, for example `ad-agents`, and choose an expiration.
   - Set **Linked account** to yourself.
   - **Select a workspace**, for example the Default Workspace. Don't skip this. A key without a workspace is
     refused unless every request names one, and this project doesn't send that header. The agent that
     `npm run agents:apply` creates also lives in this workspace.
4. Copy the key. It starts with `sk-ant-`. Put it in `.env` as `ANTHROPIC_API_KEY=sk-ant-...`.

Optional: on the **Workspaces** page, https://platform.claude.com/settings/workspaces, create a workspace just for
this project and give it a spend limit. Then create the key in that workspace.

### OpenAI: the pictures (`IMAGE_PROVIDER=openai`, the default) → `OPENAI_API_KEY`

1. Sign in or create an account at https://platform.openai.com
2. Add a payment method and credit on the **Billing** page: https://platform.openai.com/account/billing/overview
3. **Verify your organization**: https://platform.openai.com/settings/organization/general → **Verify
   Organization**. OpenAI may require this before its image models work. It asks for an ID, and sometimes business
   details. Do it early, because it can take a while.
4. Open https://platform.openai.com/api-keys, create a new secret key, and copy it. It starts with `sk-`. Put it in
   `.env` as `OPENAI_API_KEY=sk-...`.

Optional: set a monthly usage limit in the organization's limits settings.

### Google Gemini: the pictures, instead of OpenAI (`IMAGE_PROVIDER=gemini`) → `GEMINI_API_KEY`

1. Open **Google AI Studio** at https://aistudio.google.com/api-keys and sign in with a Google account. New
   accounts already have a project and a key. Otherwise click **Create API key**.
2. **Turn on billing.** The image models are not on the free tier. On the API keys page or the Projects page, click
   **Set up billing** next to your project, link or create a billing account, and prepay at least $5 (some accounts
   are offered pay-afterwards instead). Top up later
   with **Buy credits** on https://aistudio.google.com/billing. A Google AI Pro or Ultra subscription does not cover
   API use.
3. Copy the key. It starts with `AIza`. Put it in `.env` as `GEMINI_API_KEY=AIza...`, and set
   `IMAGE_PROVIDER=gemini`.

The Gemini picture adapter has been tested less than the OpenAI one. If a picture fails, the server log shows
Google's error.

### In the cloud

Railway and DigitalOcean get the same keys as service variables (section 4). If a key ever leaks, delete it on the
provider's keys page and create a new one (section 6).

## 1. Create the agent

The agent is created once, in your Anthropic workspace. Every ad is a new session on the same agent.

```bash
git clone <your copy of this repo> ad-agents && cd ad-agents
npm install
npm test                  # offline tests: no keys, no cost, a few seconds
cp .env.example .env      # then fill in APP_PASSWORD and your keys (see "Get your API keys")
npm run agents:plan       # shows what would be created: one agent, one environment. Changes nothing.
npm run agents:apply      # creates them (ant shows the plan again and asks first)
```

`agents:apply` writes `claude-lock.json` with the IDs of your agent and environment. **Commit that file.** The IDs
are not secrets, and the server reads them from it, locally and in the cloud.

No `ant` CLI? Create the agent in the Claude Console instead: Managed Agents → new agent. Paste the body of
`agents/ad-researcher.md` as the system prompt, copy the frontmatter values into the form, and create an
environment like `environments/ad-research.yaml`. Then put the two IDs in `AD_AGENT_ID` and `AD_ENVIRONMENT_ID`.

## 2. Run it on your computer

```bash
npm start
```

Open http://localhost:3000 and log in with your `APP_PASSWORD`. Write `מודעה ליום שישי: חלות, 2 ב-30, פלורנטין` and press **Create ad**. In about a minute you get the picture and
the copy. Then try a change: "קצר יותר" (shorter), "make it about the babka", or tick **New picture**.

Watch the terminal. It shows each step and a link to the agent's session in the Claude Console, where you can read
its searches and reasoning.

No browser? `npm run test:ad-live` runs one real ad from the terminal and saves it under `test-output/`
(about $0.30).

## 3. Before you push to GitHub

Create your own repository (private is a good default) and push. Before the first push:

```bash
git status --ignored    # .env and data/ must be listed as ignored; claude-lock.json should be committed
```

Never commit a key. If one lands in a commit, rotate it right away (section 6). Deleting the file is not enough: it
stays in the git history.

## 4. Put it in the cloud

The cloud needs the same settings as your `.env`: at least `APP_PASSWORD`, `ANTHROPIC_API_KEY`, `IMAGE_PROVIDER` and
`OPENAI_API_KEY`. Leave out `PORT`: the platform sets it. If you did not commit `claude-lock.json`, also add
`AD_AGENT_ID` and `AD_ENVIRONMENT_ID` (`npm run agents:ids` prints them).

### 4.1 Railway (easiest)

1. https://railway.com → **New Project** → **Deploy from GitHub repo** → pick your repo. Railway builds the
   `Dockerfile`. The settings in `railway.json` include the health check on `/health`.
2. Open the service → **Variables** → **Raw Editor** → paste your variables → **Update variables**.
3. **Settings** → **Networking** → **Generate Domain**. Open `https://<your-app>.up.railway.app` and log in with your
   `APP_PASSWORD`.
4. Recommended: keep the drafts across deploys with a volume mounted at `/app/data`. Right-click the service →
   **Attach volume**, or run `railway volume add --mount-path /app/data`.

Every `git push` redeploys. Logs: the service → **Deployments** → **View logs**.

### 4.2 DigitalOcean App Platform

From the dashboard: **Create** → **App Platform** → **GitHub** → pick the repo and branch. App Platform finds the
`Dockerfile`. Edit the service:
- **Network**: HTTP port `3000`.
- **Health check**: path `/health`.
- **Environment variables**: open the bulk editor and paste your variables. Tick **Encrypt** for the password and the
  keys.
- **Size**: the smallest is enough. Keep **1** container.

Your address is `https://<your-app>.ondigitalocean.app`. Logs: the app → **Runtime Logs**.

Or with `doctl`, after `doctl auth init` and after giving App Platform access to your GitHub. This builds the spec
from your `.env` and pipes it in, without writing it to disk:

```bash
npm run --silent do:spec -- <github-user>/<repo> | doctl apps create --spec -
```

App Platform has no persistent disk: past drafts disappear on each deploy. Download the pictures you want to keep.

### 4.3 DigitalOcean Droplet (a server of your own)

A plain Ubuntu VM, with Caddy for HTTPS and systemd to keep the service running. This is the most work and the most
control, and the drafts stay on its disk. Create a droplet (Ubuntu 24.04, the $6 size, your SSH key), then from this
folder:

```bash
IP=203.0.113.10                      # your droplet's IP address
rsync -az --exclude node_modules --exclude data --exclude '.env*' --exclude .git ./ root@$IP:/opt/ad-agents/
ssh root@$IP "bash /opt/ad-agents/deploy/setup-droplet.sh $IP.sslip.io"   # Node, Caddy, firewall, service
npm run deploy:droplet -- $IP        # copies .env (mode 600), installs, starts
```

`sslip.io` turns the IP into a hostname, so Caddy can get a free certificate. Open `https://<IP>.sslip.io`. Redeploy
after changes with `npm run deploy:droplet -- $IP`. Logs: `ssh root@$IP tail -f /opt/ad-agents/logs/server.log`.

## 5. Make it your business

| File | What it controls | After editing |
|---|---|---|
| `prompts/brand-sheet.md` | Who the business is, its voice, colours, hashtags, and what it never says | nothing; read on every ad |
| `prompts/facts.md` | The only products, prices, branches and hours an ad may state | nothing |
| `prompts/image-brand-layer.txt` | The photo style around every picture | nothing |
| `agents/ad-researcher.md` | The agent: model, tools, instructions, the brief's fields | `npm run agents:apply`, commit `claude-lock.json`, push |
| `src/brief.mjs` | The checks every brief must pass: lengths, hashtags, facts, prices | `npm test` |

`prompts/kickoff-message.md` shows exactly what the agent receives, and `prompts/image-prompt.md` explains how the
picture prompt is built from three layers. In the cloud, a prompt change goes live after a push (Railway, App
Platform) or `deploy:droplet`.

## 6. Safety: keep these habits

- **Keys and the password live only in `.env` and in the cloud's variables.** Git ignores `.env`, and
  `.dockerignore` keeps it out of images. Never paste keys into a chat, an issue or a screenshot.
- **The password guards your money.** Anyone who has the URL and the password can make ads on your account. Use a
  long random password (the server refuses to start without one) and share it only with whoever needs it. The page
  keeps it only for the open browser tab. Scripts can call the API with `curl -u any:$APP_PASSWORD`.
- **A leaked key gets rotated.** Create a new key in the Anthropic or OpenAI console, update the variables, then
  delete the old key.
- **Spending is capped in four places:**
  - `AD_SESSION_BUDGET_CENTS` per agent session (default $3);
  - `MAX_RUNS_PER_DAY` (default 30);
  - `MAX_PARALLEL_RUNS` (default 2);
  - a monthly limit you set yourself in the Anthropic and OpenAI consoles.
- **The agent only reads.** It has web search and web fetch, nothing else: no code, no files, no posting. It never sees
  a key. Web pages are treated as information, not instructions. The brief's prices and facts are checked by code
  against `prompts/facts.md` before anything is drawn.

## Tests

```bash
npm test               # the brief checks + the whole web service with a fake agent and a mock image model (free)
npm run test:ad-live   # one real ad: an agent session with web research, plus a real picture (about $0.30)
```

## Costs, roughly

| Item | Cost |
|---|---|
| One new ad: an agent session (Opus, a few web searches) plus one picture | about $0.30 |
| A text-only change | a few cents |
| A new picture | about $0.10 with OpenAI at medium quality |
| Railway or App Platform | about $5 a month for a small service (see their pricing pages) |
| Droplet | $6 a month |

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| The server exits with `APP_PASSWORD is not set` | No password configured | Set `APP_PASSWORD` in `.env` or in the cloud variables |
| "the agent is not created yet" | No `claude-lock.json` and no IDs | `npm run agents:apply` and commit the lock file, or set `AD_AGENT_ID` / `AD_ENVIRONMENT_ID` |
| `401` or `authentication_error` from Anthropic | Wrong, expired or missing `ANTHROPIC_API_KEY` | Check the key and the account's credit |
| `This API key is not scoped to a workspace` | The Anthropic key was created without a workspace | Create a new key and select a workspace (see "Get your API keys") |
| `openai images 401` / `429` | Wrong OpenAI key, or no credit or quota left | Check the key, billing and limits in the OpenAI dashboard |
| `openai images …` mentioning organization verification | The OpenAI organization is not verified | https://platform.openai.com/settings/organization/general → Verify Organization |
| `gemini images …` about the key, quota or billing | Wrong Gemini key, or billing not set up | Check the key, and **Set up billing** in AI Studio |
| `spend cap reached` | The session hit `AD_SESSION_BUDGET_CENTS` | Raise it, or ask for something narrower |
| `no result within 420s` | The agent ran too long | Open the session link from the log in the Claude Console |
| `daily limit … reached` | `MAX_RUNS_PER_DAY` | Wait, or raise it |
| "Wrong password" on the page | It differs from `APP_PASSWORD` on the server | Check the variable; after changing it, log in again |

How it's built and why: [DEVELOPMENT.md](DEVELOPMENT.md).
