# NIFTY Risk Lab — agent guide

This file is the map of the product. Read it before changing behavior, data files, environment variables, or pages.

## Keep this file current

Update this file in the same change whenever the work is considerable: a new page or API, a new environment variable, a change to how sessions, quotes, orders, cash, reports, or P&L are stored or calculated, or a behavior a later agent could undo by accident.

Leave secrets out of this file. Do not copy values from `.env.local`. Small copy, color, and spacing edits do not need a paragraph here.

## What this is

`nifty-risk-lab` is a local Next.js app for one person’s NIFTY options book. It logs into Zerodha with Kite Connect, prices scenarios with Black–Scholes–Merton, and keeps a post-market report plus FII/DII cash history. There is no database. Server sessions live in process memory.

Stack: Next.js 15, React 19, Tailwind 3 (`darkMode: ["class"]`), `kiteconnect` (kept external in `next.config.ts`), Recharts, Vitest. Times and trading dates are Asia/Kolkata.

Commands, from the repo root, in PowerShell (do not chain with `&&`):

```text
npm install
npm run dev
npm test
npm run build
```

The dev server is http://localhost:3000. `npm test` mocks Kite. `npm run test:smoke` calls `getProfile` only when `KITE_SMOKE=1` plus a key and access token are present. Unit tests live in `tests/unit`.

## Pages

| Route | Role |
| --- | --- |
| `/` | Zerodha book: positions, orders, scenarios, cumulative P&L, FII/DII chart |
| `/manual` | Typed NIFTY book. Reads quotes. Does not place orders |
| `/report` | Saved post-market session, newest first |
| `/stocks` | Saved NSE stock files. One JSON file per symbol under `data/stocks`. A save on the same IST day replaces that day’s snapshot; a later day appends one. **Refresh** re-fetches every saved file, one after another. **Remove** on the file page drops that file after a confirm. Paper lots for the same symbol stay until they are paper-sold |
| `/paper` | Hypothetical share buys. Not sent to Zerodha. Marks open lots and shows how far each researched price already is from its 52-week range |

Theme cookie is `nrl-theme`. Default is dark.

## Environment

Copy `.env.example` to `.env.local`. None of these names use a `NEXT_PUBLIC_` prefix.

| Variable | Role |
| --- | --- |
| `KITE_API_KEY` / `KITE_API_SECRET` | Kite app for User 1 |
| `KITE_API_KEY_2` / `KITE_API_SECRET_2` | Kite app for User 2. A personal Kite app only signs in the Zerodha user who created it |
| `KITE_REDIRECT_URL` | Same callback on both apps, normally `http://localhost:3000/api/kite/callback` |
| `SESSION_SECRET` | Signs the `nrl_sid` cookie. One secret covers both users. If it is missing, the signature dies on restart |

Access tokens are not environment variables. They are created by the login callback and kept in memory.

## Two Zerodha logins

The desk holds at most two accounts (`MAX_ACCOUNTS` in `lib/session/store.ts`). Header labels are **User 1 · {Zerodha name}** and **User 2 · {name}**. The number is the Kite app slot, so the same Zerodha user can be signed in twice when the two apps use copied credentials.

- **Connect Zerodha** is slot 1 (`/api/kite/login`). **Add account** fills the empty slot (`?account=1` or `?account=2`).
- The in-progress slot is the short-lived cookie `nrl_kite_slot`. The callback stores `slot` and `apiKey` on the session. Later calls must use that key with that access token (`kiteApiKey` in `lib/config.ts`).
- User 1 stays the quote account (NIFTY, India VIX, the near future, option marks, the instrument list) until that login is removed. The selected account loads only its own positions, orders, and charges.
- Logging in again on the same slot replaces that token. A third distinct slot is refused.
- **Log out** removes only the selected account. The cookie is cleared when none remain.
- Each token expires at 06:00 IST on the day after login. There is no refresh token. A server restart drops every session.

`POST /api/kite/active` body `{ accountId }` switches the book. The id is the in-memory session id, valid only for this desk.

## Zerodha book

`loadPortfolio` reads positions from the selected account and quotes from the market account. If the market token is expired, that session is dropped and quotes are retried with the selected account. NIFTY spot key is `NSE:NIFTY 50`. India VIX key is `NSE:INDIA VIX`.

New, modified, and cancelled orders go through `/api/kite/orders` and require `confirm: true`. New orders are NIFTY options only. Limit prices snap to the contract tick (0.05 unless the instrument says otherwise). Charges use Kite’s virtual contract note.

