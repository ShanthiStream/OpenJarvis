"""Regression tests for cloud provider detection and model ID normalization."""

from __future__ import annotations

import os

import pytest

from openjarvis.core.types import Message
from openjarvis.server import cloud_router


@pytest.mark.parametrize(
    "model",
    ["gpt-oss", "gpt-oss:20b", "gpt-oss:120b", "gpt-oss-20b", "gpt-oss-120b"],
)
def test_gpt_oss_is_local(model):
    assert cloud_router.get_provider(model) is None
    assert not cloud_router.is_cloud_model(model)


@pytest.mark.parametrize(
    "model,provider",
    [
        ("gpt-4o", "openai"),
        ("claude-sonnet-4-20250514", "anthropic"),
        ("gemini-2.5-pro", "google"),
        ("openai/gpt-oss-20b", "openrouter"),
        ("openrouter/openai/gpt-oss-120b", "openrouter"),
        ("atlascloud/openai/gpt-oss-120b", "atlascloud"),
    ],
)
def test_cloud_models_keep_their_provider(model, provider):
    assert cloud_router.get_provider(model) == provider
    assert cloud_router.is_cloud_model(model)


def test_get_provider_detects_bare_openrouter_id():
    assert cloud_router.get_provider("anthropic/claude-haiku-4.5") == "openrouter"


def test_get_provider_detects_litellm_prefixed_openrouter_id():
    model = "openrouter/anthropic/claude-haiku-4.5"
    assert cloud_router.get_provider(model) == "openrouter"


@pytest.mark.parametrize(
    "requested_model,expected_forwarded_model",
    [
        ("anthropic/claude-haiku-4.5", "anthropic/claude-haiku-4.5"),
        ("openrouter/anthropic/claude-haiku-4.5", "anthropic/claude-haiku-4.5"),
        ("openrouter/auto", "openrouter/auto"),
    ],
)
@pytest.mark.asyncio
async def test_stream_cloud_normalizes_openrouter_model_before_forwarding(
    monkeypatch, requested_model, expected_forwarded_model
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    captured: dict[str, str] = {}

    async def fake_stream_openai(model, messages, temperature, max_tokens, **kwargs):
        captured["model"] = model
        yield "ok"

    monkeypatch.setattr(cloud_router, "_stream_openai", fake_stream_openai)

    tokens = [
        token
        async for token in cloud_router.stream_cloud(
            requested_model, [Message(role="user", content="hi")]
        )
    ]

    assert tokens == ["ok"]
    assert captured["model"] == expected_forwarded_model


def test_load_cloud_env_exports_keys_without_overriding(monkeypatch, tmp_path):
    keys_file = tmp_path / "cloud-keys.env"
    keys_file.write_text(
        "# comment\n"
        "OPENROUTER_API_KEY=sk-or-v1-from-file\n"
        "OPENAI_API_KEY='sk-from-file'\n"
        "MALFORMED_LINE\n"
    )
    monkeypatch.setattr(cloud_router, "_CLOUD_ENV_FILE", keys_file)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-shell")

    loaded = cloud_router.load_cloud_env()

    assert sorted(loaded) == ["OPENROUTER_API_KEY"]
    assert os.environ["OPENROUTER_API_KEY"] == "sk-or-v1-from-file"
    # An existing shell export always wins over the file.
    assert os.environ["OPENAI_API_KEY"] == "sk-from-shell"
    assert "MALFORMED_LINE" not in os.environ


def test_load_cloud_env_is_a_noop_without_the_file(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud_router, "_CLOUD_ENV_FILE", tmp_path / "missing.env")

    assert cloud_router.load_cloud_env() == {}
