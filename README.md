# Ask the Panel

Live panel Q&A for WSTI Festi 2026. The audience sends questions from their phones, the host picks one, and the big screen shows it. Nothing on paper.

## The three links

| Who | Link | What it does |
|---|---|---|
| Audience | `/` | Question box plus an optional first name. Shows the question that is on screen now. |
| Host (Asha) | `/?host`, then log in | Every question, oldest first. **Ask this** puts it on the big screen, **Skip** hides it. Works on a phone (as cue cards) or a laptop. |
| Projector | `/?screen` | The chosen question in large type, with a small QR code. When nothing is chosen it shows a big QR code and "Ask the panel". Double-click or press F for full screen. |

The host and the projector can be on different devices. The screen picks up a change within about 2 seconds.

## Admin login

The host view asks for a username and password, set on Railway as `ADMIN_USER` and `ADMIN_PASSWORD`. The link carries nothing secret, so it is safe to show on a shared screen. The login lasts 12 hours on that browser; **Log out** ends it sooner. Changing `ADMIN_PASSWORD` logs everyone out. After 20 wrong tries from one address, logins from it wait 10 minutes. `admin.js` is the same file as in the lucky draw repo.

## Host controls

- **Ask this**: puts the question on screen and moves it to Asked. Picking another question replaces it.
- **Skip**: moves it to Skipped. **Back to waiting** brings it back.
- **Take off screen**: the screen goes back to the QR code.
- **Taking questions / Questions paused**: closes or reopens the question box on every phone.
- **Download all (CSV)**: every question with its time, name and status.
- **Delete all questions**: needs two clicks. Use it between events, not between the two panels.

## Where the data goes

The questions stay on the server, in `QUESTIONS_FILE`, and nowhere else. They are not in a Google Sheet or on a public page. Anyone can see the question that is on screen. The full list needs the admin login. Phones send only the question, an optional first name and a random device id, which is used to stop double taps and flooding and is never shown.

Limits: 280 characters for a question, 30 for a name, five questions a minute from one phone, and 120 a minute from one Wi-Fi address (a whole venue often shares one address).

## Running it

Node 20 or later, no dependencies.

```
ADMIN_USER=asha ADMIN_PASSWORD=choose-a-password node server.js
```

On Railway:

- Start command: `npm start`
- Variables: `ADMIN_USER`, `ADMIN_PASSWORD`, and `QUESTIONS_FILE` set to `/data/questions.json`
- A volume mounted at `/data`, so questions survive a redeploy

Never commit the username or password. Without them set, nobody can open the host view.
