# Local multiplayer guide

How to run Pickleball 3D on your own computer and play with friends — in the
same house or across the internet via Tailscale — without deploying anything.

Two processes run on **your** computer (the "host"):

| Process              | Port | What it is                                        |
| -------------------- | ---- | ------------------------------------------------- |
| Game client (web UI) | 4173 | `yarn host` — production build via `vite preview` |
|                      | 5173 | `yarn dev` / `yarn dev:lan` — Vite dev server     |
| Game server          | 2567 | Colyseus multiplayer server (WebSocket + HTTP)    |

Your friends only need a web browser. Their browser loads the page from port
4173 (or 5173) **and** connects to the game server on port 2567, so both ports
must be reachable from their device.

---

## 1. Install dependencies

Requirements: **Node.js 22.12+** and **Yarn 4** (this repo pins `yarn@4.18.0`).

```bash
node -v            # must print v22.12.0 or newer
corepack enable    # provides the pinned Yarn version (only needed once)
yarn -v            # should print 4.x
```

From the repository root:

```bash
yarn install
```

## 2. Start the frontend and the game server

Pick one of these (all run from the repo root):

| Command        | Who can connect                   | Use it for                      |
| -------------- | --------------------------------- | ------------------------------- |
| `yarn dev`     | Only this computer (`127.0.0.1`)  | Development, two-window testing |
| `yarn dev:lan` | Every network this computer is on | Development on a second device  |
| `yarn host`    | Every network this computer is on | **Playing with friends** ✅     |

`yarn host` builds the client and serves the static production build (no
source code, no hot-reload endpoint). It's the recommended way to share with
friends. `yarn dev:lan` exposes the Vite **development** server to your
network, so use it only on networks you trust.

To expose the game on **one network only** (for example Tailscale but not your
Wi-Fi), set `GAME_HOST` to that interface's IP:

```bash
GAME_HOST=100.101.102.103 yarn host     # your Tailscale IP (see section 6)
```

When it's running you'll see something like:

```
[@pickleball/client]:   ➜  Network: http://192.168.1.50:4173/
[@pickleball/server]: 🏓 Pickleball 3D game server listening on 0.0.0.0:2567
[@pickleball/server]:    http://192.168.1.50:2567/health
```

## 3. Test with two browsers on this computer

1. `yarn dev`
2. Open **two separate browser windows** (not two tabs in one window — browsers
   slow down background tabs) at `http://127.0.0.1:5173`.
   Tip: put them side by side, or use one normal and one private/incognito window.
3. Window 1: enter a nickname → **Create Room**. A 5-letter room code appears.
4. Window 2: enter a nickname, type the code → **Join Room**
   (or click **Play** next to the room in the list, or paste the invite link). When
   all seats are taken, the button says **Watch** and joins as a spectator (**C**
   changes camera).
5. Both click **I'm ready**. The orange player serves first.

Controls: **WASD** move (W is always toward the net) · **mouse** aim (ring on
the court) · **left click** or **Space** swing · hold **Shift** to smash,
**W + Shift** to jump smash ·
**swipe the mouse** left / right while swinging or serving to curve the ball ·
**Space** serves when it is your serve.

Returning the ball: when the **disc under your player lights up yellow**, the ball is
in reach — swing.

> If you refresh a window mid-game, it rejoins the same seat automatically
> (within 30 seconds).

## 4. Find your computer's LAN IP

- **macOS:** `ipconfig getifaddr en0` (Wi-Fi is usually `en0`; try `en1` if empty)
  or System Settings → Wi-Fi → Details → TCP/IP.
- **Windows:** `ipconfig` → "IPv4 Address" under your Wi-Fi/Ethernet adapter.
- **Linux:** `hostname -I` or `ip -4 addr`.

You're looking for an address like `192.168.x.x`, `10.x.x.x` or `172.16–31.x.x`.
`yarn host` also prints every address it is reachable on (the `Network:` lines).

## 5. Play with friends on the same Wi-Fi

1. Run `yarn host`.
2. Open `http://<your-LAN-IP>:4173` yourself (e.g. `http://192.168.1.50:4173`),
   create a room, and click **Copy invite link**.
