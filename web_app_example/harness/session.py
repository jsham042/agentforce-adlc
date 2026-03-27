"""Session metadata + display-state persistence.

The SDK owns conversation state (resume via sdk_session_id).
We own *display* state — the exact WS payloads that were streamed,
so the UI can repaint history on session click.

Directory structure:
    sessions/<session_id>/
    ├── metadata.json      # {session_id, sdk_session_id, title, created_at,
    │                      #  updated_at, num_turns, total_cost_usd}
    ├── messages.jsonl     # WS wire-format payloads, one per line
    └── sandbox/           # Agent's file workspace
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any


class SessionStore:
    """Manages a single session's directory, metadata, and message log."""

    def __init__(self, session_id: str, sessions_dir: Path):
        self.session_id = session_id
        self.path = sessions_dir / session_id
        self.sandbox_path = self.path / "sandbox"
        self.metadata_file = self.path / "metadata.json"
        self.messages_file = self.path / "messages.jsonl"

    def create(self) -> None:
        """Create session directory and sandbox."""
        self.path.mkdir(parents=True, exist_ok=True)
        self.sandbox_path.mkdir(exist_ok=True)
        if not self.metadata_file.exists():
            self._save({
                "session_id": self.session_id,
                "created_at": datetime.now().isoformat(),
                "title": None,
            })

    def exists(self) -> bool:
        return self.metadata_file.exists()

    def set_title(self, title: str) -> None:
        data = self._load()
        data["title"] = title
        data["updated_at"] = datetime.now().isoformat()
        self._save(data)

    def get_info(self) -> dict:
        return self._load() if self.exists() else {}

    def delete(self) -> bool:
        import shutil
        try:
            if self.path.exists():
                shutil.rmtree(self.path)
                return True
            return False
        except Exception:
            return False

    # ---- Message log ----

    def append_message(self, payload: dict) -> None:
        """Append a WS payload to messages.jsonl. Called during stream."""
        with open(self.messages_file, "a") as f:
            f.write(json.dumps(payload) + "\n")

    def read_messages(self) -> list[dict]:
        """Load WS payloads for session_restored. Returns [] if none."""
        if not self.messages_file.exists():
            return []
        with open(self.messages_file) as f:
            return [json.loads(line) for line in f if line.strip()]

    # ---- Metadata enrichment ----

    def update_from_result(self, result_msg: Any) -> None:
        """Update metadata from a ResultMessage (sdk_session_id, turns, cost)."""
        meta = self._load()
        sdk_sid = getattr(result_msg, "session_id", None)
        if sdk_sid:
            meta["sdk_session_id"] = sdk_sid
        turns = getattr(result_msg, "num_turns", 0)
        meta["num_turns"] = meta.get("num_turns", 0) + turns
        cost = getattr(result_msg, "total_cost_usd", None)
        if cost is not None:
            meta["total_cost_usd"] = meta.get("total_cost_usd", 0.0) + cost
        meta["updated_at"] = datetime.now().isoformat()
        self._save(meta)

    def _load(self) -> dict:
        if self.metadata_file.exists():
            return json.loads(self.metadata_file.read_text())
        return {}

    def _save(self, data: dict) -> None:
        self.metadata_file.write_text(json.dumps(data, indent=2))

    @classmethod
    def list_all(cls, sessions_dir: Path) -> list[dict]:
        """List all sessions with their metadata."""
        sessions = []
        if not sessions_dir.exists():
            return sessions
        for d in sessions_dir.iterdir():
            if d.is_dir():
                store = cls(d.name, sessions_dir)
                if store.exists():
                    sessions.append(store.get_info())
        sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)
        return sessions
