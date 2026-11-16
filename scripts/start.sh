#!/bin/sh
# Production entrypoint. One image, two Railway services:
#   VYBD_ROLE=worker  job worker
#   VYBD_ROLE=web     migrate, then the Next.js server
#   unset             Next.js server only (local `pnpm start`)
set -e
case "$VYBD_ROLE" in
  worker) exec tsx src/worker/index.ts ;;
  web) drizzle-kit migrate && exec next start ;;
  *) exec next start ;;
esac
