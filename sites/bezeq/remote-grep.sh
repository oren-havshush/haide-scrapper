cd /opt/haide-scrapper
docker compose logs --since 15m worker 2>&1 | grep -iE 'per-site browser overrides|bezeq|browserOverrides|bypassCSP|setupScript|Main navigation' | tail -n 100
