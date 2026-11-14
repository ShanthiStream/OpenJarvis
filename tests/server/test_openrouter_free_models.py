"""Filter logic for the live OpenRouter free-model catalog."""

from __future__ import annotations

from openjarvis.server.routes import _openrouter_free_models


def _item(model_id: str, prompt: str, completion: str, name: str | None = None):
    return {
        "id": model_id,
        "name": name or model_id,
        "context_length": 128000,
        "modality": "text->text",
        "pricing": {"prompt": prompt, "completion": completion},
    }


def test_free_filter_keeps_only_zero_price_models():
    items = [
        _item("vendor/a:free", "0", "0"),
        _item("vendor/b", "0.000001", "0.000002"),
        _item("vendor/c", "0", "0.000002"),
        _item("vendor/d", "0.000001", "0"),
        _item("missing-pricing", "0", ""),
    ]

    models = _openrouter_free_models(items)

    assert [m["id"] for m in models] == ["openrouter/vendor/a:free"]


def test_free_models_are_prefixed_and_sorted():
    items = [
        _item("zeta/z:free", "0", "0"),
        _item("alpha/a:free", "0", "0"),
        _item("", "0", "0"),
    ]

    models = _openrouter_free_models(items)

    assert [m["id"] for m in models] == [
        "openrouter/alpha/a:free",
        "openrouter/zeta/z:free",
    ]
    assert models[0]["context_length"] == 128000
    assert models[0]["modality"] == "text->text"
