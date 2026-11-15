import asyncio
import logging
import math
import sqlite3
import time
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend import paper

logger = logging.getLogger(__name__)
SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
Symbol = Literal["BTCUSDT", "ETHUSDT", "SOLUSDT"]
Interval = Literal["1m", "5m", "15m", "1h", "4h", "1d"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.paper_db = paper.database_path()
    paper.initialize(app.state.paper_db)
    async with httpx.AsyncClient(
        base_url="https://api.mexc.com", timeout=8.0, headers={"Accept": "application/json"}
    ) as client:
        app.state.mexc_client = client
        yield


app = FastAPI(title="Aster paper trading", lifespan=lifespan)


def get_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.mexc_client


def number(value: object, field: str) -> float:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"Invalid {field}")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field}") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"Invalid {field}")
    return parsed


async def fetch_json(client: httpx.AsyncClient, path: str, params: dict):
    response = await client.get(path, params=params)
    response.raise_for_status()
    return response.json()


async def fetch_ticker(client: httpx.AsyncClient, symbol: str) -> dict:
    payload = await fetch_json(client, "/api/v3/ticker/24hr", {"symbol": symbol})
    if not isinstance(payload, dict) or payload.get("symbol") != symbol:
        raise ValueError(f"Invalid ticker for {symbol}")
    last = number(payload.get("lastPrice"), "last price")
    opening = number(payload.get("openPrice"), "open price")
    if last <= 0 or opening <= 0:
        raise ValueError(f"Non-positive price for {symbol}")
    return {
        "symbol": symbol,
        "lastPrice": last,
        "changePercent": (last - opening) / opening * 100,
        "highPrice": number(payload.get("highPrice"), "high price"),
        "lowPrice": number(payload.get("lowPrice"), "low price"),
        "bidPrice": number(payload.get("bidPrice"), "bid price"),
        "askPrice": number(payload.get("askPrice"), "ask price"),
        "quoteVolume": number(payload.get("quoteVolume"), "quote volume"),
        "exchangeTime": number(payload.get("closeTime"), "timestamp"),
    }


def parse_candle(row: object, now: int) -> dict:
    if not isinstance(row, list) or len(row) < 8:
        raise ValueError("Malformed candle")
    open_time = number(row[0], "open time")
    opening = number(row[1], "open")
    high = number(row[2], "high")
    low = number(row[3], "low")
    close = number(row[4], "close")
    volume = number(row[5], "volume")
    close_time = number(row[6], "close time")
    quote_volume = number(row[7], "quote volume")
    if (
        open_time <= 0
        or close_time <= open_time
        or open_time != int(open_time)
        or close_time != int(close_time)
        or low <= 0
        or high < max(opening, close)
        or low > min(opening, close)
        or volume < 0
        or quote_volume < 0
    ):
        raise ValueError("Invalid candle values")
    return {
        "openTime": int(open_time),
        "open": opening,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "closeTime": int(close_time),
        "quoteVolume": quote_volume,
        "closed": close_time <= now,
    }


def unavailable(exc: Exception) -> JSONResponse:
    logger.warning("MEXC public market data unavailable: %s", exc)
    return JSONResponse(
        {"error": "MEXC market data is temporarily unavailable. Try again shortly."},
        status_code=502,
        headers={"Cache-Control": "no-store"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/market")
async def market(client: Annotated[httpx.AsyncClient, Depends(get_client)]):
    try:
        tickers = await asyncio.gather(*(fetch_ticker(client, symbol) for symbol in SYMBOLS))
    except (httpx.HTTPError, ValueError) as exc:
        return unavailable(exc)
    return JSONResponse(
        {"source": "MEXC Spot API", "receivedAt": int(time.time() * 1000), "tickers": tickers},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/candles")
async def candles(
    client: Annotated[httpx.AsyncClient, Depends(get_client)],
    symbol: Symbol = "BTCUSDT",
    interval: Interval = "5m",
    limit: Annotated[int, Query(ge=20, le=200)] = 100,
):
    try:
        payload = await fetch_json(
            client,
            "/api/v3/klines",
            {"symbol": symbol, "interval": "60m" if interval == "1h" else interval, "limit": limit},
        )
        if not isinstance(payload, list) or not payload:
            raise ValueError("Empty or invalid candle response")
        now = int(time.time() * 1000)
        bars = [parse_candle(row, now) for row in payload]
        bars.sort(key=lambda candle: candle["openTime"])
        if any(a["openTime"] >= b["openTime"] for a, b in zip(bars, bars[1:])):
            raise ValueError("Duplicate candle timestamp")
    except (httpx.HTTPError, ValueError) as exc:
        return unavailable(exc)
    return JSONResponse(
        {"source": "MEXC Spot API", "symbol": symbol, "interval": interval, "receivedAt": now, "candles": bars},
        headers={"Cache-Control": "no-store"},
    )


class PaperOrder(BaseModel):
    requestId: UUID
    side: Literal["buy", "sell"]
    quantity: Annotated[Decimal, Field(gt=0, max_digits=16, decimal_places=8, allow_inf_nan=False)]


@app.get("/api/paper")
async def paper_account(request: Request):
    try:
        return JSONResponse(paper.snapshot(request.app.state.paper_db), headers={"Cache-Control": "no-store"})
    except sqlite3.Error:
        logger.exception("Unable to read paper account")
        return JSONResponse({"error": "Paper account storage is unavailable."}, status_code=503)


@app.post("/api/paper/orders")
async def paper_order(
    order: PaperOrder, request: Request, client: Annotated[httpx.AsyncClient, Depends(get_client)]
):
    path = request.app.state.paper_db
    request_id = str(order.requestId)
    try:
        if not paper.existing_order(path, request_id, order.side, order.quantity):
            quote = await fetch_ticker(client, "BTCUSDT")
            paper.execute(path, request_id, order.side, order.quantity, quote)
        return JSONResponse(paper.snapshot(path), headers={"Cache-Control": "no-store"})
    except paper.PaperError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except (httpx.HTTPError, ValueError) as exc:
        return unavailable(exc)
    except sqlite3.Error:
        logger.exception("Unable to execute paper order")
        return JSONResponse({"error": "Paper account storage is unavailable."}, status_code=503)
