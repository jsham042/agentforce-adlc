#!/bin/bash
# Development startup: FastAPI backend + Vite hot reload.
#   PORT=8000           Backend port
#   FRONTEND_PORT=3001  Frontend port

set -e

# The Agent SDK refuses to spawn if it thinks it's nested inside a Claude Code
# session. Scrub these so the harness works when launched from inside Claude
# Code (e.g., `./run_dev.sh` from a CC Bash tool).
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID CLAUDE_CODE_SSE_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$SCRIPT_DIR/ui"

export PORT="${PORT:-8000}"
export FRONTEND_PORT="${FRONTEND_PORT:-3001}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port -sTCP:LISTEN 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Killing existing process on port $port (PID: $pid)${NC}"
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

EXAMPLE="${EXAMPLE:-adlc-builder}"
AGENT_DIR="$SCRIPT_DIR/examples/$EXAMPLE"

if [ ! -d "$AGENT_DIR" ]; then
    echo "Example not found: $AGENT_DIR" >&2
    exit 1
fi

echo -e "${GREEN}=== Agent Dev Mode (example: $EXAMPLE) ===${NC}"

kill_port $PORT
kill_port $FRONTEND_PORT

# Activate virtual environment if it exists
if [ -d "$SCRIPT_DIR/.venv" ]; then
    source "$SCRIPT_DIR/.venv/bin/activate"
fi

# Pin Python + pip to this venv explicitly. Bare `pip` is unsafe here:
# this venv was created without pip (uv venv / --without-pip), so `pip`
# falls through to a shell wrapper → pyenv global → installs into the
# WRONG site-packages while `python` still imports from the venv.
PY="$SCRIPT_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="python3"
"$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade >/dev/null 2>&1

# Verify harness is installed
if ! "$PY" -c "import harness" 2>/dev/null; then
    echo -e "${YELLOW}Installing harness package...${NC}"
    "$PY" -m pip install -e "$SCRIPT_DIR" -q
fi

# Install UI dependencies if needed
if [ ! -d "$UI_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing npm dependencies...${NC}"
    cd "$UI_DIR"
    npm install
    cd "$SCRIPT_DIR"
fi

# Install example-specific skill deps (if declared)
if [ -f "$AGENT_DIR/package.json" ] && [ ! -d "$AGENT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing example npm dependencies ($EXAMPLE)...${NC}"
    (cd "$AGENT_DIR" && npm install)
fi
if [ -f "$AGENT_DIR/requirements.txt" ]; then
    "$PY" -m pip install -q -r "$AGENT_DIR/requirements.txt"
fi

# Start backend in background
# The agent writes .py scripts into sessions/<id>/sandbox/ at runtime; exclude
# it from the reload watcher so those writes don't restart the server mid-turn.
echo -e "${CYAN}Starting FastAPI backend on http://localhost:$PORT${NC}"
mkdir -p "$AGENT_DIR/sessions"
cd "$AGENT_DIR"
"$PY" -m uvicorn server:app --host 0.0.0.0 --port $PORT --reload \
    --reload-exclude "$AGENT_DIR/sessions" &
BACKEND_PID=$!

sleep 2

# Start frontend
echo -e "${CYAN}Starting Vite frontend on http://localhost:$FRONTEND_PORT${NC}"
echo -e "${GREEN}Open http://localhost:$FRONTEND_PORT in your browser${NC}"
echo "Press Ctrl+C to stop both servers."
echo ""

cd "$UI_DIR"
npm run dev

kill $BACKEND_PID 2>/dev/null
