"""Utilities for locating and linking SDK transcript files.

The Claude Agent SDK stores per-project state at:
    ~/.claude/projects/<mangled-cwd>/

where <mangled-cwd> is the absolute cwd with every '/' replaced by '-'.
The leading dash IS retained — e.g. /root/foo → -root-foo.
"""

from pathlib import Path


def sdk_project_dir(cwd: Path) -> Path:
    """Return the SDK's project directory for a given agent cwd.

    The SDK stores per-project state under ~/.claude/projects/<mangled>/,
    where <mangled> is the absolute cwd with every '/' replaced by '-'
    (leading dash retained — e.g. /root/foo → -root-foo).
    """
    mangled = str(cwd.resolve()).replace("/", "-")
    return Path.home() / ".claude" / "projects" / mangled


def get_transcript_path(session_id: str, cwd: Path) -> Path | None:
    """Return the path to the SDK transcript JSONL, or None if not found.

    Args:
        session_id: The SDK session ID (from ResultMessage.session_id).
        cwd: The working directory the agent was launched with.
    """
    transcript = sdk_project_dir(cwd) / f"{session_id}.jsonl"
    return transcript if transcript.exists() else None


def link_transcript(session_id: str, dest_dir: Path, cwd: Path) -> Path | None:
    """Symlink the SDK transcript JSONL into dest_dir.

    Creates ``dest_dir/transcript.jsonl`` pointing at the native SDK
    transcript file.  No-op if the transcript doesn't exist yet or
    the link is already in place.

    Args:
        session_id: The SDK session ID.
        dest_dir: Directory where the symlink should be created.
        cwd: The working directory the agent was launched with.

    Returns:
        The symlink path, or None if the transcript wasn't found.
    """
    transcript = get_transcript_path(session_id, cwd)
    if not transcript:
        return None

    link_path = dest_dir / "transcript.jsonl"
    if not link_path.exists():
        link_path.symlink_to(transcript)
    return link_path
