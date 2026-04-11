#!/bin/zsh
# Start all services for Photo Master
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping any running services..."
kill -9 $(lsof -ti:3000 -ti:5173) 2>/dev/null || true
sleep 1

echo "Starting API server on :3000..."
cd "$ROOT/artifacts/api-server"
node --env-file=.env --enable-source-maps ./dist/index.mjs > /tmp/photo-master-api.log 2>&1 &
API_PID=$!

sleep 2
if ! curl -sf http://localhost:3000/api/healthz > /dev/null; then
  echo "ERROR: API server failed to start. Check /tmp/photo-master-api.log"
  cat /tmp/photo-master-api.log
  exit 1
fi
echo "  API server running (PID $API_PID)"

echo "Starting frontend on :5173..."
cd "$ROOT/artifacts/my-photos"
PORT=5173 BASE_PATH=/ pnpm dev > /tmp/photo-master-vite.log 2>&1 &
VITE_PID=$!

sleep 4
if ! curl -sf http://localhost:5173/ > /dev/null; then
  echo "ERROR: Frontend failed to start. Check /tmp/photo-master-vite.log"
  cat /tmp/photo-master-vite.log
  exit 1
fi
echo "  Frontend running (PID $VITE_PID)"

echo ""
echo "All services running!"
echo "  App:  http://localhost:5173"
echo "  API:  http://localhost:3000"
echo ""
echo "Logs: /tmp/photo-master-api.log  |  /tmp/photo-master-vite.log"
echo "Stop: kill $API_PID $VITE_PID"
