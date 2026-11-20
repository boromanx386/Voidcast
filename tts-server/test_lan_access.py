"""LAN pairing and proxy integration checks using in-process clients."""

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

import main
from cloud_secrets import clear_registered_secrets
from host_tool_config import clear_host_tool_config


class LanAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        env = patch.dict(
            os.environ, {"VOIDCAST_DESKTOP_TOKEN": "test-desktop"}, clear=True
        )
        env.start()
        self.addCleanup(env.stop)
        clear_registered_secrets()
        clear_host_tool_config()
        self.addCleanup(clear_registered_secrets)
        self.addCleanup(clear_host_tool_config)
        self.desktop = self.client("127.0.0.1")
        self.desktop.headers["x-voidcast-desktop-token"] = "test-desktop"
        self.phone = self.client("192.0.2.8")
        self.addAsyncCleanup(self.desktop.aclose)
        self.addAsyncCleanup(self.phone.aclose)

    def client(self, address):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, client=(address, 12345)),
            base_url="http://127.0.0.1",
        )

    async def register(self, **fields):
        response = await self.desktop.post("/tools/cloud-secrets", json=fields)
        response.raise_for_status()
        return response.json()["token"]

    async def test_disable_revoke_and_pair_again(self):
        route = "/tools/host-tool-config"
        self.assertEqual((await self.phone.get(route)).status_code, 403)
        self.assertEqual((await self.phone.get("/")).status_code, 403)
        self.assertEqual((await self.desktop.get(route)).status_code, 200)
        first = await self.register(pdfOutputDir="shared")
        self.phone.headers["x-voidcast-access-token"] = first
        self.assertEqual(
            (await self.phone.get(route)).json()["pdf_output_dir"], "shared"
        )
        self.assertEqual(await self.register(), first)
        (await self.desktop.delete("/tools/cloud-secrets")).raise_for_status()
        self.assertEqual((await self.phone.get(route)).status_code, 403)
        self.assertEqual((await self.desktop.get(route)).json()["pdf_output_dir"], "")
        second = await self.register()
        self.assertNotEqual(first, second)
        self.assertEqual((await self.phone.get(route)).status_code, 401)
        self.phone.headers["x-voidcast-access-token"] = second
        self.assertEqual((await self.phone.get(route)).status_code, 200)
        self.assertNotEqual(await self.register(renewPairing=True), second)
        self.assertEqual((await self.phone.get(route)).status_code, 401)

    async def test_key_removal_preserves_other_keys_and_pairing(self):
        first = await self.register(openaiApiKey="test-one", deepseekApiKey="test-two")
        self.assertEqual(await self.register(openaiApiKey=""), first)
        status = (await self.desktop.get("/tools/cloud-secrets-status")).json()
        self.assertFalse(status["openai"])
        self.assertTrue(status["deepseek"])

    async def test_registration_is_desktop_only_and_admin_secret_is_separate(self):
        os.environ["VOIDCAST_SECRETS_TOKEN"] = "admin-test"
        os.environ["VOIDCAST_LAN_ACCESS_TOKEN"] = "previous-pinned-token"
        route = "/tools/cloud-secrets"
        self.assertEqual((await self.desktop.post(route, json={})).status_code, 403)
        self.desktop.headers["x-voidcast-secrets-token"] = "admin-test"
        token = await self.register()
        self.assertNotIn(token, ("admin-test", "previous-pinned-token"))
        self.phone.headers["x-voidcast-access-token"] = token
        self.assertEqual((await self.phone.delete(route)).status_code, 403)
        self.assertEqual(
            (await self.desktop.delete(route, headers={"Origin": "null"})).status_code,
            403,
        )

    async def test_proxy_sends_only_provider_credentials(self):
        token = await self.register(opencodeGoApiKey="test-provider")
        self.phone.headers.update(
            {
                "authorization": f"Bearer {token}",
                "x-voidcast-access-token": token,
                "x-voidcast-secrets-token": "internal",
                "referer": f"http://phone/?t={token}",
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
            path = "/api/opencode-go/messages"
            (await self.phone.post(path)).raise_for_status()
            await self.register(opencodeGoApiKey="")
            self.assertEqual((await self.phone.post(path)).status_code, 503)
            (
                await self.desktop.post(path, headers={"x-api-key": "local-provider"})
            ).raise_for_status()
        self.assertEqual(len(forwarded), 2)
        for headers, key in zip(
            forwarded, ("test-provider", "local-provider"), strict=True
        ):
            self.assertEqual(headers["authorization"], f"Bearer {key}")
            self.assertEqual(headers["x-api-key"], key)
            for name in (
                "x-voidcast-access-token",
                "x-voidcast-secrets-token",
                "x-voidcast-desktop-token",
                "cookie",
                "referer",
            ):
                self.assertNotIn(name, headers)

    async def test_local_data_requires_credentials_and_valid_host(self):
        route = "/tools/host-tool-config"
        valid = await self.desktop.get(route, headers={"Origin": "null"})
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.headers["access-control-allow-origin"], "null")
        options = {
            "Origin": "null",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-voidcast-desktop-token,x-api-key,user-agent",
        }
        self.assertEqual(
            (await self.desktop.options(route, headers=options)).status_code, 200
        )
        denied = await self.desktop.options(
            route, headers=options | {"Origin": "https://unrelated.example"}
        )
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(
            (
                await self.desktop.get(route, headers={"Host": "unknown.invalid"})
            ).status_code,
            400,
        )
        self.desktop.headers.clear()
        with patch.object(main, "apply_sync") as apply_sync:
            response = await self.desktop.post(
                "/tools/user-data-sync", headers={"Origin": "null"}, json={}
            )
            self.assertEqual(response.status_code, 403)
            apply_sync.assert_not_called()
        for origin in ("null", "https://unrelated.example"):
            response = await self.desktop.get(route, headers={"Origin": origin})
            self.assertEqual(response.status_code, 403)
            if origin != "null":
                self.assertNotIn("access-control-allow-origin", response.headers)
        self.assertEqual(
            (await self.desktop.post("/tools/cloud-secrets", json={})).status_code, 403
        )
        self.assertEqual(
            (
                await self.phone.get(
                    route, headers={"x-voidcast-desktop-token": "test-desktop"}
                )
            ).status_code,
            403,
        )

    async def test_lan_pdf_uses_only_the_registered_directory(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "pdf"
            token = await self.register(pdfOutputDir=str(root))
            self.phone.headers["x-voidcast-access-token"] = token
            body = {
                "output_dir": str(root),
                "filename": "sample.pdf",
                "content": "Example",
            }
            for changed in (
                {"output_dir": tmp},
                {"image_paths": [str(Path(tmp) / "elsewhere.png")]},
            ):
                response = await self.phone.post("/tools/pdf", json=body | changed)
                self.assertEqual(response.status_code, 403)
            self.assertFalse(root.exists())
            for name in ("sample.pdf", "sample-2.pdf"):
                response = await self.phone.post("/tools/pdf", json=body)
                response.raise_for_status()
                self.assertEqual(Path(response.json()["file_path"]), root / name)
                self.assertTrue((root / name).read_bytes().startswith(b"%PDF"))
            await self.register(pdfOutputDir="")
            self.assertEqual(
                (await self.phone.post("/tools/pdf", json=body)).status_code, 403
            )
            desktop = await self.desktop.post(
                "/tools/pdf", json=body | {"output_dir": tmp}
            )
            self.assertTrue(desktop.json()["ok"])
