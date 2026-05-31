UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
LIST='https://www.osem-nestle.co.il/career/open-positions'
DET='https://www.osem-nestle.co.il/career/open-positions/400609'

base=(-sS --max-time 25
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

probe () {
  local label="$1"; shift
  curl "${base[@]}" "$@" -o /tmp/d.html -w "$label http_code=%{http_code} size=%{size_download}\n" "$DET"
  echo -n "  decoy(AkamaiGHost/sorry): "; grep -oiE "AkamaiGHost|we're sorry|temporarily unavailable" /tmp/d.html | head -1; echo
  echo -n "  field--name-body: "; grep -oc 'field--name-body' /tmp/d.html; 
  echo "  candidate description containers:"
  grep -oiE 'class="[^"]*(field--name-body|field--type-text|node__content|field--name-field[^"]*|wysiwyg|text-formatted|clearfix)[^"]*"' /tmp/d.html | sort -u | head -20
  echo "  h1:"; grep -oiE '<h1[^>]*>[^<]{0,80}' /tmp/d.html | head -1
}

echo "=== A) sec-fetch-site=none (what the worker goto sends now) ==="
probe "none" -H 'sec-fetch-site: none'
echo ""
echo "=== B) sec-fetch-site=same-origin + listing referer (known-good) ==="
probe "same-origin" -H 'sec-fetch-site: same-origin' -H "referer: $LIST"