Quote calls are spaced at least 1.1 seconds apart. Option marks prefer the bid-ask mid, then the last price. The manual page’s NIFTY and India VIX tiles use the last price instead, because an index bid-ask is not the index print. The Zerodha page’s NIFTY tile still uses the shared quote assessment, so it can show a mid when depth is present.

During the weekday session 09:15–15:30 IST the dashboard turns on a 5 second book refresh by itself, until the user touches that switch. Outside that window it turns the switch off the same way. `isNseRegularSession` does not know exchange holidays. While the Zerodha page is open it also calls `/api/report/sync` every 30 minutes, and again when the tab becomes visible.

A portfolio snapshot is reused for about 4 seconds per account and flat-toggle (`lib/kite/snapshot-cache.ts`). The instrument master is reused for 6 hours. Both live on `globalThis` with the sessions, so a restart clears them.

The book is the Kite **net** array, not the day array. Only NIFTY calls and puts are kept. Weekly symbols (`NIFTY26O1424500CE`) and monthly symbols (`NIFTY26OCT24500CE`) both parse. Other underlyings are ignored. Quantity is already in option units, so lot size is not applied again. A positive quantity is long and a negative quantity is short. Zero-quantity rows stay hidden until **Show flat** is on. A position id is `exchange:symbol:product`.

Broker day’s P&L is `day sells − day buys + open quantity × mark − overnight quantity × previous close` (`kiteDayPnl`). Broker unrealised is Kite’s own field. Neither is the scenario model. The manual book has no intraday fills, so its day’s P&L is signed quantity times live price minus the previous close.

Orders are regular variety, product `NRML` or `MIS`. Closing a row sends the opposite side for the whole held quantity. Adding size uses one lot. Charges are brokerage, STT, exchange transaction charge, SEBI fee, stamp duty, and GST from the virtual contract note.

## Manual book

Contracts, the optional scenario spot, and the scenario controls are in `localStorage` under `nrl-manual-book`. The summary **NIFTY spot** tile shows the live Kite last price, not a bid-ask mid and not the typed scenario spot. A typed spot is only the scenario starting level. While the tab is visible the page polls `/api/kite/lookup` every 5 seconds and keeps the last good quote if one poll fails. Lookup uses the market login, and falls back to the selected login if that market token has expired. The contract list is `/api/kite/contracts`. The owner may retire this page later. Leave it in place until they ask to remove it.

## FII / DII cash

Saved in `lib/flows/fii-dii.json`. Values are provisional combined NSE+BSE+MSEI nets in ₹ crore, from `https://www.nseindia.com/api/fiidiiTradeReact`. That feed returns only the latest session, so a missed day cannot be backfilled. Do not switch the saved series to the NSE-only feed `fiidiiTradeNse`. `mergeFlowFetch` adds the fetched date and leaves older dates in place. Blank days are omitted from the 5, 10, 20, and 40 session sums. They are not treated as zero.

The cash session is expected from 17:30 IST (`expectedFlowDate`). Automatic fetches run when that date is missing and the last attempt is at least 10 minutes old. **Refresh cash**, on the report in section “2. What did institutions do?” and only for the latest session, calls the report with `refresh=1`, which forces a fetch. The chart on the dashboard has no cash-refresh button. Bars are FII `#38bdf8` and DII `#f59e0b`, with square corners. The frame opens on the last 90 calendar days ending at the newest saved session and can scroll from July through 31 March.

A report saved before the cash print arrived is filled from this file on the next read (`applySavedCash`). The rest of that saved session is left as it was.

## Post-market report

Files are `data/reports/YYYY-MM-DD.json`. The default date is the latest session whose close should already be out, which is today only after 16:00 IST. Live NSE capture is allowed for that latest date before 09:15, after 16:00, and all day on weekends and holidays. Between 09:15 and 16:00 the saved report is kept. If it has contributors and capture is not live, it stays cached so an intraday board does not replace the close. Missing cash is the exception: it is copied in from the cash file.

Settled reports are not rebuilt. A report that is still incomplete is retried after 15 minutes. Up to five missed trading days are backfilled when the report page or `/api/report/sync` runs. The page itself reloads the latest session every 30 minutes while it is open.

The report is read aloud from `lib/report/narrate.ts`. The chosen voice is `localStorage` key `nrl-reader-voice`. India VIX up is green on the Zerodha page because the color follows the sign of the change. The spoken evidence still treats a VIX rise as adverse. Leave that split unless asked to change it.

`/api/market-brief` is the short strip on the Zerodha and manual pages: top three pullers and draggers, Client/Pro/FII index-futures contract changes, and the largest call and put strikes. It is read from the saved report, not from a live quote.

