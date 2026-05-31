docker logs --since 14m haide-scrapper-worker-1 2>&1 \
  | grep -iE 'scrape|pagination|detail page|listing page|jobs=|error|timeout|akamai|403|browserOverrides|Found .* detail' \
  | tail -n 70
