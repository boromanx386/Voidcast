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

    def _capture_upstream(self):
        forwarded = []

        def upstream(request):
            forwarded.append(request)
            return httpx.Response(200, stream=httpx.ByteStream(b"ok"))

        client = httpx.AsyncClient
        transport = httpx.MockTransport(upstream)
        return forwarded, patch.object(
            main.httpx, "AsyncClient", lambda **kw: client(transport=transport, **kw)
        )

    async def test_custom_proxy_targets_the_upstream_header(self):
        forwarded, patched = self._capture_upstream()
        with patched:
            response = await self.desktop.post(
                "/api/custom-llm/chat/completions",
                headers={
                    "x-voidcast-upstream": "http://localhost:1234/v1/",
                    "authorization": "Bearer sk-local",
                    "cookie": "local=session",
                },
                content=b"{}",
            )
        response.raise_for_status()
        (request,) = forwarded
        self.assertEqual(str(request.url), "http://localhost:1234/v1/chat/completions")
        self.assertEqual(request.headers["authorization"], "Bearer sk-local")
        self.assertNotIn("x-api-key", request.headers)
        for name in ("x-voidcast-upstream", "x-voidcast-desktop-token", "cookie"):
            self.assertNotIn(name, request.headers)

    async def test_custom_proxy_keeps_the_anthropic_key_header(self):
        forwarded, patched = self._capture_upstream()
        with patched:
            await self.desktop.post(
                "/api/custom-llm/messages",
                headers={
                    "x-voidcast-upstream": "https://api.anthropic.com/v1",
                    "x-api-key": "sk-ant",
                    "anthropic-version": "2023-06-01",
                },
                content=b"{}",
            )
        (request,) = forwarded
        self.assertEqual(str(request.url), "https://api.anthropic.com/v1/messages")
        self.assertEqual(request.headers["x-api-key"], "sk-ant")
        self.assertEqual(request.headers["anthropic-version"], "2023-06-01")
        self.assertNotIn("authorization", request.headers)

    async def test_custom_proxy_rejects_a_bad_upstream(self):
        forwarded, patched = self._capture_upstream()
        with patched:
            for upstream in ("", "file:///etc/passwd", "localhost:1234/v1", "http://h/v1?x=1"):
                response = await self.desktop.get(
                    "/api/custom-llm/models", headers={"x-voidcast-upstream": upstream}
                )
                self.assertEqual(response.status_code, 400, upstream)
        self.assertEqual(forwarded, [])

    async def test_custom_proxy_preflight_allows_the_upstream_header(self):
        for origin in ("http://localhost:5173", "null"):
            response = await self.page.options(
                "/api/custom-llm/chat/completions",
                headers={
                    "origin": origin,
                    "access-control-request-method": "POST",
                    "access-control-request-headers": (
                        "content-type,authorization,x-voidcast-desktop-token,x-voidcast-upstream"
                    ),
                },
            )
            self.assertEqual(response.status_code, 200, origin)
            allowed = response.headers["access-control-allow-headers"].lower()
            self.assertIn("x-voidcast-upstream", allowed)

    async def test_custom_proxy_requires_the_desktop_token(self):
        response = await self.page.get(
            "/api/custom-llm/models", headers={"x-voidcast-upstream": "http://localhost:1234/v1"}
        )
        self.assertEqual(response.status_code, 403)

    async def test_nvidia_proxy_forwards_to_nim_with_the_bearer_key(self):
        forwarded, patched = self._capture_upstream()
        with patched:
            response = await self.desktop.post(
                "/api/nvidia/v1/chat/completions",
                headers={"authorization": "Bearer nvapi-test", "cookie": "a=b"},
                content=b"{}",
            )
        response.raise_for_status()
        (request,) = forwarded
        self.assertEqual(
            str(request.url), "https://integrate.api.nvidia.com/v1/chat/completions"
        )
        self.assertEqual(request.headers["authorization"], "Bearer nvapi-test")
        for name in ("x-voidcast-desktop-token", "cookie"):
            self.assertNotIn(name, request.headers)

    async def test_nvidia_proxy_requires_a_key_and_the_desktop_token(self):
        forwarded, patched = self._capture_upstream()
        with patched:
            missing = await self.desktop.post(
                "/api/nvidia/v1/chat/completions", content=b"{}"
            )
            page = await self.page.post(
                "/api/nvidia/v1/chat/completions",
                headers={"authorization": "Bearer nvapi-test"},
                content=b"{}",
            )
        self.assertEqual(missing.status_code, 503)
        self.assertEqual(page.status_code, 403)
        self.assertEqual(forwarded, [])


if __name__ == "__main__":
    unittest.main()
