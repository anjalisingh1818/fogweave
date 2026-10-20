"""Every source adapter must survive failure and rate limits (no network)."""

import asyncio
import json

import httpx
import pytest

from fogweave.http import PoliteClient, RateLimited, SourceError
from fogweave.sources.arxiv import ArxivAdapter, parse_feed
from fogweave.sources.gdelt import GdeltAdapter
from fogweave.sources.hn import HackerNewsAdapter
from fogweave.sources.router import SourceRouter, dedupe
from fogweave.sources.wikipedia import WikipediaAdapter, parse_current_events
from fogweave.sources.base import RawItem


def client(handler, tmp_path):
    c = PoliteClient(min_interval={h: 0 for h in ("export.arxiv.org", "api.gdeltproject.org", "en.wikipedia.org")}, transport=httpx.MockTransport(handler))
    c.cache.dir = tmp_path  # isolated cache
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    c.sleep = fake_sleep
    c.slept = slept
    return c


def run(coro):
    return asyncio.run(coro)


ADAPTERS = [WikipediaAdapter, GdeltAdapter, HackerNewsAdapter, ArxivAdapter]


@pytest.mark.parametrize("cls", ADAPTERS)
def test_adapter_raises_source_error_on_server_failure(cls, tmp_path):
    c = client(lambda req: httpx.Response(503), tmp_path)
    with pytest.raises(SourceError):
        run(cls(c).latest(limit=2))
    assert len(c.slept) >= 2  # retried with backoff before giving up


@pytest.mark.parametrize("cls", ADAPTERS)
def test_adapter_reports_rate_limit_and_honours_retry_after(cls, tmp_path):
    c = client(lambda req: httpx.Response(429, headers={"retry-after": "7"}), tmp_path)
    with pytest.raises(RateLimited):
        run(cls(c).latest(limit=2))
    assert c.slept[0] == 7.0


@pytest.mark.parametrize("cls", ADAPTERS)
def test_adapter_survives_garbage_payload(cls, tmp_path):
    c = client(lambda req: httpx.Response(200, text="<<not json or xml>>"), tmp_path)
    try:
        items = run(cls(c).latest(limit=2))
        assert items == []
    except SourceError:
        pass  # a clean SourceError is also acceptable


def test_router_isolates_a_failing_source(tmp_path):
    def handler(req):
        if "gdelt" in req.url.host:
            return httpx.Response(500)
        if "firebaseio" in req.url.host:
            return httpx.Response(200, json=[])
        if "arxiv" in req.url.host:
            return httpx.Response(429)
        return httpx.Response(200, json={"parse": {"text": ""}})

    c = client(handler, tmp_path)
    r = SourceRouter(http=c)
    items = run(r.lights(archive_days=()))
    assert items == []
    assert r.status["gdelt"]["ok"] is False
    assert r.status["arxiv"]["ok"] is False
    assert r.status["wikipedia"]["ok"] is True


def test_cache_serves_repeat_requests_without_network(tmp_path):
    calls = []

    def handler(req):
        calls.append(req.url)
        return httpx.Response(200, json=[1, 2, 3])

    c = client(handler, tmp_path)
    run(c.get("https://hacker-news.firebaseio.com/v0/topstories.json", as_json=True))
    run(c.get("https://hacker-news.firebaseio.com/v0/topstories.json", as_json=True))
    assert len(calls) == 1


def test_robots_disallow_blocks_article_fetch(tmp_path):
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/")
        return httpx.Response(200, text="<html><body><p>secret</p></body></html>")

    c = client(handler, tmp_path)
    assert run(c.fetch_article("https://example.org/private/story")) is None


def test_current_events_parser_keeps_cited_leaf_entries():
    html = (
        "<ul><li><a href='/wiki/X'>Conflict</a><ul>"
        '<li>Leaders agree to a ceasefire in the region after talks in Geneva. <a href="https://www.reuters.com/a">(Reuters)</a></li>'
        "</ul></li><li>Too short <a href=\"https://x.com/y\">(X)</a></li></ul>"
    )
    from datetime import datetime

    entries = parse_current_events(html, datetime(2026, 10, 19))
    assert len(entries) == 1
    assert entries[0]["citations"] == ["https://www.reuters.com/a"]
    assert entries[0]["text"].startswith("Leaders agree")
    assert "(Reuters)" not in entries[0]["text"]


def test_arxiv_parser_reads_atom():
    xml = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2610.00001v1</id>
    <title>A  Paper</title><summary>We show things.</summary><published>2026-10-19T00:00:00Z</published>
    <author><name>A. Author</name></author></entry></feed>"""
    items = parse_feed(xml)
    assert items[0].title == "A Paper" and items[0].url.startswith("https://") and items[0].kind == "paper"


def test_dedupe_removes_same_url_and_same_title():
    a = RawItem("x", "breaking", "Same Title", "https://a/1", "")
    b = RawItem("y", "breaking", "same  title", "https://b/2", "")
    c = RawItem("z", "breaking", "Other", "https://a/1", "")
    assert len(dedupe([a, b, c])) == 1