## Cumulative P&L

The chart is “P&L since 1 Apr”, in ₹ lakhs, plotted on weekdays from 1 Oct 2026 through 31 Mar 2027. Points come only from `SEEDED_DAILY_PNL` in `lib/pnl/daily.ts`. Negative numbers are losses. Losses draw in red and gains in green. There is no on-screen way to add or revert a point, and browser copies under `nrl-daily-pnl`, `nrl-cumulative-pnl`, and `nrl-cumulative-pnl-lakh` are removed on load. Add a new day by editing `SEEDED_DAILY_PNL`.

`NSE_HOLIDAYS` is the published weekday list for 2026 plus Republic Day 2027. Add a later 2027 holiday only after NSE publishes it.

## Stock files

`/stocks` stores one JSON file per NSE symbol in `data/stocks`. Suzlon is `SUZLON`. Campus Activewear is `CAMPUS`. Saving again on the same Asia/Kolkata day replaces that day’s snapshot. A later day appends a snapshot. **Refresh** on the list re-fetches every saved file, one after another, and shows progress. **Remove** on the file page deletes that JSON file after a confirm. List cards do not have a remove button. Paper lots for the same symbol stay until they are paper-sold. List cards are numbered from 1 in the bottom-right, and ordered green to red, with unmarked cards last. Each card also shows how far last is from the 52-week high, and current, median, and all-time high P/E. Groww does not send an all-time high price, so the fall uses the 52-week print. Current P/E is Groww’s TTM print. Median and all-time high P/E are trailing P/E across listed history: quarterly EPS from TickerTape and weekly closes from Yahoo, stored on the file at save. They are not a buy or sell call. Same colour stays alphabetical. After a highlight click the colour changes at once, but the list waits 5 seconds after the last click before it re-sorts, so a few clicks can cycle the colour first. One small pulsing highlight dot sits at the top-right of the name-and-price block. Each click cycles green, lime, amber, orange, then red, and tints the whole stock card (and the whole file page) with that border. The colour is stored on the file and kept across snapshot saves. It is not a buy or sell call. A comment box on the file page stores owner notes on that JSON file and keeps them across snapshot saves. The page compares the latest reading with the previous saved day and does not turn that comparison into a buy or sell call.

The live print (last, change, OHLC, volume, 52-week range) comes from Groww’s NSE cash endpoint. The day average is Kite’s average traded price when a market login is present, and otherwise the volume-weighted price of that day’s minute bars. If a Zerodha market login is present, that save uses the Kite quote for the last price instead and still keeps Groww’s 52-week range. Market cap, current P/E, ROE, debt, shareholding, and revenue, profit, and net worth come from Groww’s company JSON. Median and all-time high P/E are not in that JSON; a save looks up TickerTape’s SID, reads quarterly EPS, and builds trailing P/E against Yahoo weekly closes. Results use the series with the newest year. Consolidated wins a tie. Campus Activewear is `CAMPUS`; Groww’s consolidated series for that name stops at 2022, so the file uses standalone. The card title says which one was saved. Net margin on the page is profit divided by revenue. The same save keeps the company description, trailing one-year growth and three-year CAGR when Groww sends them, and Groww’s peer list. Headlines, dividend ex-dates, and results dates come from the Groww stock page’s embedded data. Each headline keeps Groww’s article URL when that field is present, and the title is a link. `notes` on the snapshot is a reading of those figures for this page and for a later agent. It is not a buy or sell call. The file keeps every published shareholding quarter. The page states how each group moved from the quarter before, and from the earliest quarter on the file, including a peak or trough when that is not the first or last reading. Kite’s quote does not include P/E, results, or shareholding. NSE `quote-equity` is blocked from this machine, so do not switch the file to it unless a fetch from here actually returns JSON. Each listed symbol links to `https://www.screener.in/company/{SYMBOL}/`. Do not scrape Screener for this page.

## Paper book

`/paper` records hypothetical share buys in `data/paper/book.json`. The file is created on the first buy. Nothing on this page is sent to Zerodha. A buy stores the symbol, share count, and entry. A blank price uses the Groww NSE last print. **Paper sell** closes the whole lot at that live print and keeps the realised result. Open lots are marked to the same print, and fall back to the latest saved stock file if the print fails.

Each researched symbol, and each open lot, shows how far the last price is from its 52-week low, from its 52-week high, and from the first saved reading. When the last price is within 5% of the 52-week high, the page says it is close to that high. When it is at least 25% above the 52-week low and not close to the high, the page says it is already well above the low. Those lines are not a buy or sell call. Paper P&L ignores brokerage and taxes.

