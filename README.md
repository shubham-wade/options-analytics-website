# NIFTY Risk Lab

Read-only NIFTY options analytics for your own Zerodha account. The app logs in with Kite Connect, loads net positions and quotes on the server, and prices scenario P&L with a Black–Scholes–Merton engine. It does not place, modify or cancel orders, and it does not use a database.

## 1. Create a Kite Connect app

1. Open [developers.kite.trade](https://developers.kite.trade/) and create an app.
2. Note the API key and API secret. The secret stays on the server.
3. The app needs access to positions, instruments and market quotes. This project never calls the order APIs.

## 2. Register the callback URL

Set the Kite app redirect URL to:

```text
http://localhost:3000/api/kite/callback
```

The value must match `KITE_REDIRECT_URL` exactly, including the path. Zerodha sends `request_token` to that URL. The server exchanges it and immediately redirects to `/`, so the token does not stay in the address bar.

## 3. Configure environment variables

```bash
copy .env.example .env.local
```

Fill in:

| Variable | Role |
| --- | --- |
| `KITE_API_KEY` | Public app key for the first Zerodha account |
| `KITE_API_SECRET` | Server-only secret used for the checksum |
| `KITE_API_KEY_2` | Public app key for the second Zerodha account |
| `KITE_API_SECRET_2` | Server-only secret for that second app |
| `KITE_REDIRECT_URL` | Registered callback on both apps, normally `http://localhost:3000/api/kite/callback` |
| `SESSION_SECRET` | Signs the HTTP-only session id cookie |

`.env.local` is listed in `.gitignore`. Do not prefix these names with `NEXT_PUBLIC_`.

## 4. Start the application

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 5. Connect and refresh

1. Click **Connect Zerodha** and sign in on Zerodha’s site.
2. After the redirect, the dashboard loads NIFTY CE and PE contracts from the **net** positions array.
3. Click **Refresh** to pull positions and quotes again. Optional auto-refresh waits 20 seconds between pulls so quote calls stay near Kite’s one-request-per-second limit.
4. Zero-quantity contracts are hidden until **Show flat** is on.
5. Edit the spot, the seven default moves, the calendar horizon and the IV shift. Results are recomputed on the server.

## 6. Daily session expiry

A Kite access token expires at **06:00 Asia/Kolkata** on the calendar day after login. Retail apps do not get a refresh token. When that time passes, or Kite returns HTTP 403, the dashboard shows an expired session and asks you to connect again.

The access token is kept in process memory, keyed by an HTTP-only signed cookie. The cookie does not contain the token. A server restart drops every session and you need to log in again. There is no database or Redis.

## 7. What comes from Zerodha, and what is a model

From Kite Connect:

- Login URL, request-token exchange and logout
- Net position fields: exchange, trading symbol, instrument token, product, signed quantity, multiplier, average price, last price, unrealised, realised and net P&L
- Instrument master: underlying name, expiry, strike, option type and lot size
- Quote snapshot: last price, exchange timestamp, and bid/ask depth when the exchange sends them
- NIFTY 50 quote via `NSE:NIFTY 50`

Calculated in this app, not read from Zerodha:

- Implied volatility
- Delta, gamma, theta per calendar day and vega per volatility point
- Theoretical premiums at each NIFTY move
- Incremental scenario P&L versus the current quote
- Trade P&L versus the average price
- Expiry payoff when the horizon passes expiry

Kite’s quote payload does not include Greeks. Broker P&L can differ from the model because of charges, realised components and Zerodha’s own mark-to-market convention. Hypothetical prices exclude brokerage, taxes and slippage.

Pricing assumptions, also shown in the dashboard:

- European Black–Scholes–Merton
- Forward = spot × exp((interest rate − dividend yield) × time)
- Default rate 6.5% and dividend yield 0%, both editable
- ACT/365 calendar day count
- A 3-point IV increase means 20% becomes 23%
- Expired contracts settle at the scenario spot, which is not the official closing auction

## Scripts

```bash
npm test
npm run build
```

`npm test` mocks Kite and does not need credentials. `npm run test:smoke` is opt-in, calls only `getProfile`, and runs when `KITE_SMOKE=1` plus an API key and access token are present.

## Troubleshooting

- **Redirect mismatch:** the Kite app URL and `KITE_REDIRECT_URL` must both end in `/api/kite/callback`.
- **Checksum rejected:** the API secret does not match the app that owns the API key.
- **Request token expired:** start Connect again. The token only lasts a few minutes.
- **Empty book:** there is no open NIFTY CE/PE net quantity. Other underlyings are ignored.
- **Quote unavailable:** an expired contract or a closed market can omit a quote. The row stays, with IV left blank.
- **429:** wait and refresh. The server spaces quote requests by at least 1.1 seconds.
- **Session vanished:** the Node process restarted, or the clock passed 06:00 IST.
