import contextlib
import importlib.util
import io
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "growth-audit" / "blog-manifest-content-wave-2026-09-05.json"
IMAGE_JOBS_PATH = ROOT / "growth-audit" / "blog-image-jobs-content-wave-2026-09-05.json"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


BLOG = load_module("content_wave_blog_publish", ROOT / "scripts" / "blog_publish.py")
IMAGES = load_module("content_wave_gen_image", ROOT / "scripts" / "gen_image.py")


class BlogPublisherSeoTests(unittest.TestCase):
    def test_seo_input_accepts_and_strips_valid_values(self):
        row = {"seo_title": "  A useful title  ", "seo_description": "  A useful description.  "}
        self.assertEqual(BLOG.seo_input(row), {"title": "A useful title", "description": "A useful description."})

    def test_seo_input_rejects_blank_and_over_limit_values(self):
        for row in (
            {"seo_title": " "},
            {"seo_description": "\n"},
            {"seo_title": "t" * 61},
            {"seo_description": "d" * 161},
        ):
            with self.subTest(row=row), self.assertRaises(ValueError):
                BLOG.seo_input(row)

    def test_article_queries_and_mutations_request_seo_metafield_readback(self):
        for query in (BLOG.Q_FIND, BLOG.Q_LIST, BLOG.M_CREATE, BLOG.M_UPDATE):
            with self.subTest(query=query[:30]):
                self.assertIn('metafields(first: 2, keys: ["global.title_tag", "global.description_tag"])', query)
                self.assertIn("id namespace key type value", query)

    def test_prepare_article_adds_shopify_seo_and_stays_draft(self):
        row = json.loads(MANIFEST_PATH.read_text())[1]
        article, body, _, _ = BLOG.prepare_article(row)
        self.assertEqual(
            article["metafields"],
            [
                {"namespace": "global", "key": "title_tag", "type": "single_line_text_field", "value": row["seo_title"]},
                {"namespace": "global", "key": "description_tag", "type": "single_line_text_field", "value": row["seo_description"]},
            ],
        )
        self.assertFalse(article["isPublished"])
        self.assertEqual(article["publishDate"], row["publish_at"])
        self.assertNotRegex(body, r"(?i)<h1\b")

    def test_upsert_persists_returned_seo_without_network(self):
        row = json.loads(MANIFEST_PATH.read_text())[0]
        calls = []

        def fake_gql(query, variables=None):
            calls.append((query, variables))
            article = variables["article"]
            values = {m["key"]: m["value"] for m in article["metafields"]}
            return {
                "articleCreate": {
                    "article": {
                        "id": "gid://shopify/Article/1",
                        "handle": article["handle"],
                        "title": article["title"],
                        "isPublished": False,
                        "publishedAt": None,
                        "metafields": {
                            "nodes": [
                                {"id": "gid://shopify/Metafield/1", "namespace": "global", "key": "title_tag", "type": "single_line_text_field", "value": values["title_tag"]},
                                {"id": "gid://shopify/Metafield/2", "namespace": "global", "key": "description_tag", "type": "single_line_text_field", "value": values["description_tag"]},
                            ]
                        },
                        "image": None,
                    },
                    "userErrors": [],
                }
            }

        original_ledger = BLOG.LEDGER
        try:
            with tempfile.TemporaryDirectory() as td:
                BLOG.LEDGER = pathlib.Path(td) / "ledger.json"
                with mock.patch.object(BLOG, "find_by_handle", return_value=None), mock.patch.object(BLOG, "gql", side_effect=fake_gql):
                    with contextlib.redirect_stdout(io.StringIO()):
                        BLOG.upsert(row)
                ledger_row = json.loads(BLOG.LEDGER.read_text())["articles"][row["handle"]]
                self.assertEqual(ledger_row["seo_title"], row["seo_title"])
                self.assertEqual(ledger_row["seo_description"], row["seo_description"])
                self.assertEqual(calls[0][1]["article"]["metafields"][0]["value"], row["seo_title"])
        finally:
            BLOG.LEDGER = original_ledger

    def test_existing_seo_metafields_are_updated_by_id(self):
        row = json.loads(MANIFEST_PATH.read_text())[0]
        existing = {
            "metafields": {
                "nodes": [
                    {"id": "gid://shopify/Metafield/11", "namespace": "global", "key": "title_tag", "value": "Old title"},
                    {"id": "gid://shopify/Metafield/12", "namespace": "global", "key": "description_tag", "value": "Old description"},
                ]
            }
        }
        article, _, _, _ = BLOG.prepare_article(row, existing=existing)
        self.assertEqual(
            article["metafields"],
            [
                {"id": "gid://shopify/Metafield/11", "value": row["seo_title"]},
                {"id": "gid://shopify/Metafield/12", "value": row["seo_description"]},
            ],
        )

    def test_upsert_fails_if_shopify_seo_readback_differs(self):
        row = json.loads(MANIFEST_PATH.read_text())[0]
        response = {
            "articleCreate": {
                "article": {
                    "id": "gid://shopify/Article/2",
                    "handle": row["handle"],
                    "title": row["title"],
                    "isPublished": False,
                    "publishedAt": None,
                    "metafields": {"nodes": []},
                    "image": None,
                },
                "userErrors": [],
            }
        }
        with mock.patch.object(BLOG, "find_by_handle", return_value=None), mock.patch.object(BLOG, "gql", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "SEO metafield readback mismatch"):
                BLOG.upsert(row)

    def test_validate_only_cli_is_credential_free_and_offline(self):
        result = subprocess.run(
            [sys.executable, "scripts/blog_publish.py", "--manifest", str(MANIFEST_PATH.relative_to(ROOT)), "--validate-only"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            env={},
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("VALID "), 2)
        self.assertNotIn("FAIL", result.stderr)


class FalOnlyTests(unittest.TestCase):
    def test_fal_only_fails_closed_without_openai_call(self):
        with mock.patch.object(IMAGES, "submit", side_effect=RuntimeError("simulated FAL failure")), \
                mock.patch.object(IMAGES, "gen_image_openai") as openai:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaisesRegex(SystemExit, "OpenAI fallback disabled"):
                IMAGES.gen_image("prompt", "/tmp/never-written.jpg", model="fal-ai/nano-banana-2", allow_openai_fallback=False)
            openai.assert_not_called()

    def test_default_mode_retains_explicit_openai_fallback(self):
        marker = {"provider": "openai"}
        with mock.patch.object(IMAGES, "submit", side_effect=RuntimeError("simulated FAL failure")), \
                mock.patch.object(IMAGES, "gen_image_openai", return_value=marker) as openai:
            with contextlib.redirect_stderr(io.StringIO()):
                result = IMAGES.gen_image("prompt", "/tmp/never-written.jpg", model="fal-ai/nano-banana-2")
        self.assertEqual(result, marker)
        openai.assert_called_once()

    def test_direct_openai_model_is_rejected_in_fal_only_mode(self):
        with mock.patch.object(IMAGES, "gen_image_openai") as openai:
            with self.assertRaisesRegex(SystemExit, "OpenAI image generation is disabled"):
                IMAGES.gen_image("prompt", "/tmp/never-written.jpg", model="openai", allow_openai_fallback=False)
            openai.assert_not_called()

    def test_cli_fal_only_alias_reaches_generator(self):
        argv = ["gen_image.py", "--prompt", "p", "--out", "/tmp/never-written.jpg", "--no-openai-fallback"]
        with mock.patch.object(sys, "argv", argv), mock.patch.object(IMAGES, "load_key", return_value="fake"), \
                mock.patch.object(IMAGES, "gen_image") as generate:
            IMAGES.main()
        self.assertFalse(generate.call_args.kwargs["allow_openai_fallback"])


class ContentAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text())
        cls.jobs = json.loads(IMAGE_JOBS_PATH.read_text())
        cls.by_handle = {row["handle"]: row for row in cls.manifest}

    def test_manifest_has_one_publish_now_and_one_later_schedule(self):
        self.assertEqual(
            set(self.by_handle),
            {"best-vanilla-colognes-men", "best-cologne-for-the-gym"},
        )
        self.assertEqual(len(self.manifest), 2)
        publish_now = self.by_handle["best-vanilla-colognes-men"]
        scheduled = self.by_handle["best-cologne-for-the-gym"]
        self.assertIs(publish_now.get("publish_now"), True)
        self.assertNotIn("publish_at", publish_now)
        self.assertEqual(scheduled.get("publish_at"), "2026-12-28T17:00:00Z")
        self.assertNotIn("publish_now", scheduled)
        for row in self.manifest:
            self.assertNotIn("draft", row)
            self.assertNotIn("image_url", row)
            self.assertLessEqual(len(row["seo_title"]), 60)
            self.assertLessEqual(len(row["seo_description"]), 160)
            self.assertTrue((ROOT / row["file"]).is_file())

    def test_handles_and_titles_do_not_duplicate_existing_manifests(self):
        existing_handles = set()
        existing_titles = set()
        for path in (ROOT / "growth-audit").glob("blog-manifest*.json"):
            if path == MANIFEST_PATH:
                continue
            for row in json.loads(path.read_text()):
                if row.get("handle"):
                    existing_handles.add(row["handle"])
                if row.get("title"):
                    existing_titles.add(row["title"].casefold())
        self.assertEqual(set(self.by_handle) & existing_handles, set())
        self.assertEqual({row["title"].casefold() for row in self.manifest} & existing_titles, set())

    def test_exactly_one_deterministic_fal_hero_job_per_article(self):
        self.assertEqual(len(self.jobs), 2)
        self.assertEqual({job["handle"] for job in self.jobs}, set(self.by_handle))
        self.assertEqual(len({job["out"] for job in self.jobs}), 2)
        for handle in self.by_handle:
            matching = [job for job in self.jobs if job["handle"] == handle]
            self.assertEqual(len(matching), 1)
            job = matching[0]
            self.assertEqual(job["out"], f"growth-audit/ai-images/blog/{handle}/hero.jpg")
            self.assertEqual(job["aspect"], "16:9")
            self.assertEqual(job["model"], "fal-ai/nano-banana-2")
            self.assertIs(job["fal_only"], True)
            self.assertEqual(job["resolution"], "2K")
            self.assertTrue(job["prompt"].strip())

    def test_vanilla_article_omits_gated_products_and_has_required_sources(self):
        text = (ROOT / self.by_handle["best-vanilla-colognes-men"]["file"]).read_text()
        lowered = text.lower()
        self.assertNotIn("althair", lowered)
        self.assertNotIn("altha&iuml;r", lowered)
        self.assertNotIn("pegasus", lowered)
        for domain in ("giorgioarmanibeauty-usa.com", "xerjoff.com", "versace.com", "valentino-beauty.us", "bulgari.com"):
            self.assertIn(domain, lowered)
        self.assertNotRegex(text, r"\$\s*\d")
        self.assertNotRegex(lowered, r"\b\d+\s*(?:hours?|sprays?)\b")

    def test_gym_article_uses_official_and_public_health_sources(self):
        text = (ROOT / self.by_handle["best-cologne-for-the-gym"]["file"]).read_text().lower()
        for domain in ("cdc.gov/asthma", "atsdr.cdc.gov/odors", "creedboutique.com", "xerjoff.com", "giorgioarmanibeauty-usa.com", "dolcegabbana.com"):
            self.assertIn(domain, text)
        self.assertIn("no fragrance", text)
        self.assertIn("not medical advice", text)
        self.assertIn("no universal spray count", text)
        self.assertNotRegex(text, r"\$\s*\d")

    def test_both_articles_have_visible_answer_disclosure_table_faq_and_specific_cta(self):
        expected_ctas = {
            "best-vanilla-colognes-men": "Choose your vanilla lane",
            "best-cologne-for-the-gym": "Build a consent-first shortlist",
        }
        for handle, row in self.by_handle.items():
            text = (ROOT / row["file"]).read_text()
            with self.subTest(handle=handle):
                self.assertIn("<strong>Direct answer:</strong>", text[:1200])
                self.assertIn("Disclosure", text[:1800])
                self.assertIn("<table>", text)
                self.assertIn("<caption>", text)
                self.assertIn("Frequently asked questions", text)
                self.assertGreaterEqual(text.count("<h3>"), 5)
                self.assertIn(expected_ctas[handle], text)

    def test_all_internal_links_are_in_verified_live_allowlist(self):
        allowed = {
            "/collections/fragrances",
            "/products/emporio-armani-stronger-with-you-intensely",
            "/products/xerjoff-erba-pura",
            "/products/versace-eros",
            "/products/valentino-born-in-roma-intense",
            "/products/bvlgari-le-gemme-orom",
            "/products/creed-silver-mountain-water",
            "/products/xerjoff-torino-21",
            "/products/acqua-di-gio-profondo-parfum",
            "/products/dolce-gabbana-light-blue",
            "/blogs/hub/32-luxury-fragrances-ranked",
            "/blogs/hub/best-fall-fragrances-men-2026-guide",
            "/blogs/hub/summer-fragrances-men-guide-hot-weather",
            "/blogs/hub/why-perfume-smells-different-on-me",
        }
        for row in self.manifest:
            text = (ROOT / row["file"]).read_text()
            internal = set(re.findall(r'href="(/[^"]+)"', text))
            with self.subTest(handle=row["handle"]):
                self.assertTrue(internal)
                self.assertEqual(internal - allowed, set())


if __name__ == "__main__":
    unittest.main()
