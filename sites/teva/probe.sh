UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
URL='https://careers.teva/search/?searchby=location&createNewAlert=false&q=&locationsearch=%D7%99%D7%A9%D7%A8%D7%90%D7%9C&geolocation=&optionsFacetsDD_facility=&optionsFacetsDD_department='
curl -sS --max-time 25 -H "User-Agent: $UA" -H 'accept-language: he-IL,he;q=0.9,en;q=0.8' -o /tmp/teva.html -w "http_code=%{http_code} size=%{size_download}\n" "$URL"
echo "--- job rows (count of /job/ links): ---"; grep -oc '/job/' /tmp/teva.html
echo "--- pagination param candidates (startrow / page / pn): ---"
grep -oiE 'href="[^"]*(startrow|[?&]page=|[?&]pn=)[^"]*"' /tmp/teva.html | sort -u | head -20
echo "--- 'Page 1 of' / results text: ---"
grep -oiE 'Page [0-9]+ of [0-9]+|of [0-9]+ ' /tmp/teva.html | head -5
echo "--- any startrow anywhere: ---"
grep -oiE 'startrow=[0-9]+' /tmp/teva.html | sort -u | head
