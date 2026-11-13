"""Clock tool — report the current date and time.

Models have no clock: their weights are frozen at a training cutoff, so the
current date is not something they can recall or derive. This tool is how a
tool-capable agent finds out what "now" is.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_TOOL_NAME = "get_time"
_MAX_TIMEZONE_LENGTH = 100


def _resolve_zone(timezone_name: str | None) -> ZoneInfo | None:
    """Return a ZoneInfo for an IANA name, or None for system-local time."""
    if not timezone_name:
        return None
    return ZoneInfo(timezone_name)


def _format_moment(now: datetime, zone_key: str) -> str:
    """Render a timestamp as labelled lines a small model can read reliably."""
    offset = now.strftime("%z")
    offset_display = f"{offset[:3]}:{offset[3:]}" if offset else "unknown"
    tz_name = now.tzname() or "local"
    return "\n".join(
        [
            f"Current date: {now.strftime('%A, %d %B %Y')}",
            f"Current time: {now.strftime('%H:%M:%S')}",
            f"ISO 8601: {now.isoformat()}",
            f"Timezone: {zone_key} ({tz_name}, UTC{offset_display})",
            f"Unix timestamp: {int(now.timestamp())}",
        ]
    )


@ToolRegistry.register(_TOOL_NAME)
class GetTimeTool(BaseTool):
    """Report the current local date and time."""

    tool_id = _TOOL_NAME

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=_TOOL_NAME,
            description=(
                "Get the current date and time. Use this whenever the answer"
                " depends on today's date, the current time, the day of the"
                " week, or relative expressions like 'today', 'yesterday',"
                " 'this week', 'tomorrow' or 'how long until'. Returns the"
                " local date, time, ISO 8601 timestamp, weekday and timezone."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": (
                            "Optional IANA timezone name, e.g. 'Asia/Kolkata'"
                            " or 'America/New_York'. Omit to use the system's"
                            " local timezone."
                        ),
                    },
                },
                "required": [],
            },
            category="utility",
        )

    def execute(self, **params: Any) -> ToolResult:
        timezone_name = params.get("timezone")
        if timezone_name is not None and not isinstance(timezone_name, str):
            return ToolResult(
                tool_name=_TOOL_NAME,
                content="Error: 'timezone' must be a string.",
                success=False,
            )
        timezone_name = (timezone_name or "").strip()
        if len(timezone_name) > _MAX_TIMEZONE_LENGTH:
            return ToolResult(
                tool_name=_TOOL_NAME,
                content="Error: timezone name is too long.",
                success=False,
            )

        try:
            zone = _resolve_zone(timezone_name)
        except (ZoneInfoNotFoundError, ValueError):
            return ToolResult(
                tool_name=_TOOL_NAME,
                content=(
                    f"Error: unknown timezone {timezone_name!r}."
                    " Use an IANA name such as 'Asia/Kolkata' or"
                    " 'Europe/London', or omit the argument for local time."
                ),
                success=False,
            )

        now = datetime.now(zone) if zone is not None else datetime.now().astimezone()
        return ToolResult(
            tool_name=_TOOL_NAME,
            content=_format_moment(now, timezone_name or "system local time"),
            success=True,
        )


__all__ = ["GetTimeTool"]
