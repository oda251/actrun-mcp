#!/bin/bash
# SessionStart hook — registers the transcript path with sidekick.
# Install in Claude Code settings.json:
#   "SessionStart": [{ "hooks": [{ "type": "command", "command": "./hooks/register-transcript.sh" }] }]

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SIDEKICK_URL="${SIDEKICK_URL:-http://127.0.0.1:4312/mcp}"

if [ -z "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

curl -s -X POST "$SIDEKICK_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"register-transcript\",
      \"arguments\": { \"path\": \"$TRANSCRIPT_PATH\" }
    },
    \"id\": 1
  }" > /dev/null 2>&1

exit 0
