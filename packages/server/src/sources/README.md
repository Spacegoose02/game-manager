# Release sources

A release source lists newly released games: a store's "new" feed, an API, or a feed you host
yourself. Admins switch sources on under **Settings, Release sources**, and give each one an
address, an optional API key and rate limits. LootDen checks the switched-on sources every half
hour, shows what they list on **Discover**, and raises an alert when a game on the wishlist shows up.

## Built in

| Source | What it reads |
| --- | --- |
| `gog-new` | GOG's public catalogue, newest releases first |
| `itch-new` | itch.io's public feed of newly published games |
| `rss` | Any RSS or Atom feed at an address you choose |
| `json-feed` | Any JSON Feed (jsonfeed.org) or simple JSON list; also the template for your own |

## Adding your own

1. Copy `adapters/json-feed.ts` to `adapters/my-source.ts` and change the `id`, `name`,
   `description`, `defaultBaseUrl` and `latest()`.
2. Add it to the list in `adapters/index.ts`.
3. Rebuild. It shows up in Settings, Release sources.

`latest()` returns `ReleaseInfo` items (see `types.ts`):

```ts
{ id: "stable id", title: "Game title", date: "2026-10-13", platform: "pc",
  url: "https://…", image: "https://…", summary: "…", details: { Store: "…" } }
```

Always fetch through `ctx.client` (never `fetch` directly). It:

- only calls the source's own host and the extra hosts set in Settings, including after redirects;
- refuses addresses on your private network unless "On my network" is switched on for the source;
- keeps to the per-minute and per-hour limits, one request at a time;
- times out after 20 seconds, and waits and retries when the server answers 429 or 503.

`paginate()` in `client.ts` collects several pages; `adapters/util.ts` has `parseFeed()` for
RSS/Atom and `isoDate()` for dates.
