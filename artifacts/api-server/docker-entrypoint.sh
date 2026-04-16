#!/bin/sh
if [ "$WORKER_MODE" = "true" ]; then
  exec node --enable-source-maps dist/worker.mjs
else
  exec node --enable-source-maps dist/index.mjs
fi
