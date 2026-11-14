"""Guard rails for ticking an agent whose model needs a provider we don't have."""

from __future__ import annotations

from openjarvis.agents.executor import _engine_supports_cloud


class _FakeEngine:
    engine_id = "ollama"


class _FakeMultiEngine(_FakeEngine):
    def __init__(self, keys: list[str]) -> None:
        self._engines = [(key, None) for key in keys]


class _FakeCloudEngine(_FakeEngine):
    engine_id = "cloud"


def test_bare_ollama_cannot_serve_cloud_models():
    assert _engine_supports_cloud(_FakeEngine()) is False


def test_multi_engine_without_cloud_cannot_serve_cloud_models():
    engine = _FakeMultiEngine(["ollama"])
    engine.engine_id = "multi"

    assert _engine_supports_cloud(engine) is False


def test_multi_engine_with_cloud_can_serve_cloud_models():
    engine = _FakeMultiEngine(["ollama", "cloud"])
    engine.engine_id = "multi"

    assert _engine_supports_cloud(engine) is True


def test_solo_cloud_engine_can_serve_cloud_models():
    assert _engine_supports_cloud(_FakeCloudEngine()) is True


def test_wrapped_multi_engine_is_unwrapped_for_cloud_detection():
    wrapped = type(
        "InstrumentedEngine",
        (),
        {"_inner": _FakeMultiEngine(["ollama", "cloud"])},
    )()
    wrapped._inner.engine_id = "multi"

    assert _engine_supports_cloud(wrapped) is True


def test_agent_tick_fails_fast_on_cloud_model_without_cloud_engine(
    scenario_harness,
):
    """A cloud model picked in the UI must not reach the local engine."""
    h = scenario_harness
    h.engine._responses = [{"content": "local engine was called"}]
    h.engine._call_count = 0

    agent = h.manager.create_agent(
        name="cloud-agent",
        config={
            "schedule_type": "manual",
            "instruction": "Do something.",
            "model": "openrouter/google/gemma-4-31b-it:free",
        },
    )
    aid = agent["id"]

    h.executor.execute_tick(aid)

    agent = h.manager.get_agent(aid)
    assert agent is not None
    assert agent["status"] == "error"
    assert h.engine._call_count == 0, "cloud model must not be sent to the local engine"
    assert "no cloud client" in (agent["summary_memory"] or "").lower()
    assert "openrouter/google/gemma-4-31b-it:free" in agent["summary_memory"]