3. Send the link to your friend. It already contains your LAN IP and the room
   code, e.g. `http://192.168.1.50:4173/?room=K7QXM`.

Important:

- Open the game via the LAN IP yourself (not `localhost`) — the invite link is
  built from the address in your address bar, and a link containing `localhost`
  won't work on your friend's device.
- The browser connects to the game server on **the same host it loaded the page
  from**, so your friend's browser talks to `192.168.1.50:2567` automatically. It
  never tries to reach your friend's own `localhost`.
- Quick reachability check from your friend's device: open
  `http://<your-LAN-IP>:2567/health` — it should show `{"ok":true,...}`.
- Guest/hotel/office Wi-Fi often blocks device-to-device traffic ("client
  isolation"). Use Tailscale (next section) in that case.

## 6. Friends on other networks: Tailscale

[Tailscale](https://tailscale.com) creates a private, encrypted network between
devices. Friends reach your computer through it — no router port forwarding,
no public hosting, nothing exposed to the open internet.

### One-time setup

1. **You (host):** install Tailscale on this computer and sign in.
2. **Your friend:** installs Tailscale on their computer and signs in with
   **their own** account.
3. Give your friend access to **only your computer** using Tailscale's
   _share a machine_ feature: in the Tailscale admin console
   (`https://login.tailscale.com/admin/machines`), open your computer's `…`
   menu → **Share…**, and send the invite link to your friend. They accept it
   in their Tailscale account.
   (Alternative: invite them as a user of your tailnet — but that gives them
   your whole tailnet subject to your access rules, so sharing a single machine
   is the more contained option.)
4. Find your Tailscale IP (starts with `100.`):
   ```bash
   tailscale ip -4
   ```
   On macOS, if `tailscale` isn't on your PATH, the CLI is at
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4`, or look in the
   Tailscale menu-bar app.

### Each game session

```bash
# Option A — reachable on Tailscale only (most contained):
GAME_HOST=$(tailscale ip -4) yarn host

# Option B — reachable on Tailscale and your LAN:
yarn host
```

Then open `http://<your-100.x-IP>:4173`, create a room, and send your friend
the invite link. With option A, open the page via the 100.x address yourself
too — `localhost` won't answer because the servers only listen on Tailscale.

**Security notes**

- Do **not** use Tailscale **Funnel** for this — Funnel publishes a service to
  the public internet, which is exactly what we're avoiding.
- Tailscale access rules (ACLs) decide what shared users may reach. If your
  tailnet uses the default allow-all policy, someone you shared the machine with
  can reach any port that's listening on it. To limit friends to the game's
  ports, add a rule in the admin console's **Access controls** page for
  `autogroup:shared` allowing only TCP `4173` and `2567` to your machine.
  (Check Tailscale's current ACL documentation for the exact syntax for your
  policy file — it has changed over time.)
- Optionally set `GAME_ALLOWED_ORIGINS` (section 7) so only the game page itself
  can open game sessions.
- Revoke a friend's access when you're done (admin console → your machine →
  sharing, or remove the share).

Multiple friends: share the machine with each of them. A room holds exactly two
players; several rooms can run at the same time on one server.

## 7. Configuring the game server URL / ports

By default the client computes the server address from the page URL:

```
page  http://192.168.1.50:4173  →  game server  http://192.168.1.50:2567
page  https://<anything>        →  game server  https://<same host>:2567
```

Settings (put them in a `.env` file at the repo root — copy `.env.example` — or
pass them on the command line; **restart** after changing them; for `yarn host`
the client is rebuilt automatically):

| Variable               | Default      | Effect                                                                                     |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `GAME_HOST`            | `127.0.0.1`* | Interface both servers listen on. `0.0.0.0` = all. *`dev:lan`/`host` default to `0.0.0.0`. |
| `GAME_SERVER_PORT`     | `2567`       | Game server port (used by the server **and** baked into the client build).                 |
| `GAME_SERVER_URL`      | (empty)      | Full server URL override for the client, e.g. `https://game.example.com` (future use).     |
| `GAME_ALLOWED_ORIGINS` | (empty)      | Comma-separated page origins allowed to join, e.g. `http://192.168.1.50:4173`.             |
| `GAME_ALLOWED_HOSTS`   | (empty)      | Extra hostnames Vite will answer to (IPs, `localhost`, `*.ts.net` already allowed).        |
| `CLIENT_DEV_PORT`      | `5173`       | Vite dev server port.                                                                      |
| `CLIENT_PREVIEW_PORT`  | `4173`       | Port used by `yarn host`.                                                                  |

Examples:

```bash
GAME_SERVER_PORT=3000 yarn host
GAME_ALLOWED_ORIGINS=http://192.168.1.50:4173 yarn host
```

The start screen shows the game-server address the page is using (bottom of the
card), which helps when troubleshooting.

## 8. Troubleshooting connections

Work through these from your **friend's** device:

1. **Can they load the page?** `http://<host-IP>:4173`
   - No → the host isn't reachable at all: wrong IP, different network, Wi-Fi
     client isolation, firewall (section 9), or the servers aren't running with
     `yarn host` / `yarn dev:lan` (plain `yarn dev` only accepts this computer).
   - "Blocked request. This host is not allowed" → you used a hostname Vite
     doesn't know; add it with `GAME_ALLOWED_HOSTS=thename yarn host`, or use the IP.
2. **Can they reach the game server?** `http://<host-IP>:2567/health`
   - Should print `{"ok":true,...}`. If the page loads but this doesn't, port 2567
     is blocked (firewall) or the server isn't running.
3. **"Cannot reach the game server at http://localhost:2567"** on a friend's
   device → they opened a link containing `localhost`. Send a link built from
   your LAN/Tailscale IP (open the game via that IP yourself first).
4. **"That room does not exist"** → wrong code, or everyone left (empty rooms
   close immediately). Create a new room.
5. **"That room is full"** → every seat is taken and 20 people are already watching. If a player just
   dropped, their seat is held for 30 s so they can rejoin.
6. **"This page is not allowed to join games"** → `GAME_ALLOWED_ORIGINS` is set
   and doesn't include the address in the browser's address bar (including port).
7. **Stuck on "Reconnecting…"** → the network dropped; it retries automatically.
   If the server was restarted, all rooms are gone — create a new one.
8. **Port already in use** (`EADDRINUSE` / "Port 4173 is already in use") →
   another copy is still running; stop it (section 10) or choose other ports.
9. **Laggy/jerky?** Same-Wi-Fi play should feel smooth. Over Tailscale, a
   relayed connection (`tailscale status` shows `relay`) adds latency; a direct
   connection is better. The in-game pill shows the round-trip ping.

### The game lags

Everyone sees their own ping and frame rate next to **Connected**, and a warning if
something is wrong on **their** side:

- **Slow computer** (low fps): close other tabs, apps and game windows, and turn on
  _hardware acceleration_ in the browser's settings, and plug a laptop in. The game
  already lowers the sharpness and switches off shadows and the crowd by itself when it
  needs to, and remembers that for a week, so the first minute on a slow computer is the
  worst. (Some stutter is normal for a second or two when the game screen first opens.)
- **Weak connection** (high or uneven ping): use a cable or 5 GHz Wi-Fi, move closer to
  the router, and stop downloads and streaming. On Tailscale, run
  `tailscale ping <host>`: `via DERP` means the traffic takes a detour through a relay
  server, which is slower than a direct connection.
- **In a tournament** the host sends every court to everyone: about 12 KB/s per person
  (16 people ≈ 1.5 Mbit/s of upload). Same Wi-Fi is no problem; over the internet the
  host's upload speed matters.
- **Dropped out of a tournament?** The game gets you back by itself: your place is kept
  for 10 minutes while you wait for a match (30 seconds during one), and the page keeps
  trying to rejoin. Keep laptops plugged in so they don't go to sleep while you watch.
- **Everyone** lags at once: it's the host's computer or connection. The host should use
  a cable and `yarn host` (not `yarn dev`), and keep the computer awake.

## 9. Firewalls and platform notes

### macOS

- System Settings → Network → **Firewall**. If it's on, macOS may ask
  _"Do you want the application node to accept incoming network connections?"_
  the first time — click **Allow**.
- If you missed the prompt: Firewall → **Options…** → find `node` and set it to
  _Allow incoming connections_, and make sure **Block all incoming connections**
  is off. From a terminal (admin password required):
  ```bash
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(which node)"
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$(which node)"
  ```
  If you use a Node version manager (nvm, fnm, volta), `which node` points to
  that version's binary — re-run after switching Node versions.
- Work/school-managed Macs may block changing firewall settings; use a personal
  machine as the host in that case.

### Windows

Run PowerShell **as Administrator** and allow the game ports, limited to your
local subnet and the Tailscale address range:

```powershell
New-NetFirewallRule -DisplayName "Pickleball 3D" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 4173,5173,2567 -RemoteAddress LocalSubnet,100.64.0.0/10
```

- Your Wi-Fi should be a **Private** network (`Get-NetConnectionProfile`); public
  networks are often locked down further.
- Remove the rule later with
  `Remove-NetFirewallRule -DisplayName "Pickleball 3D"`.
- The project runs natively on Windows (Node 22 + Yarn); that is the simplest
  setup — no WSL needed.

### WSL2 (Windows Subsystem for Linux) — needs extra configuration

**Not verified** in this project's testing (it was developed and tested on
macOS). By default WSL2 uses NAT networking: servers inside WSL are reachable
from Windows at `localhost`, but **not** from other devices on your LAN or
Tailscale. Choose one:

1. **Run natively on Windows instead** (recommended, simplest).
2. **Mirrored networking** (Windows 11 22H2+, recent WSL): create or edit
   `%UserProfile%\.wslconfig`:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
   then run `wsl --shutdown` and reopen WSL. Inbound traffic to WSL is also
   filtered by the Hyper-V firewall; allow the game ports (PowerShell as Admin):
   ```powershell
   New-NetFirewallHyperVRule -Name "Pickleball3D" -DisplayName "Pickleball 3D (WSL)" `
     -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' `
     -Protocol TCP -LocalPorts 4173,5173,2567
   ```
   and add the Windows rule from the previous section too.
3. **NAT mode with port proxying** (PowerShell as Admin, repeat after each WSL
   restart because WSL's IP changes):
   ```powershell
   $wslIp = (wsl hostname -I).Trim().Split(' ')[0]
   foreach ($p in 4173, 2567) {
     netsh interface portproxy add v4tov4 listenport=$p listenaddress=0.0.0.0 connectport=$p connectaddress=$wslIp
   }
   ```
   Remove later with `netsh interface portproxy delete v4tov4 listenport=4173 listenaddress=0.0.0.0`
   (and the same for 2567).

Install **Tailscale on Windows** (the host OS), not inside WSL. Whether
Tailscale traffic reaches servers inside WSL depends on the networking mode
above — **verify** before inviting friends: from a _different_ device on the
Tailscale network, open `http://<windows-tailscale-IP>:2567/health` and
`http://<windows-tailscale-IP>:4173`. Both must load.

## 10. Stopping the game safely

- Press **Ctrl+C** in the terminal running `yarn dev` / `yarn dev:lan` /
  `yarn host`. Both servers stop; the game server closes its rooms (players see
  "Disconnected").
- Check nothing is still listening:
  - macOS/Linux: `lsof -nP -iTCP:4173,5173,2567 -sTCP:LISTEN` (no output = stopped)
  - Windows: `netstat -ano | findstr ":4173 :5173 :2567"`
- If something is left over, find its process: macOS/Linux
  `lsof -nP -iTCP:4173,5173,2567 -sTCP:LISTEN`; Windows `netstat -ano`. Stop the
  **`yarn` command that started it** (the terminal, or `kill <pid of yarn>`),
  not just the process holding the port: under `yarn dev` the game server runs
  in watch mode and is restarted automatically if only it is killed.
  Windows: `taskkill /PID <pid> /T /F` (`/T` also stops child processes).
- When you're done sharing over Tailscale, remove the machine share (or
  disconnect Tailscale), and remove any firewall rules / port proxies you added
  if you don't want them to persist.
