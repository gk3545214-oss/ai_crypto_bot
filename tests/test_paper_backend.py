import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

import httpx

from backend import paper
from backend.main import app, get_client


class PaperBackendTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "account.sqlite3"
        paper.initialize(self.path)
        app.state.paper_db = self.path
        self.quote_time = int(time.time() * 1000)
        self.status = 200
        self.exchange = httpx.AsyncClient(
            base_url="https://api.mexc.com", transport=httpx.MockTransport(self.upstream)
        )
        app.dependency_overrides[get_client] = lambda: self.exchange
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    def upstream(self, request):
        return httpx.Response(self.status, json={
            "symbol": "BTCUSDT", "lastPrice": "100", "openPrice": "100",
            "highPrice": "101", "lowPrice": "99", "bidPrice": "99",
            "askPrice": "100", "quoteVolume": "100", "closeTime": self.quote_time,
        })

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.exchange.aclose()
        self.tmp.cleanup()

    async def order(self, side="buy", quantity="0.05", request_id=None):
        return await self.client.post("/api/paper/orders", json={
            "requestId": request_id or str(uuid4()), "side": side, "quantity": quantity,
        })

    async def test_persistence_buy_sell_and_idempotent_retries(self):
        request_id = str(uuid4())
        first = await self.order(request_id=request_id)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["btc"], "0.05")
        self.status = 503
        repeat = await self.order(request_id=request_id)
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(len(repeat.json()["fills"]), 1)
        self.assertEqual((await self.order(quantity="0.04", request_id=request_id)).status_code, 409)
        self.status = 200
        self.assertEqual((await self.order(side="sell", quantity="0.05")).status_code, 200)
        paper.initialize(self.path)
        account = (await self.client.get("/api/paper")).json()
        self.assertEqual(paper.Decimal(account["btc"]), 0)
        self.assertLess(paper.Decimal(account["usdt"]), 100)
        self.assertEqual(len(account["fills"]), 2)

    async def test_risk_validation_and_upstream_failure_do_not_mutate_account(self):
        for side, quantity in [("buy", "0.2"), ("sell", "0.01")]:
            self.assertEqual((await self.order(side, quantity)).status_code, 409)
        for quantity in ("0", "-1", "0.000000001", "NaN"):
            self.assertEqual((await self.order(quantity=quantity)).status_code, 422)
        self.quote_time -= 60_000
        self.assertEqual((await self.order()).status_code, 409)
        self.quote_time = int(time.time() * 1000)
        self.status = 503
        self.assertEqual((await self.order()).status_code, 502)
        account = (await self.client.get("/api/paper")).json()
        self.assertEqual((account["usdt"], account["btc"], account["fills"]), ("100", "0", []))

    async def test_concurrent_duplicate_request_is_filled_once(self):
        request_id = str(uuid4())
        results = await asyncio.gather(self.order(request_id=request_id), self.order(request_id=request_id))
        self.assertEqual([r.status_code for r in results], [200, 200])
        account = (await self.client.get("/api/paper")).json()
        self.assertEqual(account["btc"], "0.05")
        self.assertEqual(len(account["fills"]), 1)

    async def test_allocation_covers_existing_position(self):
        self.assertEqual((await self.order(quantity="0.09")).status_code, 200)
        self.assertEqual((await self.order(quantity="0.02")).status_code, 409)
        self.assertEqual((await self.client.get("/api/paper")).json()["btc"], "0.09")


if __name__ == "__main__":
    unittest.main()
