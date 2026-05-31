cd /opt/haide-scrapper
docker compose logs --since 5m worker 2>&1 | grep -iE 'per-site browser|bypassCSP|setupScript|0 items|items on first|bezeq|Quality warnings' | tail -n 60
