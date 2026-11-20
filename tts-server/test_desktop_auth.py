"""Desktop credential, Host check and proxy header checks using in-process clients."""

import os
import unittest
from unittest.mock import patch

import httpx

import main

TOKEN = "desktop-test"


class DesktopAuthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        env = patch.dict(os.environ, {"VOIDCAST_DESKTOP_TOKEN": TOKEN}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.desktop = self.client("127.0.0.1", {"x-voidcast-desktop-token": TOKEN})
        self.page = self.client("127.0.0.1", {})
        self.addAsyncCleanup(self.desktop.aclose)
        self.addAsyncCleanup(self.page.aclose)

    def client(self, address, headers, base_url="http://127.0.0.1"):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, client=(address, 12345)),
            base_url=base_url,
            headers=headers,
        )

    async def test_tool_routes_require_the_desktop_token_even_on_loopback(self):
        body = {"content": "x", "output_dir": "unused"}
        self.assertEqual((await self.page.post("/tools/pdf", json=body)).status_code, 403)
        wrong = self.client("127.0.0.1", {"x-voidcast-desktop-token": "other"})
        self.addAsyncCleanup(wrong.aclose)
        self.assertEqual((await wrong.post("/tools/pdf", json=body)).status_code, 403)

    async def test_health_tells_our_server_from_a_foreign_one(self):
        self.assertTrue((await self.desktop.get("/health")).json()["desktop"])
        self.assertFalse((await self.page.get("/health")).json()["desktop"])

    async def test_rebound_hostnames_are_rejected(self):
        rebound = self.client(
            "127.0.0.1", {"x-voidcast-desktop-token": TOKEN}, "http://attacker.example"
        )
        self.addAsyncCleanup(rebound.aclose)
        self.assertEqual((await rebound.get("/health")).status_code, 400)

    async def test_removed_lan_routes_are_gone(self):
        for method, path in (
            ("GET", "/"),
            ("POST", "/tools/cloud-secrets"),
            ("GET", "/tools/user-data"),
            ("POST", "/tools/user-data-sync"),
            ("GET", "/tools/host-tool-config"),
            ("GET", "/api/openrouter/api/v1/models"),
        ):
            response = await self.desktop.request(method, path)
            self.assertIn(response.status_code, (404, 405), path)

    async def test_proxy_sends_only_provider_credentials(self):
        self.desktop.headers.update(
            {
                "x-api-key": "test-provider",
                "x-voidcast-access-token": "internal",
                "referer": "http://127.0.0.1/?t=secret",
                "cookie": "local=session",
            }
        )
        forwarded = []

        def upstream(request):
            forwarded.append(request.headers)
            return httpx.Response(200, stream=httpx.ByteStream(b"ok"))

        client = httpx.AsyncClient
        transport = httpx.MockTransport(upstream)
        with patch.object(
            main.httpx, "AsyncClient", lambda **kw: client(transport=transport, **kw)
        ):
            (await self.desktop.post("/api/opencode-go/messages")).raise_for_status()
        (headers,) = forwarded
        self.assertEqual(headers["authorization"], "Bearer test-provider")
        self.assertEqual(headers["x-api-key"], "test-provider")
        for name in (
            "x-voidcast-desktop-token",
            "x-voidcast-access-token",
            "cookie",
            "referer",
        ):
            self.assertNotIn(name, headers)


if __name__ == "__main__":
    unittest.main()
