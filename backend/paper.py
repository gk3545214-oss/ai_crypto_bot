import os
import sqlite3
import time
from decimal import Decimal
from pathlib import Path

FEE_RATE = Decimal("0.001")
SLIPPAGE_RATE = Decimal("0.0005")
MAX_ALLOCATION = Decimal("0.10")
MAX_QUOTE_AGE_MS = 30_000
ZERO = Decimal("0")


class PaperError(Exception):
    pass


def database_path() -> Path:
    return Path(os.environ.get("ASTER_PAPER_DB", Path(__file__).resolve().parent.parent / "data" / "paper.sqlite3"))


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def initialize(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS paper_account (
            id INTEGER PRIMARY KEY CHECK (id = 1), usdt TEXT NOT NULL, btc TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS paper_fills (
            request_id TEXT PRIMARY KEY, side TEXT NOT NULL, quantity TEXT NOT NULL,
            price TEXT NOT NULL, fee TEXT NOT NULL, quote_time INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )""")
        db.execute("INSERT OR IGNORE INTO paper_account VALUES (1, '100', '0')")


def snapshot(path: Path) -> dict:
    with connect(path) as db:
        account = db.execute("SELECT usdt, btc FROM paper_account WHERE id = 1").fetchone()
        fills = db.execute(
            "SELECT request_id, side, quantity, price, fee, quote_time, created_at "
            "FROM paper_fills ORDER BY rowid DESC LIMIT 50"
        ).fetchall()
    if account is None:
        raise RuntimeError("Paper account is not initialized")
    return {
        "usdt": account["usdt"],
        "btc": account["btc"],
        "fills": [dict(fill) for fill in fills],
        "feeRate": str(FEE_RATE),
        "slippageRate": str(SLIPPAGE_RATE),
        "maxAllocation": str(MAX_ALLOCATION),
    }


def existing_order(path: Path, request_id: str, side: str, quantity: Decimal) -> bool:
    with connect(path) as db:
        row = db.execute("SELECT side, quantity FROM paper_fills WHERE request_id = ?", (request_id,)).fetchone()
    if row is None:
        return False
    if row["side"] != side or Decimal(row["quantity"]) != quantity:
        raise PaperError("This request ID was already used for a different order.")
    return True


def execute(path: Path, request_id: str, side: str, quantity: Decimal, quote: dict) -> None:
    now = int(time.time() * 1000)
    try:
        bid = Decimal(str(quote["bidPrice"]))
        ask = Decimal(str(quote["askPrice"]))
        quote_time = int(quote["exchangeTime"])
    except (KeyError, ValueError, TypeError) as exc:
        raise PaperError("The exchange quote is invalid; no paper order was placed.") from exc
    if (
        not bid.is_finite() or not ask.is_finite() or bid <= ZERO or ask < bid
        or quote_time > now + 5_000 or now - quote_time > MAX_QUOTE_AGE_MS
    ):
        raise PaperError("The exchange quote is stale or invalid; no paper order was placed.")

    with connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        prior = db.execute("SELECT side, quantity FROM paper_fills WHERE request_id = ?", (request_id,)).fetchone()
        if prior:
            if prior["side"] != side or Decimal(prior["quantity"]) != quantity:
                raise PaperError("This request ID was already used for a different order.")
            return
        account = db.execute("SELECT usdt, btc FROM paper_account WHERE id = 1").fetchone()
        if account is None:
            raise RuntimeError("Paper account is not initialized")
        cash, btc = Decimal(account["usdt"]), Decimal(account["btc"])
        price = ask * (1 + SLIPPAGE_RATE) if side == "buy" else bid * (1 - SLIPPAGE_RATE)
        notional = quantity * price
        fee = notional * FEE_RATE
        if side == "buy":
            if cash < notional + fee:
                raise PaperError("Insufficient paper USDT including the simulated fee.")
            equity_after_fill = cash - notional - fee + (btc + quantity) * bid
            if (btc + quantity) * bid > equity_after_fill * MAX_ALLOCATION:
                raise PaperError("Paper buy would exceed the 10% BTC allocation limit.")
            cash -= notional + fee
            btc += quantity
        else:
            if btc < quantity:
                raise PaperError("Insufficient paper BTC.")
            cash += notional - fee
            btc -= quantity
        db.execute("UPDATE paper_account SET usdt = ?, btc = ? WHERE id = 1", (str(cash), str(btc)))
        db.execute(
            "INSERT INTO paper_fills VALUES (?, ?, ?, ?, ?, ?, ?)",
            (request_id, side, str(quantity), str(price), str(fee), quote_time, now),
        )
