URL='https://www.osem-nestle.co.il/career/open-positions'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

echo "=== worker HOST -> osem with FULL real-Chrome header set ==="
curl -sS -o /tmp/osem.html -w "http_code=%{http_code} size=%{size_download}\n" --max-time 30 \
  -H "User-Agent: $UA" \
  -H 'sec-ch-ua: "Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: document' \
  -H 'sec-fetch-mode: navigate' \
  -H 'sec-fetch-site: cross-site' \
  -H 'sec-fetch-user: ?1' \
  -H 'upgrade-insecure-requests: 1' \
  -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
  -H 'accept-language: he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' \
  -H 'referer: https://www.google.com/' \
  "$URL" 2>&1 || echo "curl FAILED rc=$?"

echo ""
echo "=== signal: is the job listing actually in the returned HTML? ==="
echo -n "  'משרה' (job) occurrences: "; grep -oc 'משרה' /tmp/osem.html 2>/dev/null || echo 0
echo -n "  'open-positions'/title present: "; grep -oiE 'open-positions|משרות פתוחות' /tmp/osem.html 2>/dev/null | head -1
echo -n "  AkamaiGHost decoy present: "; grep -oiE 'AkamaiGHost|temporarily unavailable' /tmp/osem.html 2>/dev/null | head -1
echo "  first 200 chars:"; head -c 200 /tmp/osem.html 2>/dev/null; echo
