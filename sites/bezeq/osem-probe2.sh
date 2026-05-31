UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
LIST='https://www.osem-nestle.co.il/career/open-positions'
DET='https://www.osem-nestle.co.il/career/open-positions/404037'

common=(-sS --max-time 25
  -H "User-Agent: $UA"
  -H 'sec-ch-ua: "Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
  -H 'sec-ch-ua-mobile: ?0'
  -H 'sec-ch-ua-platform: "Windows"'
  -H 'sec-fetch-dest: document'
  -H 'sec-fetch-mode: navigate'
  -H 'sec-fetch-user: ?1'
  -H 'upgrade-insecure-requests: 1'
  -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
  -H 'accept-language: he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7')

echo "=== TEST 1: detail page with sec-fetch-site=same-origin + listing referer ==="
curl "${common[@]}" -H 'sec-fetch-site: same-origin' -H "referer: $LIST" -o /tmp/det.html -w "detail http_code=%{http_code} size=%{size_download}\n" "$DET"
echo -n "  body field present: "; grep -oiE 'field--name-body|field--item' /tmp/det.html 2>/dev/null | head -1
echo -n "  error decoy present: "; grep -oiE "we're sorry|problem with our website|AkamaiGHost" /tmp/det.html 2>/dev/null | head -1
echo "  title:"; grep -oiE '<h1[^>]*>[^<]{0,80}' /tmp/det.html 2>/dev/null | head -1

echo ""
echo "=== TEST 2a: listing with items_per_page=All ==="
curl "${common[@]}" -H 'sec-fetch-site: cross-site' -H 'referer: https://www.google.com/' -o /tmp/all.html -w "all http_code=%{http_code} size=%{size_download}\n" "$LIST?items_per_page=All"
echo -n "  column-job count: "; grep -oc 'column-job' /tmp/all.html 2>/dev/null || echo 0

echo ""
echo "=== TEST 2b: listing page=1 (Drupal 0-indexed second page) ==="
curl "${common[@]}" -H 'sec-fetch-site: cross-site' -H 'referer: https://www.google.com/' -o /tmp/p1.html -w "page1 http_code=%{http_code} size=%{size_download}\n" "$LIST?page=1"
echo -n "  column-job count: "; grep -oc 'column-job' /tmp/p1.html 2>/dev/null || echo 0
echo -n "  distinct job ids on page1: "; grep -oiE '/career/open-positions/[0-9]+' /tmp/p1.html 2>/dev/null | sort -u | head -20 | tr '\n' ' '; echo
