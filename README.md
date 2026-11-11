# Jamaica Money Market

A simple installable web app with:

- **Rates** – Jamaican money market and unit trust yields in J$ and US$, Bank of Jamaica policy rate, 30-day CD rate, inflation and Treasury bill yields. Every number shows its source and date. If a provider does not publish a rate, the app says "See provider".
- **Stocks** – Jamaica Stock Exchange indices and end-of-day prices, search, top gainers and losers, and a watchlist saved on your device.
- **Exchange** – Bank of Jamaica buy/sell rates and live mid-market rates, with a converter for USD, GBP, CAD and EUR to J$.
- **Calculator** – projected interest with Jamaica withholding tax.

Live: https://phillipalvaranga-arch.github.io/jamaica-money/

Data in `data/*.json` is refreshed by `.github/workflows/refresh.yml`, which runs `scripts/fetch_data.py` on weekdays. If a source page cannot be read, the last good values are kept with their dates.

Information only, not financial advice. The app never places trades and never asks for TRNs, SSNs, bank or card numbers, PINs or passwords.
