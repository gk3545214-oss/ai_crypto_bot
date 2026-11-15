import unittest
from unittest.mock import patch

import httpx

from backend.main import app, get_client


def ticker(symbol):
    return {
        "symbol": symbol,
        "lastPrice": "110",
        "openPrice": "100",
        "highPrice": "115",
        "lowPrice": "95",
        "bidPrice": "109",
        "askPrice": "111",
        "quoteVolume": "12000",
        "closeTime": 5000,
    }


class MarketBackendTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.payload = [[1000, "100", "110", "90", "105", "5", 2000, "500"],
                        [2000, "105", "115", "100", "110", "4", 3000, "400"]]
        self.upstream_status = 200
        self.requests = []

        def upstream(request):
            self.requests.append(request)
            if request.url.path.endswith("ticker/24hr"):
                return httpx.Response(self.upstream_status, json=ticker(request.url.params["symbol"]))
            return httpx.Response(self.upstream_status, json=self.payload)

        self.exchange = httpx.AsyncClient(
            base_url="https://api.mexc.com", transport=httpx.MockTransport(upstream)
        )
        app.dependency_overrides[get_client] = lambda: self.exchange
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.exchange.aclose()

    async def test_tickers_retain_dashboard_contract(self):
        response = await self.client.get("/api/market")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual([x["symbol"] for x in data["tickers"]], ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
        self.assertEqual(data["tickers"][0]["changePercent"], 10)
        self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_candles_are_sorted_and_current_candle_is_marked(self):
        self.payload.reverse()
        with patch("backend.main.time.time", return_value=2.5):
            response = await self.client.get("/api/candles?symbol=ETHUSDT&interval=1h&limit=20")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["symbol"], "ETHUSDT")
        self.assertEqual(data["interval"], "1h")
        self.assertEqual([bar["openTime"] for bar in data["candles"]], [1000, 2000])
        self.assertEqual([bar["closed"] for bar in data["candles"]], [True, False])
        self.assertEqual(self.requests[0].url.params["limit"], "20")
        self.assertEqual(self.requests[0].url.params["interval"], "60m")

    async def test_invalid_queries_are_rejected_without_upstream_request(self):
        for query in ("symbol=BAD", "interval=2m", "limit=19", "limit=201"):
            with self.subTest(query=query):
                response = await self.client.get("/api/candles?" + query)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.requests, [])

    async def test_upstream_errors_are_explicit(self):
        self.upstream_status = 503
        for path in ("/api/candles", "/api/market"):
            with self.subTest(path=path):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 502)
                self.assertIn("error", response.json())

    async def test_invalid_and_duplicate_candles_are_rejected(self):
        for payload in (
            [],
            [[1000, "100", "99", "90", "105", "5", 2000, "500"]],
            [[1000, "100", "110", "90", "NaN", "5", 2000, "500"]],
            [self.payload[0], self.payload[0]],
        ):
            with self.subTest(payload=payload):
                self.payload = payload
                response = await self.client.get("/api/candles")
                self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
