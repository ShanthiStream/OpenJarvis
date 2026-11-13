"""Phonon TTS backend — local voice synthesis served by Ollama.

Phonon is a small (~43M parameter) TTS model distributed through Ollama
(``ollama pull phonon``). Ollama 0.40+ serves speech models over an
OpenAI-compatible ``POST /v1/audio/speech`` endpoint, so this backend is a
thin HTTP client: no local weights, no extra Python dependencies.

Because the synthesis happens in Ollama, the model must already be pulled and
the Ollama daemon must be reachable. Voices are enumerated from Ollama itself
(``POST /api/show``) rather than hardcoded, since the Phonon voice catalog is
large and may change between model revisions.

NOTE: this file is not part of upstream OpenJarvis. ``~/.openjarvis/src`` is an
editable install, so ``jarvis self-update`` may overwrite it. Re-add the module
and its two registration lines (``speech/__init__.py`` and
``speech/_tts_discovery.py``) if Phonon support disappears after an update.
"""

from __future__ import annotations

import io
import os
import wave
from typing import List

import httpx

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

_DEFAULT_MODEL = "phonon"
_DEFAULT_VOICE_ID = "Bryony"
_DEFAULT_HOST = "http://localhost:11434"

# Ollama reports the rate in the WAV header it returns (24 kHz for Phonon);
# this is only the fallback when the header cannot be read.
_FALLBACK_SAMPLE_RATE = 24000


def _resolve_host(host: str = "") -> str:
    """Return the Ollama base URL, honouring ``OLLAMA_HOST`` like the CLI does."""
    candidate = host or os.environ.get("OLLAMA_HOST", "") or _DEFAULT_HOST
    candidate = candidate.strip()
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    return candidate.rstrip("/")


def _sample_rate(audio: bytes) -> int:
    """Read the sample rate from WAV bytes, falling back to Phonon's rate."""
    try:
        with wave.open(io.BytesIO(audio), "rb") as handle:
            return handle.getframerate()
    except Exception:
        return _FALLBACK_SAMPLE_RATE


@TTSRegistry.register("phonon")
class PhononTTSBackend(TTSBackend):
    """Phonon TTS — local synthesis through Ollama's speech API."""

    backend_id = "phonon"

    def __init__(self, *, model: str = _DEFAULT_MODEL, host: str = "") -> None:
        self._model = model
        self._host = _resolve_host(host)

    def _request(self, method: str, path: str, *, timeout: float, **kwargs) -> httpx.Response:
        """Issue a request against Ollama, translating transport errors."""
        try:
            return httpx.request(
                method, f"{self._host}{path}", timeout=timeout, **kwargs
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"Could not reach Ollama at {self._host} for Phonon speech: {exc}. "
                "Is `ollama serve` running?"
            ) from exc

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = _DEFAULT_VOICE_ID,
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> TTSResult:
        voice = voice_id or _DEFAULT_VOICE_ID

        # Ollama only returns WAV for speech models, so ``output_format`` is
        # accepted for interface compatibility but does not change the payload.
        response = self._request(
            "POST",
            "/v1/audio/speech",
            timeout=180.0,
            json={
                "model": self._model,
                "input": text,
                "voice": voice,
                "speed": speed,
                "response_format": "wav",
            },
        )
        if response.status_code != 200:
            detail = response.text[:300].strip() or "(empty body)"
            raise RuntimeError(
                f"Phonon synthesis failed (HTTP {response.status_code}): {detail}"
            )

        audio = response.content
        if not audio:
            raise RuntimeError(
                f"Phonon returned no audio for model {self._model!r}. "
                f"Is it pulled? Try: ollama pull {self._model}"
            )

        rate = _sample_rate(audio)
        return TTSResult(
            audio=audio,
            format="wav",
            voice_id=voice,
            sample_rate=rate,
            duration_seconds=0.0,
            metadata={"backend": "phonon", "model": self._model, "requested_format": output_format},
        )

    def available_voices(self) -> List[str]:
        """Return the voice catalog Ollama reports for the Phonon model."""
        try:
            response = self._request(
                "POST", "/api/show", timeout=10.0, json={"model": self._model}
            )
            response.raise_for_status()
            voices = response.json().get("voices") or []
        except (RuntimeError, httpx.HTTPError, ValueError):
            return []
        return [str(v) for v in voices]

    def health(self) -> bool:
        """True when Ollama is up and the configured speech model is present."""
        try:
            response = self._request("GET", "/api/tags", timeout=3.0)
            response.raise_for_status()
            models = response.json().get("models") or []
        except (RuntimeError, httpx.HTTPError, ValueError):
            return False
        wanted = self._model.split(":")[0]
        return any(
            str(entry.get("name", "")).split(":")[0] == wanted for entry in models
        )


__all__ = ["PhononTTSBackend"]
