#!/bin/bash
# Deploy the web app to Netlify. Needs NETLIFY_AUTH_TOKEN in the environment (never commit it).
#   NETLIFY_AUTH_TOKEN=nfp_... ./web/deploy.sh
set -euo pipefail
SITE_ID="18974bbe-dd38-4d1c-9ce3-0bcb83deef38"   # scotia-tread-scanner.netlify.app
: "${NETLIFY_AUTH_TOKEN:?set NETLIFY_AUTH_TOKEN}"
cd "$(dirname "$0")"
rm -f /tmp/tread-site.zip
zip -qr /tmp/tread-site.zip . -x deploy.sh
curl -sf -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" -H "Content-Type: application/zip" \
  --data-binary @/tmp/tread-site.zip "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("deploy", d["state"], d["ssl_url"])'
