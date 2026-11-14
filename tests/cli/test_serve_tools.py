"""Regression tests for tool selection during ``jarvis serve`` startup."""

from __future__ import annotations

import pytest

from openjarvis.cli.serve import _resolve_allowed_tools, _resolve_server_cors_origins
from openjarvis.core.config import JarvisConfig


@pytest.mark.parametrize(
    "configured",
    [
        "code_interpreter,file_read",
        ["code_interpreter", "file_read"],
    ],
)
def test_tools_enabled_is_used_by_serve(configured):
    config = JarvisConfig()
    config.tools.enabled = configured

    allowed, explicit = _resolve_allowed_tools(config)

    assert allowed == {"code_interpreter", "file_read"}
    assert explicit is True


def test_tools_enabled_takes_precedence_over_legacy_agent_tools():
    config = JarvisConfig()
    config.tools.enabled = "file_read"
    config.agent.tools = "calculator"

    allowed, explicit = _resolve_allowed_tools(config)

    assert allowed == {"file_read"}
    assert explicit is True


def test_agent_tools_remains_a_backward_compatible_fallback():
    config = JarvisConfig()
    config.agent.tools = "file_read"

    allowed, explicit = _resolve_allowed_tools(config)

    assert allowed == {"file_read"}
    assert explicit is True


def test_serve_defaults_tools_when_no_selection_is_configured():
    allowed, explicit = _resolve_allowed_tools(JarvisConfig())

    assert allowed == {"think", "calculator", "web_search"}
    assert explicit is False


def test_cors_environment_overrides_configured_defaults(monkeypatch):
    monkeypatch.setenv(
        "OPENJARVIS_CORS_ORIGINS",
        " https://frontend.example, https://admin.example ",
    )

    origins = _resolve_server_cors_origins(["http://localhost:5173"])

    assert origins == ["https://frontend.example", "https://admin.example"]


def test_cors_config_is_used_without_environment(monkeypatch):
    monkeypatch.delenv("OPENJARVIS_CORS_ORIGINS", raising=False)

    origins = _resolve_server_cors_origins(["http://localhost:5173"])

    assert origins == ["http://localhost:5173"]


def test_server_memory_tools_receive_the_live_backend():
    """The serve path must bind the backend at construction time.

    Regression: tools were built with ``tool_cls(**file_tool_kwargs(...))``,
    so ``memory_store`` kept ``_backend = None`` and every call answered
    "No memory backend configured." even though the memory service was active.
    """
    from openjarvis.cli.serve import _instantiate_server_tools

    class _FakeBackend:
        backend_id = "fake"

    backend = _FakeBackend()
    config = JarvisConfig()
    config.tools.enabled = ["memory_store", "memory_search", "memory_retrieve"]

    tools = _instantiate_server_tools(
        config,
        engine=object(),
        model="test-model",
        memory_backend=backend,
    )

    assert tools, "expected the configured memory tools to be instantiated"
    for tool in tools:
        assert tool._backend is backend


def test_server_tool_resolution_skips_unconfigured_tools():
    from openjarvis.cli.serve import _instantiate_server_tools

    config = JarvisConfig()
    config.tools.enabled = ["memory_store"]

    tools = _instantiate_server_tools(
        config,
        engine=object(),
        model="test-model",
        memory_backend=None,
    )

    assert [tool.spec.name for tool in tools] == ["memory_store"]