## Scenario layout

Default moves are −500, −200, −100, 0, +100, +200, +500 index points. The server prices them at `/api/kite/scenario`. Long calls and short puts count as bullish. Long puts and short calls count as bearish. The mix bar prefers delta, then contract count. The expiry payoff is the cash settlement at 15:30 IST on the instrument expiry, using the scenario spot. On the Zerodha page the order is scenario table, then the cumulative P&L chart, then the FII/DII chart.

## Routes

| Route | Role |
| --- | --- |
| `GET /api/kite/login` | Start Kite login. `?account=2` uses the second app |
| `GET /api/kite/callback` | Exchange `request_token`, store the session, redirect to `/` |
| `GET /api/kite/status` | Desk status. Includes whether the second app is configured |
| `POST /api/kite/active` | Select which account’s book is shown |
| `POST /api/kite/logout` | Invalidate the selected token |
| `GET /api/kite/positions` | Selected book, shared quotes |
| `GET` and `POST /api/kite/orders` | List, place, modify, cancel |
| `POST /api/kite/scenario` | Price the current book |
| `POST /api/kite/lookup` | Manual spot, VIX, future, and contract quotes |
| `GET /api/kite/contracts` | Listed NIFTY options for the manual picker |
| `GET /api/flows` | Cash series. `?refresh=1` forces the NSE fetch |
| `GET /api/report` | Saved or rebuilt session. `refresh=1` skips the cache |
| `GET /api/report/sync` | Backfill due sessions without returning the body |
| `GET /api/market-brief` | Slim strip from the latest saved report |
| `GET /api/stocks` | List saved stock files |
| `POST /api/stocks` | Save a symbol. Body `{ "symbol": "SUZLON" }` |
| `GET /api/stocks/[symbol]` | One saved file plus the comparison with the previous day |
| `POST /api/stocks/[symbol]` | Refresh that symbol’s snapshot |
| `DELETE /api/stocks/[symbol]` | Remove that saved file |
| `PATCH /api/stocks/[symbol]` | Set highlight and/or comment. Body `{ "highlight": "green" }` or `{ "highlight": null }`, and/or `{ "comment": "…" }` |
| `GET /api/paper` | Paper desk: open lots, closed lots, and the research-list range lines |
| `POST /api/paper` | Paper buy `{ "action": "buy", "symbol": "COLPAL", "quantity": 1 }` with optional `price`, or paper sell `{ "action": "sell", "id" }` |

## Pricing

European Black–Scholes–Merton. Forward is spot × exp((rate − dividend yield) × time). Defaults are 6.5% and 0% dividend yield, both editable. Day count is ACT/365. Theta is per calendar day. Vega is per one volatility point. A 3-point IV shift turns 20% into 23%. Expired contracts in a scenario settle at the scenario spot. Greeks are calculated here. Kite does not send them. Money format uses the Unicode minus in `lib/format.ts`.

## Where to look

| Area | Path |
| --- | --- |
| Kite config and the two app keys | `lib/config.ts` |
| Desk, cookie, User 1 / User 2 | `lib/session/store.ts` |
| Positions, shared quotes | `lib/kite/portfolio.ts`, `lib/kite/guard.ts` |
| Manual quotes | `lib/kite/lookup.ts`, `components/manual/manual-lab.tsx` |
| Orders | `lib/kite/order-actions.ts`, `app/api/kite/orders/route.ts` |
| Cash file and NSE fetch | `lib/flows/fii-dii.json`, `lib/flows/book.ts`, `lib/flows/fii-dii.ts` |
| Report build and cash fill | `lib/report/load.ts`, `lib/report/parse.ts`, `components/report/market-report.tsx` |
| Seeded P&L and holidays | `lib/pnl/daily.ts`, `components/dashboard/daily-pnl.tsx` |
| Stock files | `data/stocks`, `lib/stocks/book.ts`, `lib/stocks/pe.ts`, `lib/stocks/reading.ts`, `app/api/stocks`, `components/stocks` |
| Paper book | `data/paper/book.json`, `lib/paper`, `app/api/paper`, `components/paper/paper-desk.tsx` |
| IST helpers | `lib/time.ts` |
| Day and trade P&L | `lib/pricing/pnl.ts` |
| Bullish / bearish mix | `lib/risk/direction.ts` |
| Spoken report | `lib/report/narrate.ts`, `lib/report/speak.ts` |

`README.md` is the install guide. Where it still says the app never calls order APIs, this file is the one to follow: the dashboard can place, modify, and cancel NIFTY option orders after confirmation.
