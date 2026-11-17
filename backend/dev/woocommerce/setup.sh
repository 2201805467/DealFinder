#!/bin/sh
set -eu
if ! wp core is-installed; then
  wp core install --url=http://127.0.0.1:8088 --title='DealFinder LOCAL TEST Store' \
    --admin_user=dealfinder_demo --admin_password="$WC_DEMO_ADMIN_PASSWORD" \
    --admin_email=demo@example.invalid --skip-email
fi
if ! wp plugin is-installed woocommerce; then
  wp plugin install woocommerce --activate
else
  wp plugin activate woocommerce
fi
wp rewrite structure '/%postname%/' --hard
wp eval-file /demo/seed.php
wp core version
wp plugin get woocommerce --field=version
