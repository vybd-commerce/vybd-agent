# Vybd private beta: tester guide

Vybd keeps your brand's brief, team and tasks in one place. You work on it from the AI assistant you already use: Claude, ChatGPT or Claude Code. Your teammates can use a different assistant and still see the same brand.

Server: `https://web-production-c9577.up.railway.app` (called `<APP_URL>` below)

## 1. Connect your assistant

**Claude (claude.ai or desktop).** Go to Settings → Connectors → Add custom connector. Paste `<APP_URL>/api/mcp` and sign in when asked.

**ChatGPT.** Go to Settings → Apps & Connectors → Advanced, turn on developer mode, then add a connector with `<APP_URL>/api/mcp`.

**Claude Code.**
```sh
claude mcp add --transport http vybd <APP_URL>/api/mcp
# then run /mcp in Claude Code, choose vybd, and sign in
```

**Terminal (CLI).** Works once `@vybd/cli` is published to npm (issue A6).
```sh
npx @vybd/cli login
npx @vybd/cli help
```

## 2. Join a team

If someone sent you an invite link, open it in your browser first and sign in. The link is what gets you past the beta gate. After that, connect your assistant (step 1). You're already on the brand.

If you're already signed in, you can join without the browser. Tell your assistant "join this brand: `<link>`", or run `vybd join <link>`.

## 3. Things to try

Each brand is split into lanes: Positioning, Research, Product and Sourcing. Each person on the team claims a lane and works through its checklist.

- "Start a new brand for a scalp oil for curly hair."
- "Invite my cofounder." This gives you a link to send them.
- "Show me the lanes. Who owns what?"
- "I'll take sourcing." This claims the lane for you.
- "Add 'Get 3 quotes for 50ml amber bottles' to sourcing."
- "What's on my plate?"
- "Tick off the bottle quotes task."

The CLI has the same features:
```sh
vybd invite
vybd lanes
vybd claim sourcing
vybd task add sourcing "Get 3 quotes for 50ml amber bottles"
vybd tasks                 # your lanes and open tasks across all brands
vybd task done 1a2b3c4d
vybd release sourcing
```

## Who can do what

- Anyone on the team can see every lane and add tasks to any lane.
- A lane has one owner. Anyone can claim a lane nobody owns.
- Only the lane's owner can tick its tasks.
- The lane owner or the brand owner can release a lane.
- Only the brand owner can approve and pay for jobs.

## Feedback

Tell us what broke or felt wrong in the tester chat.
