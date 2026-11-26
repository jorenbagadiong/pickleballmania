# The secret developer athlete

A hidden character for the developer's own casual games and training. It is
deliberately overpowered and never available in tournaments.

## What it gets

| Status  | What                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| Done    | The secret look `x1` (`SECRET_LOOK`), given by the server and chosen by nobody     |
| Done    | Held curves (Q, E, right mouse button), exactly as the `cheater` name gets them    |
| Not yet | The TEZUKA ZONE passive: incoming opponent shots bend toward this player (Phase B) |
| Not yet | A model of its own, left-handed animation and zone effects (Phases C and D)        |

**Model fallback:** `x1` has no model yet, so it is drawn with the public athlete `m1`
(`SECRET_LOOK_FALLBACK` in `apps/client/src/players/athlete/assets.ts`). While it is on
court, nobody else is cast as `m1` if there is another athlete to go round.

## Who gets it

All four, checked on the server (`apps/server/src/rooms/devAuth.ts`):

1. The nickname is `Tezuka`, trimmed and in any capitals (`isTezukaName`).
2. The player is on the computer running the server (`isHostMachine`, the same check
   the `cheater` name uses).
3. The player sent the developer key, and it matches `PICKLEBALL_DEV_KEY`. The two are
   compared as SHA-256 digests with `timingSafeEqual`. If the variable is missing or
   shorter than 12 characters, nobody gets the athlete.
4. The room allows it:
   - training rooms always do;
   - a casual room does only if it was created with `devPerks: true`. On the start
     screen that is the **Allow developer abilities in the room I create** box: unticked
     each time, and asked for each room. Typing a key alone never enables it, and **New
     room** from the lobby never carries it over;
   - a tournament never does, whatever it was created with.

If any one is missing, the player is an ordinary player under that name. There is no
error message, so a wrong key reveals nothing.

The grant belongs to the session:

- It survives a reconnect, because Colyseus keeps the session ID.
- It ends when the player leaves for good.
- Someone else who joins later as `Tezuka` gets nothing without the key.

The original `cheater` name works exactly as before.

## Running it

Set the key where the server runs. Never commit it (`.env` and `.env.local` are
gitignored):

```bash
PICKLEBALL_DEV_KEY='a-long-random-secret' yarn dev
```

On the start screen, enter `Tezuka` as the nickname. A **Developer key** field appears
(a password field); type the key there. Then either tick **Allow developer abilities in
the room I create** and create a room, or start training.

## Where the key goes

- **Browser:** it stays in memory only, in a module variable in
  `apps/client/src/net/session.ts`. It is not in the Zustand store, storage, the URL or
  the bundle. A page refresh forgets it. Reconnecting after a refresh doesn't need it,
  because the server remembers the session.
- **Network:** it is sent in the join options of `create` / `joinById`, which travel in
  the matchmaking request body.
- **Server:** `onAuth` turns it into a yes/no and removes it from the options. It is
  never logged, put in synchronized state, or included in an error message.

## Picker protection

- `ATHLETES` and `parseLook` (used by the picker, `ClientMsg.look` and the join option
  `look`) do not include `x1`.
- The client accepts `x1` only from server state (`resolveLook`, `castFor`).
- The server ignores `ClientMsg.look` from the secret athlete, so they can't change the
  look either.

## Checked so far

- **Server logs:** a server run with a key, joined as Tezuka with the right key and
  with a wrong one. Its output had no trace of the key, even with `DEBUG=colyseus:*`.
- **Browser (`e2e/tezuka.spec.ts`):**
  - the console, every request and WebSocket URL, `localStorage`, `sessionStorage`,
    cookies, the page HTML, the `?e2e` debug hook (store and state) and `GET /rooms`
    contain no key;
  - the key field is `type="password"`.
- **e2e key:** the test server uses a throwaway key (`E2E_DEV_KEY` in
  `playwright.config.ts`, overridable with `PW_DEV_KEY`). Traces and screenshots are
  off in the config.
- **Bundle:** the client bundle has no mention of `PICKLEBALL_DEV_KEY`.
