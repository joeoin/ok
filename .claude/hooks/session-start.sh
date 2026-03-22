#!/bin/bash
# Session start hook — only runs in remote/cloud Claude Code sessions
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Skip slow setup when running as an SDK sub-agent
if [ "${CLAUDE_CODE_ENTRYPOINT:-}" = "sdk-py" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 300000}'

# Install Python deps from requirements.txt
pip install -r "$CLAUDE_PROJECT_DIR/requirements.txt" --quiet

# Install the Playwright browser binary (gets wiped between cloud sessions)
playwright install chromium
