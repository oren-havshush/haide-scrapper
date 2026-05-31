echo "=== from worker HOST (194.88.110.149) ==="
curl -sS -o /dev/null -w "host http_code=%{http_code} size=%{size_download}\n" \
  -H 'Accept: application/json' \
  -H 'Origin: https://www.bezeq.co.il' \
  -H 'Referer: https://www.bezeq.co.il/career_new/' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  --max-time 30 \
  'https://d-api.bezeq.co.il/api/Adam/GetActiveJobs' 2>&1 || echo "host curl FAILED rc=$?"

echo "=== from inside WORKER container ==="
cd /opt/haide-scrapper
docker compose exec -T worker sh -lc "curl -sS -o /dev/null -w 'container http_code=%{http_code} size=%{size_download}\n' -H 'Accept: application/json' -H 'Origin: https://www.bezeq.co.il' -H 'Referer: https://www.bezeq.co.il/career_new/' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' --max-time 30 'https://d-api.bezeq.co.il/api/Adam/GetActiveJobs'" 2>&1 || echo "container curl FAILED rc=$?"
